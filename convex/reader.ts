import { v } from 'convex/values';

import { readerPreferencesFields } from './schema';
import { mutation, query } from './_generated/server';
import { requireUser } from './model/auth';
import * as Reader from './model/reader';
import { limit } from './model/rateLimits';

/**
 * How this account likes to read.
 *
 * A thin argument contract over `convex/model/reader.ts`, the way `library.ts`
 * is over its model. Every function derives the owner from the verified JWT and
 * takes no user id, so there is no argument a caller can set to read or write
 * somebody else's preferences.
 *
 * A row is written the first time something changes; until then the defaults in
 * the model answer, which is why `mine` never returns `null`.
 */

/**
 * The preferences as the wire sees them, derived from the table rather than
 * written out again.
 *
 * `userId`, `updatedAt` and `clientUpdatedAt` come off because the model strips
 * them — see `ReaderPreferences` in `convex/model/reader.ts`, which this mirrors
 * by construction. Building the validator from a hand-written copy is exactly
 * what broke `settings.mine`: a field added to the table and forgotten beside it
 * makes a Convex object validator reject every read. One list, no drift.
 */
const {
  userId: _userId,
  updatedAt: _updatedAt,
  clientUpdatedAt: _clientUpdatedAt,
  ...preferenceFields
} = readerPreferencesFields;
const preferencesValidator = v.object(preferenceFields);

export const mine = query({
  args: {},
  returns: preferencesValidator,
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return await Reader.preferencesOf(ctx, user._id);
  },
});

/**
 * Changes some of the reader preferences.
 *
 * Every field optional, so a settings screen sends the control that moved rather
 * than the whole object — two screens racing on one row then disagree about one
 * value instead of about all of them. `clientUpdatedAt` rides along so a change
 * queued on a device that was offline does not overwrite a newer one made
 * elsewhere; the staleness rule is applied in `patchPreferences`.
 */
export const update = mutation({
  args: {
    defaultViewMode: v.optional(preferenceFields.defaultViewMode),
    pageScaling: v.optional(preferenceFields.pageScaling),
    pageSpacing: v.optional(preferenceFields.pageSpacing),
    documentBackground: v.optional(preferenceFields.documentBackground),
    pageDirection: v.optional(preferenceFields.pageDirection),
    toolbarBehavior: v.optional(preferenceFields.toolbarBehavior),
    sidebarBehavior: v.optional(preferenceFields.sidebarBehavior),
    restorePosition: v.optional(preferenceFields.restorePosition),
    pageNavigation: v.optional(preferenceFields.pageNavigation),
    clientUpdatedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    // The same bucket the sharing and notification settings spend — every one of
    // these is a switch somebody flipped, and a reader going through the screen
    // once flips a handful in a minute.
    await limit(ctx, user, 'editSettings');
    const { clientUpdatedAt, ...patch } = args;
    await Reader.patchPreferences(ctx, user._id, patch, clientUpdatedAt);
    return null;
  },
});
