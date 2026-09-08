import { ConvexError, v } from 'convex/values';
import type { UserIdentity } from 'convex/server';

import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { AuthError, findUser, subjectOf } from './auth';

/**
 * What the client is allowed to see about an account.
 *
 * The `users` row is not returned raw. `_creationTime` and future internal
 * columns have no business crossing the wire, and pinning the shape here means
 * adding a column to the schema cannot leak it by accident.
 */
export type PublicProfile = {
  id: string;
  email: string;
  name: string | null;
  pictureUrl: string | null;
  createdAt: number;
};

/**
 * The same shape as a validator.
 *
 * It lives here rather than in `convex/users.ts` because it was written out
 * twice there — once on `me` and once on `ensureProfile` — and two copies of a
 * shape are two chances for one of them to fall behind `PublicProfile`.
 */
export const publicProfileValidator = v.object({
  id: v.string(),
  email: v.string(),
  name: v.union(v.string(), v.null()),
  pictureUrl: v.union(v.string(), v.null()),
  createdAt: v.number(),
});

export function toPublicProfile(user: Doc<'users'>): PublicProfile {
  return {
    id: user._id,
    email: user.email,
    name: user.name ?? null,
    pictureUrl: user.pictureUrl ?? null,
    createdAt: user.createdAt,
  };
}

/**
 * The same photo, at a size worth rendering.
 *
 * Google's OIDC `picture` claim comes back as `=s96-c`, meaning 96 device-
 * independent pixels. The account screen draws it at `h-20 w-20` — 80dp, which
 * is 240 real pixels on a three-times screen — so what shipped was a 96px image
 * upscaled two and a half times, and it looked it.
 *
 * The suffix is Google's own resizing parameter and is safe to rewrite; the
 * rest of the URL is opaque and is left alone. A URL that carries no `=s`
 * segment is returned untouched rather than guessed at, and the whole thing is
 * bounded by the claim being a string Google signed.
 */
function atSize(url: string, pixels = 240): string {
  return /=s\d+/.test(url) ? url.replace(/=s\d+/, `=s${pixels}`) : url;
}

/**
 * Creates the profile row on first sign-in, refreshes it on every later one.
 *
 * Name and picture are re-read from the token each time because Google is the
 * source of truth for both — a reader who changes their avatar there should see
 * it change here without a support ticket.
 */
export async function upsertFromIdentity(
  ctx: MutationCtx,
  identity: UserIdentity,
): Promise<Doc<'users'>> {
  const email = identity.email;

  // Google always includes `email` when the `email` scope is granted, which the
  // client requests. Reaching here without one means the scope was refused, and
  // there is no display identity to store.
  if (email === undefined) {
    throw new ConvexError({ code: AuthError.untrustedEmail });
  }

  // `email_verified` is recorded but not enforced. Some Workspace and federated
  // accounts get tokens without it, and refusing those would lock real readers
  // out over a field that is display data — ownership is `sub`, which is always
  // present and always verified.
  const emailVerified = identity.emailVerified === true;

  const now = Date.now();
  const existing = await findUser(ctx, identity);

  // Only the claims Google actually sent. Convex treats an explicit `undefined`
  // in a patch as "delete this field", so spreading the present ones is what
  // stops a token that omits `name` from wiping a name already on record.
  const claims: { name?: string; pictureUrl?: string } = {};
  if (identity.name !== undefined) {
    claims.name = identity.name;
  }
  if (identity.pictureUrl !== undefined) {
    claims.pictureUrl = atSize(identity.pictureUrl);
  }

  if (existing !== null) {
    await ctx.db.patch('users', existing._id, {
      email,
      emailVerified,
      lastSeenAt: now,
      ...claims,
    });
    const refreshed = await ctx.db.get('users', existing._id);
    if (refreshed === null) {
      throw new ConvexError({ code: AuthError.noProfile });
    }
    return refreshed;
  }

  const id = await ctx.db.insert('users', {
    subject: subjectOf(identity),
    email,
    emailVerified,
    createdAt: now,
    lastSeenAt: now,
    ...claims,
  });

  const created = await ctx.db.get('users', id);
  if (created === null) {
    throw new ConvexError({ code: AuthError.noProfile });
  }
  return created;
}
