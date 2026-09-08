import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { findUser, getIdentity, requireIdentity, requireUser } from './model/auth';
import { cleanText, DISPLAY_NAME_MAX } from './model/limits';
import { limit } from './model/rateLimits';
import { publicProfileValidator, toPublicProfile, upsertFromIdentity } from './model/users';

/**
 * The account API.
 *
 * Both functions are deliberately thin: the work lives in `convex/model`, and
 * what is left here is the argument contract and the call. That keeps the
 * public surface small enough to audit in one read — which matters, because
 * anything exported from a non-`internal` file can be called by anyone with the
 * deployment URL.
 *
 * Neither takes a user id. There is no argument a caller could set to read
 * somebody else's account.
 */

/**
 * The signed-in account, or `null`.
 *
 * `null` covers both "no token" and "token verified but no row yet", because
 * the shell renders the same thing for each and a query is not the place to
 * throw over an expected state.
 */
export const me = query({
  args: {},
  returns: v.union(v.null(), publicProfileValidator),
  handler: async (ctx) => {
    const identity = await getIdentity(ctx);
    if (identity === null) {
      return null;
    }
    const user = await findUser(ctx, identity);
    return user === null ? null : toPublicProfile(user);
  },
});

/**
 * Creates the account on first sign-in, refreshes name and picture after that.
 *
 * The client calls this once per authenticated launch. It is idempotent, so a
 * retry after a dropped connection costs a write and nothing else.
 *
 * The bucket is spent *after* the row exists rather than before, and that order
 * is the whole difficulty: `limit` is keyed on the profile's id, and on a first
 * sign-in there is no profile to key on. So the write happens, then the token is
 * spent — which means the very first call of a new account is always allowed and
 * every call after it is metered. That is the right way round. Refusing the
 * first one would refuse the account itself.
 */
export const ensureProfile = mutation({
  args: {},
  returns: publicProfileValidator,
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const user = await upsertFromIdentity(ctx, identity);
    await limit(ctx, user, 'ensureProfile');
    return toPublicProfile(user);
  },
});

/**
 * The two things about an account its owner gets to choose.
 *
 * **A display name**, bounded and trimmed like every other free string in this
 * deployment, and flagged so the next sign-in stops overwriting it. Sending an
 * empty one gives the Google claim back — an undo rather than a blank name,
 * because a share row reading "shared by" and nothing else is worse than one
 * carrying a name the reader did not type.
 *
 * **Whether the photo shows at all.** There is deliberately no field for an
 * arbitrary photo URL. A string the reader supplies and this deployment then
 * renders on *other people's* screens is a tracking pixel with a profile
 * around it, and it buys nothing: the photo people expect is the one on the
 * account they signed in with.
 *
 * The email address is not here, and neither is the handle. One is Google's and
 * one has its own mutation with its own bucket, because claiming a handle is
 * how the namespace is probed.
 */
export const updateProfile = mutation({
  args: {
    displayName: v.optional(v.string()),
    showPhoto: v.optional(v.boolean()),
  },
  returns: publicProfileValidator,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'editSettings');

    const patch: {
      name?: string;
      nameIsCustom?: boolean;
      photoHidden?: boolean;
    } = {};

    if (args.displayName !== undefined) {
      const trimmed = args.displayName.trim();
      if (trimmed === '') {
        // Back to Google's. The claim is re-read on the next sign-in, and
        // until then the name already on the row is the one it sent.
        patch.nameIsCustom = false;
      } else {
        patch.name = cleanText(trimmed, DISPLAY_NAME_MAX, 'display name');
        patch.nameIsCustom = true;
      }
    }
    if (args.showPhoto !== undefined) {
      patch.photoHidden = !args.showPhoto;
    }

    await ctx.db.patch('users', user._id, patch);
    const updated = await ctx.db.get('users', user._id);
    if (updated === null) {
      throw new Error('profile disappeared mid-update');
    }
    return toPublicProfile(updated);
  },
});
