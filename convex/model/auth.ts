import { ConvexError } from 'convex/values';
import type { UserIdentity } from 'convex/server';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

/**
 * The security choke point. Every public function that touches owned data goes
 * through one of these, and no public function accepts a user id as an
 * argument — identity comes from the JWT Convex has already verified against
 * Google's JWKS, which the client cannot forge or substitute.
 */

/** Error codes the client branches on. Anything else is a genuine 500. */
export const AuthError = {
  unauthenticated: 'UNAUTHENTICATED',
  noProfile: 'NO_PROFILE',
  forbidden: 'FORBIDDEN',
  untrustedEmail: 'UNTRUSTED_EMAIL',
  /** The right type, an unusable value. Raised from `convex/model/limits.ts`. */
  invalid: 'INVALID',
} as const;

export type AuthErrorCode = (typeof AuthError)[keyof typeof AuthError];

/**
 * The caller's verified identity, or `null` when the request carries no token.
 *
 * Use this only where "signed out" is a valid answer, such as `users.me`
 * deciding what to render. Anything that reads or writes owned data wants
 * `requireIdentity`.
 */
export async function getIdentity(ctx: QueryCtx | MutationCtx): Promise<UserIdentity | null> {
  return await ctx.auth.getUserIdentity();
}

/** The caller's verified identity, or a thrown `UNAUTHENTICATED`. */
export async function requireIdentity(ctx: QueryCtx | MutationCtx): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new ConvexError({ code: AuthError.unauthenticated });
  }
  return identity;
}

/**
 * Google's `sub` claim, which is what `users.subject` is keyed on.
 *
 * `identity.subject` can arrive as the bare `sub` or as `"<issuer>|<sub>"`
 * depending on how the token was minted, so the issuer prefix is stripped to
 * keep one canonical form in the table. Rows written under one form would
 * otherwise be invisible to a lookup using the other, silently handing the same
 * person an empty library.
 */
export function subjectOf(identity: UserIdentity): string {
  const separator = identity.subject.lastIndexOf('|');
  return separator === -1 ? identity.subject : identity.subject.slice(separator + 1);
}

/** The caller's profile row, or `null` if `ensureProfile` has not run yet. */
export async function findUser(
  ctx: QueryCtx | MutationCtx,
  identity: UserIdentity,
): Promise<Doc<'users'> | null> {
  return await ctx.db
    .query('users')
    .withIndex('by_subject', (q) => q.eq('subject', subjectOf(identity)))
    .unique();
}

/**
 * The caller's profile row, or a thrown error.
 *
 * This is what owner-scoped reads and writes should call. `NO_PROFILE` means
 * the token verified but no row exists yet, which the client resolves by
 * calling `users.ensureProfile` — a different situation from being signed out,
 * and worth a different code so the client does not bounce to sign-in over it.
 */
export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<'users'>> {
  const identity = await requireIdentity(ctx);
  const user = await findUser(ctx, identity);
  if (user === null) {
    throw new ConvexError({ code: AuthError.noProfile });
  }
  return user;
}

/**
 * Asserts a document belongs to the caller.
 *
 * Every owner-scoped table carries `ownerId`, so this is the single check that
 * stands between one reader's library and another's. Reads should still go
 * through a `by_owner` index rather than fetching and then checking here; this
 * is the guard for the cases that fetch by id.
 *
 * Generic in the row type so the assertion narrows to the caller's `Doc<...>`
 * rather than to the bare `{ ownerId }` shape, which would leave every call
 * site casting the result back to what it already had.
 */
export function assertOwner<T extends { ownerId: Id<'users'> }>(
  doc: T | null,
  user: Doc<'users'>,
): asserts doc is T {
  // A missing document and someone else's document are reported identically on
  // purpose. Distinguishing them would let a caller probe which ids exist.
  if (doc === null || doc.ownerId !== user._id) {
    throw new ConvexError({ code: AuthError.forbidden });
  }
}
