import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireUser } from './model/auth';
import * as Groups from './model/groups';
import { publicGroupValidator, publicMemberValidator } from './model/groups';
import * as Notifications from './model/notifications';
import { limit } from './model/rateLimits';
import { dispatch } from './push';

/**
 * Groups.
 *
 * The same thin shape as `convex/collections.ts` — an argument contract and one
 * call into `convex/model/groups.ts`. The one thing worth noticing from out
 * here is what is *not* in this file: nothing that grants access to a document.
 * A group is a set of people. What that set can open is `documentShares`, and
 * it is resolved through membership when somebody asks, which is why adding
 * and removing people is the cheap operation it is.
 */

export const list = query({
  args: {},
  returns: v.array(publicGroupValidator),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return await Groups.listForUser(ctx, user);
  },
});

/** One group, for its own screen. Membership is required to read it. */
export const detail = query({
  args: { groupId: v.id('groups') },
  returns: v.object({
    group: publicGroupValidator,
    members: v.array(publicMemberValidator),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const { group, role } = await Groups.requireMember(ctx, user, args.groupId);
    return {
      group: Groups.toPublicGroup(group, role),
      members: await Groups.membersOf(ctx, group),
    };
  },
});

/** The documents shared into this group. Bounded, and only for members. */
export const documents = query({
  args: { groupId: v.id('groups') },
  returns: v.array(
    v.object({
      shareId: v.id('documentShares'),
      documentId: v.id('documents'),
      title: v.string(),
      pageCount: v.union(v.number(), v.null()),
      byteSize: v.number(),
      hasCover: v.boolean(),
      role: v.union(v.literal('viewer'), v.literal('annotator')),
      canDownload: v.boolean(),
      sharedBy: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await Groups.requireMember(ctx, user, args.groupId);

    const shares = await ctx.db
      .query('documentShares')
      .withIndex('by_group', (q) => q.eq('groupId', args.groupId))
      .take(100);

    const out = [];
    for (const share of shares) {
      if (share.status !== 'accepted') {
        continue;
      }
      const doc = await ctx.db.get('documents', share.documentId);
      if (doc === null) {
        continue;
      }
      const by = await ctx.db.get('users', share.createdBy);
      out.push({
        shareId: share._id,
        documentId: doc._id,
        title: doc.title,
        pageCount: doc.pageCount ?? null,
        byteSize: doc.byteSize,
        hasCover: doc.coverStorageKey !== undefined,
        role: share.role,
        canDownload: share.canDownload,
        sharedBy: by?.name ?? null,
      });
    }
    return out;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    clientOpId: v.optional(v.string()),
    clientUpdatedAt: v.optional(v.number()),
  },
  returns: v.id('groups'),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'createGroup');
    return await Groups.create(ctx, user, args);
  },
});

export const rename = mutation({
  args: {
    groupId: v.id('groups'),
    name: v.string(),
    clientUpdatedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'editGroup');
    await Groups.rename(ctx, user, args.groupId, args.name, args.clientUpdatedAt);
    return null;
  },
});

/** Deletes the group, its memberships and every share that went through it. Owner only. */
export const remove = mutation({
  args: { groupId: v.id('groups') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'editGroup');
    await Groups.remove(ctx, user, args.groupId);
    return null;
  },
});

/**
 * Adds somebody.
 *
 * They are told, because being added to a group changes what they can open —
 * quietly giving somebody access to four documents is not a thing to do
 * silently in either direction.
 */
export const addMember = mutation({
  args: { groupId: v.id('groups'), userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'editGroup');
    await Groups.addMember(ctx, user, args.groupId, args.userId);

    if (args.userId !== user._id) {
      const eventId = await Notifications.record(ctx, {
        userId: args.userId,
        kind: 'groupJoined',
        actorId: user._id,
        groupId: args.groupId,
      });
      await dispatch(ctx, eventId);
    }
    return null;
  },
});

/** Removes somebody, or lets them leave. Both are this, and differ only in who may call it. */
export const removeMember = mutation({
  args: { groupId: v.id('groups'), userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'editGroup');
    await Groups.removeMember(ctx, user, args.groupId, args.userId);
    return null;
  },
});

/** Promotes or demotes. Owner only. */
export const setRole = mutation({
  args: {
    groupId: v.id('groups'),
    userId: v.id('users'),
    role: v.union(v.literal('admin'), v.literal('member')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'editGroup');
    await Groups.setRole(ctx, user, args.groupId, args.userId, args.role);
    return null;
  },
});
