import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc, TableNames } from './_generated/dataModel';
import { internalMutation, mutation, type MutationCtx } from './_generated/server';
import { requireUser } from './model/auth';
import * as Collections from './model/collections';
import * as Groups from './model/groups';
import * as Library from './model/library';
import { ACCOUNT_DELETE_BATCH, ACCOUNT_DELETE_DOCUMENTS } from './model/limits';
import * as Notifications from './model/notifications';
import { limit } from './model/rateLimits';

/**
 * Deleting an account, all the way down.
 *
 * `sign-out-action.tsx` has always said this exists. It did not, and a screen
 * that offers to delete an account and does not is worse than one that never
 * offered — so this is the whole cascade, and the notes below are about why it
 * is shaped the way it is rather than done in one mutation.
 *
 * **It cannot be one mutation.** An account is every row somebody has written:
 * documents, page text, annotations, shares in both directions, groups,
 * events. A Convex mutation has a one-second budget and a read limit, and a
 * reader with four thousand annotations exceeds both. So the public mutation
 * does two small things — makes the account unreachable, and schedules the
 * first step — and the cascade runs as a chain of bounded internal mutations,
 * each one a transaction that either finishes its phase or reschedules itself.
 *
 * **The account is unusable from the first step, not the last.** `subject` is
 * the column `findUser` matches the Google token against, so overwriting it
 * with a tombstone signs the reader out of an account that no longer answers
 * to their token, immediately, while the rows behind it are still being
 * removed. Handle and address go at the same moment: a half-deleted account
 * that is still findable by strangers is the one state worth ruling out
 * outright. What is left is a row nothing can reach, addressed only by the id
 * the cascade carries.
 *
 * **Documents go through `Library.removeDocument`.** It already deletes the
 * outline, the job, the page text, the bookmarks, the annotations, every share
 * on the document and both R2 objects. A second cascade written here would be
 * a second thing to keep correct, and the one that got forgotten would be the
 * one that leaves a stranger's notes in the database.
 *
 * **Other people's rows are left alone**, with one exception that is not an
 * exception: shares *to* this account are deleted, because a grant to a
 * deleted recipient names nobody. Notes this account wrote on somebody else's
 * document are deleted too — they are this reader's words, and the document
 * they were written on is not.
 */

/** The phases, in the order they run. `done` deletes the row itself. */
const PHASES = [
  'documents',
  'collections',
  'annotations',
  'sharesReceived',
  'sharesCreated',
  'memberships',
  'groups',
  'events',
  'devices',
  'settings',
  'done',
] as const;

type Phase = (typeof PHASES)[number];

const phaseValidator = v.union(
  v.literal('documents'),
  v.literal('collections'),
  v.literal('annotations'),
  v.literal('sharesReceived'),
  v.literal('sharesCreated'),
  v.literal('memberships'),
  v.literal('groups'),
  v.literal('events'),
  v.literal('devices'),
  v.literal('settings'),
  v.literal('done'),
);

/**
 * Starts the deletion. There is no way back from this call.
 *
 * The bucket is `deleteAccount`'s own rather than `editSettings`: this is one
 * call per account ever, and metering it with the switch-flipping bucket would
 * let a stolen session spend the budget that protects it.
 */
export const deleteAccount = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'deleteAccount');

    await ctx.db.patch('users', user._id, {
      // Nothing matches this. `findUser` walks `by_subject` with the token's
      // `sub`, which is Google's and is digits — a value with a colon in it
      // cannot collide with one.
      subject: `deleted:${user._id}`,
      email: '',
      handle: undefined,
      name: undefined,
      pictureUrl: undefined,
    });

    await ctx.scheduler.runAfter(0, internal.account.step, {
      userId: user._id,
      phase: 'documents',
    });
    return null;
  },
});

/**
 * One bounded pass, then either itself again or the next phase.
 *
 * Internal, and it has to be: it takes the id of the account to delete, which
 * is precisely the argument shape that must never be reachable from a client.
 */
export const step = internalMutation({
  args: { userId: v.id('users'), phase: phaseValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get('users', args.userId);
    // Already gone: a retry after a scheduler hiccup, or a second chain from a
    // double tap. Both are fine, and neither should throw.
    if (user === null) {
      return null;
    }

    const more = await runPhase(ctx, user, args.phase);
    if (args.phase === 'done') {
      return null;
    }
    await ctx.scheduler.runAfter(0, internal.account.step, {
      userId: args.userId,
      phase: more ? args.phase : PHASES[PHASES.indexOf(args.phase) + 1],
    });
    return null;
  },
});

/** Whether this phase has more to do. */
async function runPhase(ctx: MutationCtx, user: Doc<'users'>, phase: Phase): Promise<boolean> {
  switch (phase) {
    case 'documents': {
      const docs = await ctx.db
        .query('documents')
        .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
        .take(ACCOUNT_DELETE_DOCUMENTS);
      for (const doc of docs) {
        await Library.removeDocument(ctx, user, doc._id);
      }
      return docs.length === ACCOUNT_DELETE_DOCUMENTS;
    }

    case 'collections': {
      const rows = await ctx.db
        .query('collections')
        .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
        .take(ACCOUNT_DELETE_BATCH);
      for (const row of rows) {
        await Collections.remove(ctx, user, row._id);
      }
      return rows.length === ACCOUNT_DELETE_BATCH;
    }

    // Notes written on documents belonging to somebody else. The ones on this
    // account's own documents went with the documents.
    case 'annotations':
      return await deleteBatch(ctx, 'documentAnnotations', () =>
        ctx.db
          .query('documentAnnotations')
          .withIndex('by_author', (q) => q.eq('authorId', user._id))
          .take(ACCOUNT_DELETE_BATCH),
      );

    case 'sharesReceived':
      return await deleteBatch(ctx, 'documentShares', () =>
        ctx.db
          .query('documentShares')
          .withIndex('by_recipient_and_updated', (q) => q.eq('recipientUserId', user._id))
          .take(ACCOUNT_DELETE_BATCH),
      );

    // Reshares this account made of other people's documents. Its own
    // documents' shares are gone with the documents, and deleting a row twice
    // is not possible here because that phase ran first.
    case 'sharesCreated':
      return await deleteBatch(ctx, 'documentShares', () =>
        ctx.db
          .query('documentShares')
          .withIndex('by_creator', (q) => q.eq('createdBy', user._id))
          .take(ACCOUNT_DELETE_BATCH),
      );

    // Not `deleteBatch`, because `groups.memberCount` is a maintained counter
    // rather than a derived one — `Groups.removeMember` decrements it, and a
    // cascade that deleted the rows underneath it would leave every group this
    // account belonged to permanently one member too high, forever, on
    // somebody else's screen.
    case 'memberships': {
      const rows = await ctx.db
        .query('groupMembers')
        .withIndex('by_user', (q) => q.eq('userId', user._id))
        .take(ACCOUNT_DELETE_BATCH);
      for (const row of rows) {
        const group = await ctx.db.get('groups', row.groupId);
        // A group this account owns is deleted whole in the next phase, so its
        // count is not worth a write.
        if (group !== null && group.ownerId !== user._id) {
          await ctx.db.patch('groups', group._id, {
            memberCount: Math.max(0, group.memberCount - 1),
            updatedAt: Date.now(),
          });
        }
        await ctx.db.delete('groupMembers', row._id);
      }
      return rows.length === ACCOUNT_DELETE_BATCH;
    }

    // Groups this account owns, which takes everybody else's membership of
    // them with it — the group is the owner's, and there is nobody left to
    // hand it to.
    case 'groups': {
      const rows = await ctx.db
        .query('groups')
        .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
        .take(ACCOUNT_DELETE_DOCUMENTS);
      for (const row of rows) {
        await Groups.remove(ctx, user, row._id);
      }
      return rows.length === ACCOUNT_DELETE_DOCUMENTS;
    }

    case 'events':
      return await deleteBatch(ctx, 'shareEvents', () =>
        ctx.db
          .query('shareEvents')
          .withIndex('by_user_and_created', (q) => q.eq('userId', user._id))
          .take(ACCOUNT_DELETE_BATCH),
      );

    // Through `Notifications.forgetDevice`, so the push component's own row
    // and this device's delivery receipts go too. A token left registered is a
    // token Expo would still accept a send against.
    case 'devices': {
      const rows = await ctx.db
        .query('deviceTokens')
        .withIndex('by_user', (q) => q.eq('userId', user._id))
        .take(ACCOUNT_DELETE_DOCUMENTS);
      for (const row of rows) {
        await Notifications.forgetDevice(ctx, row._id);
      }
      return rows.length === ACCOUNT_DELETE_DOCUMENTS;
    }

    case 'settings': {
      const sharing = await ctx.db
        .query('sharingSettings')
        .withIndex('by_user', (q) => q.eq('userId', user._id))
        .unique();
      if (sharing !== null) {
        await ctx.db.delete('sharingSettings', sharing._id);
      }
      const notifications = await ctx.db
        .query('notificationSettings')
        .withIndex('by_user', (q) => q.eq('userId', user._id))
        .unique();
      if (notifications !== null) {
        await ctx.db.delete('notificationSettings', notifications._id);
      }
      return false;
    }

    case 'done':
      await ctx.db.delete('users', user._id);
      return false;
  }
}

/**
 * Deletes one page of rows, and says whether the page was full.
 *
 * A full page means there may be more; a short one means there are not. The
 * query is re-run rather than paged with a cursor because every row it
 * returned has just been deleted, so the next call's first page is the next
 * batch.
 */
async function deleteBatch<T extends TableNames>(
  ctx: MutationCtx,
  table: T,
  read: () => Promise<Doc<T>[]>,
): Promise<boolean> {
  const rows = await read();
  for (const row of rows) {
    await ctx.db.delete(table, row._id);
  }
  return rows.length === ACCOUNT_DELETE_BATCH;
}
