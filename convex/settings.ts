import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireUser } from './model/auth';
import * as Discovery from './model/discovery';
import { SHARE_EXPIRY_MAX_MS, invalid } from './model/limits';
import { limit } from './model/rateLimits';
import * as Settings from './model/settings';

/**
 * What an account has said about being reached, and about being told.
 *
 * A row is written the first time something changes; until then the defaults in
 * `convex/model/settings.ts` answer. That is why the read below never returns
 * `null` — a reader who has never opened this screen has settings, they simply
 * do not have a row.
 *
 * Nothing here is a security control on its own. Every one of these values is
 * read again by the function it governs, at the moment it governs it: hiding a
 * download button is a convenience, and `requireDownloadable` is the rule.
 */

const sharingValidator = v.object({
  findableBy: v.union(v.literal('anyone'), v.literal('groups'), v.literal('nobody')),
  shareableBy: v.union(v.literal('anyone'), v.literal('groups'), v.literal('nobody')),
  defaultRole: v.union(v.literal('viewer'), v.literal('annotator')),
  defaultCanDownload: v.boolean(),
  defaultCanReshare: v.boolean(),
  showOnlineStatus: v.boolean(),
  showReadingActivity: v.boolean(),
  allowGroupInvites: v.boolean(),
});

const notificationsValidator = v.object({
  allow: v.boolean(),
  documentShares: v.boolean(),
  shareResponses: v.boolean(),
  groupActivity: v.boolean(),
  annotationActivity: v.boolean(),
  quietStartMinute: v.optional(v.number()),
  quietEndMinute: v.optional(v.number()),
  utcOffsetMinutes: v.optional(v.number()),
});

export const mine = query({
  args: {},
  returns: v.object({
    sharing: sharingValidator,
    notifications: notificationsValidator,
    handle: v.union(v.string(), v.null()),
  }),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return {
      sharing: await Settings.sharingOf(ctx, user._id),
      notifications: await Settings.notificationsOf(ctx, user._id),
      handle: user.handle ?? null,
    };
  },
});

/**
 * Changes some of the sharing settings.
 *
 * Every field optional, so a screen sends the switch that moved rather than the
 * whole object — two screens racing on one row then disagree about one value
 * instead of about all of them.
 */
export const updateSharing = mutation({
  args: {
    findableBy: v.optional(v.union(v.literal('anyone'), v.literal('groups'), v.literal('nobody'))),
    shareableBy: v.optional(v.union(v.literal('anyone'), v.literal('groups'), v.literal('nobody'))),
    defaultRole: v.optional(v.union(v.literal('viewer'), v.literal('annotator'))),
    defaultCanDownload: v.optional(v.boolean()),
    defaultCanReshare: v.optional(v.boolean()),
    showOnlineStatus: v.optional(v.boolean()),
    showReadingActivity: v.optional(v.boolean()),
    allowGroupInvites: v.optional(v.boolean()),

    /**
     * `null` takes a default expiry off; a number sets one, in days.
     *
     * Three states, because absent has to mean "not changing this" — these
     * mutations take every field optionally so a screen can send only the
     * switch that moved, and without the null there would be no way to express
     * "no end" once a default had been chosen.
     */
    defaultExpiryDays: v.optional(v.union(v.number(), v.null())),
    requireExpiry: v.optional(v.boolean()),
    allowDownloads: v.optional(v.boolean()),
    allowReshares: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'editSettings');
    const { defaultExpiryDays, ...rest } = args;
    await Settings.patchSharing(ctx, user._id, {
      ...rest,
      ...(defaultExpiryDays === undefined
        ? {}
        : {
            defaultExpiryDays:
              defaultExpiryDays === null ? undefined : cleanExpiryDays(defaultExpiryDays),
          }),
    });
    return null;
  },
});

/**
 * A default expiry, in whole days, inside the bound a share can actually take.
 *
 * The same ceiling `cleanExpiry` applies to a share, expressed in the unit this
 * setting is chosen in. A default outside what a share may be would be a
 * setting that produces a refusal every time it is used.
 */
function cleanExpiryDays(days: number): number {
  if (!Number.isFinite(days)) {
    invalid('That is not a number of days.');
  }
  return Math.min(Math.max(1, Math.round(days)), Math.floor(SHARE_EXPIRY_MAX_MS / 86_400_000));
}

export const updateNotifications = mutation({
  args: {
    allow: v.optional(v.boolean()),
    documentShares: v.optional(v.boolean()),
    shareResponses: v.optional(v.boolean()),
    groupActivity: v.optional(v.boolean()),
    annotationActivity: v.optional(v.boolean()),
    quietStartMinute: v.optional(v.number()),
    quietEndMinute: v.optional(v.number()),
    utcOffsetMinutes: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'editSettings');
    await Settings.patchNotifications(ctx, user._id, args);
    return null;
  },
});

/**
 * Takes a handle.
 *
 * The narrowest bucket in `rateLimits.ts`, and not because it is expensive: a
 * handle lookup is how one account finds another, so an unmetered claim is an
 * unmetered probe of which handles are taken.
 */
export const setHandle = mutation({
  args: { handle: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'setHandle');
    return await Discovery.claimHandle(ctx, user, args.handle);
  },
});
