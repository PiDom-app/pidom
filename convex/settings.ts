import { v } from 'convex/values';

import { notificationSettingsFields, sharingSettingsFields } from './schema';
import { mutation, query } from './_generated/server';
import { requireUser } from './model/auth';
import * as Discovery from './model/discovery';
import { SHARE_EXPIRY_MAX_MS, clamp, invalid } from './model/limits';
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

/**
 * The two settings objects, as the wire sees them.
 *
 * Derived from the table rather than written out again. The hand-written copy
 * is what broke this query: `sharingSettings` grew `defaultExpiryDays`,
 * `requireExpiry`, `allowDownloads` and `allowReshares`, the validator beside
 * it did not, and because a Convex object validator refuses an unexpected
 * field, every read of `mine` failed for every account — which took down
 * Notifications, Sharing & privacy and the share sheet together. `tsc` cannot
 * see it: the handler's return type is inferred, and TypeScript runs no
 * excess-property check on a value that is not a fresh object literal.
 *
 * `userId` and `updatedAt` come off because the model strips them — see the
 * `Omit` on `SharingSettings` in `convex/model/settings.ts`, which this now
 * mirrors by construction rather than by agreement.
 */
const {
  userId: _sharingUserId,
  updatedAt: _sharingUpdatedAt,
  ...sharingFields
} = sharingSettingsFields;
const sharingValidator = v.object(sharingFields);

const {
  userId: _notificationsUserId,
  updatedAt: _notificationsUpdatedAt,
  ...notificationFields
} = notificationSettingsFields;
const notificationsValidator = v.object(notificationFields);

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

    /**
     * `null` takes quiet hours off; a number sets one end of the window.
     *
     * Three states, for the same reason `defaultExpiryDays` above has three:
     * absent has to mean "not changing this", so that a screen can send only
     * the switch that moved. Sending `undefined` to clear cannot work — the
     * client drops an `undefined` field before the request leaves the device,
     * so the mutation arrived carrying only `utcOffsetMinutes` and quiet hours
     * could be turned on and never off.
     */
    quietStartMinute: v.optional(v.union(v.number(), v.null())),
    quietEndMinute: v.optional(v.union(v.number(), v.null())),
    utcOffsetMinutes: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'editSettings');
    const { quietStartMinute, quietEndMinute, ...rest } = args;
    await Settings.patchNotifications(ctx, user._id, {
      ...rest,
      ...cleared('quietStartMinute', quietStartMinute),
      ...cleared('quietEndMinute', quietEndMinute),
    });
    return null;
  },
});

/**
 * One end of the quiet window, in the three states the argument has.
 *
 * Absent stays absent, so the field is left out of the patch entirely and the
 * stored value is untouched. `null` becomes `undefined`, which is how
 * `ctx.db.patch` removes a column. A number is clamped into the day it is
 * supposed to name — the screen only ever offers a real minute, but this
 * mutation is public and `v.number()` would otherwise accept 4 000.
 */
function cleared<K extends 'quietStartMinute' | 'quietEndMinute'>(
  key: K,
  value: number | null | undefined,
): Partial<Record<K, number | undefined>> {
  if (value === undefined) {
    return {};
  }
  return { [key]: value === null ? undefined : clamp(value, 0, 1439) } as Record<
    K,
    number | undefined
  >;
}

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
