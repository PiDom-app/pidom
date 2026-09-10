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
    const { group, role, muted } = await Groups.requireMember(ctx, user, args.groupId);
    return {
      group: Groups.toPublicGroup(group, role, muted),
      members: await Groups.membersOf(ctx, group),
    };
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

/**
 * The group's own settings. Owner or admin.
 *
 * One mutation for seven values rather than seven mutations, because they are
 * one screen and they share a bucket. Each is enforced somewhere real:
 * `whoCanAdd` in `Groups.addMember`, `whoCanShare` and the two defaults in
 * `Sharing.create`, `showMemberHandles` in `Groups.membersOf`, `showPresence`
 * in `presence.heartbeat`. A switch wired to nothing is worse than no switch.
 */
export const updateSettings = mutation({
  args: {
    groupId: v.id('groups'),
    description: v.optional(v.string()),
    whoCanAdd: v.optional(v.union(v.literal('owner'), v.literal('admins'), v.literal('members'))),
    whoCanShare: v.optional(v.union(v.literal('admins'), v.literal('members'))),
    defaultRole: v.optional(v.union(v.literal('viewer'), v.literal('annotator'))),
    defaultCanDownload: v.optional(v.boolean()),
    showMemberHandles: v.optional(v.boolean()),
    showPresence: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'editGroup');
    const { groupId, ...patch } = args;
    await Groups.updateSettings(ctx, user, groupId, patch);
    return null;
  },
});

/**
 * Mute this group, for the caller and nobody else.
 *
 * Any member, not just an administrator: it decides what reaches their phone
 * rather than anything about the group. `editSettings` rather than `editGroup`
 * for the same reason — it is a preference, and it is metered like one.
 */
export const setMuted = mutation({
  args: { groupId: v.id('groups'), muted: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'editSettings');
    await Groups.setMuted(ctx, user, args.groupId, args.muted);
    return null;
  },
});
