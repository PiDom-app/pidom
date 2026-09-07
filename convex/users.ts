import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { findUser, getIdentity, requireIdentity } from './model/auth';
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
