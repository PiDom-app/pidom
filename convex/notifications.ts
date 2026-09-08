import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireUser } from './model/auth';
import { DEVICE_TOKENS_PER_USER } from './model/limits';
import * as Notifications from './model/notifications';
import { limit } from './model/rateLimits';

/**
 * Devices, and the count on the Shared row.
 *
 * The one rule worth restating here: **a push token never comes back out.** It
 * identifies a handset to a third party, it is cycled by the operating system,
 * and there is nothing a client could do with one that it could not do by
 * registering again. `devices` returns what a settings screen needs to tell two
 * phones apart and nothing that could be sent to either.
 */

export const registerDevice = mutation({
  args: {
    token: v.string(),
    platform: v.union(v.literal('ios'), v.literal('android')),
    deviceName: v.optional(v.string()),
    appVersion: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'registerDevice');
    await Notifications.registerDevice(ctx, user, args);
    return null;
  },
});

/**
 * Stops this device receiving, without forgetting it.
 *
 * Turning notifications off in Pidom should not require the operating system's
 * permission dance again when they are turned back on, so this flips `enabled`
 * rather than deleting the row. A delete means the token is dead, and only the
 * receipt poll gets to decide that.
 */
export const setDeviceEnabled = mutation({
  args: { token: v.string(), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'registerDevice');

    const device = await ctx.db
      .query('deviceTokens')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .unique();
    // Somebody else's token is skipped rather than refused, for the same reason
    // `markEventsRead` skips: a stale client should not be told whose it is.
    if (device === null || device.userId !== user._id) {
      return null;
    }
    await ctx.db.patch('deviceTokens', device._id, { enabled: args.enabled });
    return null;
  },
});

export const devices = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id('deviceTokens'),
      platform: v.union(v.literal('ios'), v.literal('android')),
      deviceName: v.union(v.string(), v.null()),
      enabled: v.boolean(),
      lastSeenAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query('deviceTokens')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .take(DEVICE_TOKENS_PER_USER);
    return rows.map((row) => ({
      id: row._id,
      platform: row.platform,
      deviceName: row.deviceName ?? null,
      enabled: row.enabled,
      lastSeenAt: row.lastSeenAt,
    }));
  },
});

/** Forgets one device. The reader's own, and only theirs. */
export const forgetDevice = mutation({
  args: { deviceId: v.id('deviceTokens') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'registerDevice');
    const device = await ctx.db.get('deviceTokens', args.deviceId);
    if (device === null || device.userId !== user._id) {
      return null;
    }
    await Notifications.forgetDevice(ctx, args.deviceId);
    return null;
  },
});

/**
 * How many events this reader has not looked at.
 *
 * Read by the home screen, so it goes through `by_user_and_read` rather than
 * counting a list — an unread badge that reads the whole history to render is
 * an unread badge that gets slower the longer somebody uses the app.
 */
export const unreadCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const unread = await ctx.db
      .query('shareEvents')
      .withIndex('by_user_and_read', (q) => q.eq('userId', user._id).eq('readAt', undefined))
      .take(50);
    return unread.length;
  },
});
