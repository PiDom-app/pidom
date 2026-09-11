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
  // The id comes back so the client knows which of the rows in `devices` is
  // the handset it is running on. It is not a secret — it addresses a row this
  // account already owns — and it is the only thing that lets the settings
  // screen say "This device" without the token ever coming back out.
  returns: v.id('deviceTokens'),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'registerDevice');
    const deviceId = await Notifications.registerDevice(ctx, user, args);
    // The row first, then the component — the id it is addressed by is the
    // row's, so the row has to exist before it can be recorded.
    await Notifications.recordWithComponent(ctx, deviceId);
    return deviceId;
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
  // Addressed by row id rather than by token, so a reader can mute the tablet
  // in the other room from the phone in their hand. `devices` returns ids and
  // never tokens, which is what makes that safe to expose.
  args: { deviceId: v.id('deviceTokens'), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'registerDevice');

    const device = await ctx.db.get('deviceTokens', args.deviceId);
    // Somebody else's device is skipped rather than refused, for the same
    // reason `markEventsRead` skips: a stale client should not be told whose
    // it is.
    if (device === null || device.userId !== user._id) {
      return null;
    }
    await ctx.db.patch('deviceTokens', args.deviceId, { enabled: args.enabled });
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
