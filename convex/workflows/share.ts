import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalMutation, internalQuery, type MutationCtx } from '../_generated/server';
import { GROUP_MEMBER_MAX, SHARE_FANOUT_BATCH } from '../model/limits';
import * as Notifications from '../model/notifications';
import { dispatch } from '../push';
import { workflow } from './document';

/**
 * Telling a group that one of its documents moved.
 *
 * **Nothing here grants anything.** A group share is one `documentShares` row
 * and access is resolved through `groupMembers` when somebody asks — so by the
 * time this runs, every member can already open the document. What is left is
 * the part that has to reach two hundred people one at a time: an event each,
 * and a push each.
 *
 * That is why it is a workflow rather than a loop in the mutation. A mutation
 * gets one second and a bounded write budget; two hundred members is two
 * hundred inserts plus two hundred pool enqueues, and a mutation that dies
 * two-thirds of the way through has told a third of a group about a document
 * with no record of which third. A workflow pages, and a step that fails is
 * retried at `SHARE_FANOUT_BATCH` rather than from the beginning.
 *
 * It reuses the extraction workflow's manager and pool deliberately: a second
 * `WorkflowManager` would be a second workpool against the free plan's twenty,
 * and these steps are cheap enough to sit behind an extraction.
 *
 * It is started with `startAsync`, and that is not a preference — see
 * `queueFanOut` at the bottom of this file.
 */
export const fanOutGroupShare = workflow.define({
  args: { shareId: v.id('documentShares') },
  // Declared for the reason `extractDocument` declares one: without it the
  // workflow's type refers to itself through `internal` and TypeScript gives up.
  returns: v.object({ told: v.number() }),
  handler: async (step, args): Promise<{ told: number }> => {
    let told = 0;
    let cursor: number | null = 0;

    while (cursor !== null) {
      const page: { told: number; next: number | null } = await step.runMutation(
        internal.workflows.share.tellSome,
        { shareId: args.shareId, after: cursor },
      );
      told += page.told;
      cursor = page.next;
    }

    return { told };
  },
});

/**
 * One page of members, told.
 *
 * `after` is an `addedAt`, which is what `by_group_and_added` orders on — a
 * cursor rather than an offset, so a member added while the fan-out is running
 * is not skipped and does not shift everybody else by one.
 *
 * Idempotent enough to retry: a duplicate event is a duplicate row in an inbox,
 * which is visible and harmless, where a lost one is silent. Between those two
 * the retry is the right side to fail on.
 */
export const tellSome = internalMutation({
  args: { shareId: v.id('documentShares'), after: v.number() },
  returns: v.object({ told: v.number(), next: v.union(v.number(), v.null()) }),
  handler: async (ctx, args) => {
    const share = await ctx.db.get('documentShares', args.shareId);
    if (share === null || share.groupId === undefined || share.status !== 'accepted') {
      // Revoked, deleted, or turned into something else between the enqueue and
      // now. Stopping is the whole response — the grant is gone, so telling
      // anybody about it would be telling them about a document they cannot open.
      return { told: 0, next: null };
    }

    const members = await ctx.db
      .query('groupMembers')
      .withIndex('by_group_and_added', (q) =>
        q.eq('groupId', share.groupId!).gt('addedAt', args.after),
      )
      .take(SHARE_FANOUT_BATCH);

    let told = 0;
    for (const member of members) {
      // The person who shared it does not need telling that they shared it.
      if (member.userId === share.createdBy) {
        continue;
      }
      const eventId = await Notifications.record(ctx, {
        userId: member.userId,
        kind: 'groupDocumentShared',
        actorId: share.createdBy,
        shareId: share._id,
        documentId: share.documentId,
        groupId: share.groupId,
      });
      await dispatch(ctx, eventId);
      told += 1;
    }

    const last = members.at(-1);
    return {
      told,
      next: members.length < SHARE_FANOUT_BATCH || last === undefined ? null : last.addedAt,
    };
  },
});

/**
 * Starts the fan-out, if there is one to start.
 *
 * Called from `sharing.createShare` after the row is committed. A direct share
 * skips it entirely — one recipient is one event, written inline, and spinning
 * up a workflow to tell one person would cost more than the telling.
 */
export async function queueFanOut(
  ctx: MutationCtx,
  shareId: Id<'documentShares'>,
): Promise<void> {
  await workflow.start(
    ctx,
    internal.workflows.share.fanOutGroupShare,
    { shareId },
    {
      // `startAsync`, for the reason `queueExtraction` uses it: without it the
      // first step runs inside the caller's transaction, and the caller is
      // `createShare` — a reader watching a button. Telling two hundred people
      // is not worth a second of that, and the grant is already committed by
      // the time this runs.
      startAsync: true,
    },
  );
}

/** How many people a group share will reach. Rendered before it is sent. */
export const groupReach = internalQuery({
  args: { groupId: v.id('groups') },
  returns: v.number(),
  handler: async (ctx, args) => {
    const members = await ctx.db
      .query('groupMembers')
      .withIndex('by_group_and_added', (q) => q.eq('groupId', args.groupId))
      .take(GROUP_MEMBER_MAX);
    return members.length;
  },
});
