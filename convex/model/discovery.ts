import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  DISCOVERY_LIMIT,
  DISCOVERY_PREFIX_MIN,
  GROUP_MEMBER_MAX,
  HANDLE_MAX,
  HANDLE_MIN,
  HANDLE_PATTERN,
  invalid,
} from './limits';
import { isFindableBy } from './settings';

/**
 * Finding a person, without publishing a directory.
 *
 * This is the widest-reaching read in the application: it is the one query
 * whose subject is somebody other than the caller. Two things shape it, and
 * both are constraints rather than preferences.
 *
 * **A Convex query cannot be rate limited.** Spending a token is a write and a
 * query cannot write, so there is no bound to put on a search endpoint — which
 * means a prefix index over `users.name` would be an enumeration of every
 * account in the deployment, walkable one letter at a time, with nothing in
 * front of it. That index does not exist and is not going to.
 *
 * **So finding is a lookup.** An exact handle or an exact email address returns
 * one row or none. Neither is enumerable: a handle is a name somebody chose to
 * be found by, and an address is something the caller already had. Prefix
 * matching does exist — over people the caller already shares a group with,
 * where the set is their own graph rather than the deployment.
 *
 * **And what comes back is fixed.** `toPublicProfile` is the only projection.
 * It carries a name, a handle and a picture, and it carries them whatever the
 * search matched on — so looking somebody up by an address you already have
 * tells you nothing you did not already know.
 */

/** Everything sharing will say about somebody who is not the caller. */
export type PublicProfile = {
  id: Id<'users'>;
  displayName: string;
  handle: string | null;
  pictureUrl: string | null;
};

export const publicProfileValidator = v.object({
  id: v.id('users'),
  displayName: v.string(),
  handle: v.union(v.string(), v.null()),
  pictureUrl: v.union(v.string(), v.null()),
});

/**
 * The projection, and the only one.
 *
 * `email` is absent and that is the point of the function existing rather than
 * each caller picking fields. `subject` is absent for the same reason it never
 * appears anywhere else: it is Google's identifier for this account, and it is
 * the one string that would let somebody correlate a Pidom account with another
 * application's.
 *
 * A person who has set no name falls back to their handle, and then to a fixed
 * word. Never to their email — the fallback is where a projection like this
 * usually leaks.
 */
export function toPublicProfile(user: Doc<'users'>): PublicProfile {
  return {
    id: user._id,
    displayName: user.name ?? (user.handle === undefined ? 'Someone' : `@${user.handle}`),
    handle: user.handle ?? null,
    pictureUrl: user.pictureUrl ?? null,
  };
}

/**
 * Normalises a handle, or refuses it.
 *
 * Lowercased before the pattern is applied, so `Amina` and `amina` cannot both
 * be claimed — a directory in which two entries differ by case is a directory
 * built for impersonation. The pattern is narrower than the length limit on
 * purpose: no dots, no hyphens, no Unicode, so two handles cannot differ by a
 * character nobody can see.
 */
export function cleanHandle(raw: string): string {
  const handle = raw.trim().replace(/^@/, '').toLowerCase();
  if (handle.length < HANDLE_MIN) {
    invalid(`A handle needs at least ${HANDLE_MIN} characters.`);
  }
  if (handle.length > HANDLE_MAX) {
    invalid(`A handle can be at most ${HANDLE_MAX} characters.`);
  }
  if (!HANDLE_PATTERN.test(handle)) {
    invalid('A handle can use lowercase letters, digits and underscores.');
  }
  return handle;
}

/**
 * Takes a handle for this account, if nobody else has it.
 *
 * The uniqueness check and the write are in one mutation, which is what makes
 * it safe: Convex runs a mutation as a transaction, so two people claiming the
 * same handle at once do not both win — the second one's read set has changed
 * underneath it and it re-runs.
 */
export async function claimHandle(
  ctx: MutationCtx,
  user: Doc<'users'>,
  raw: string,
): Promise<string> {
  const handle = cleanHandle(raw);
  if (user.handle === handle) {
    return handle;
  }
  const taken = await ctx.db
    .query('users')
    .withIndex('by_handle', (q) => q.eq('handle', handle))
    .unique();
  if (taken !== null) {
    invalid('That handle is taken.');
  }
  await ctx.db.patch('users', user._id, { handle });
  return handle;
}

/**
 * The account at exactly this handle or address, if the caller may see it.
 *
 * One row or none, whichever form the term took. A term that looks like
 * neither returns nothing rather than falling through to a scan.
 *
 * The `findableBy` check runs after the lookup and before the return, and a
 * refusal is an empty result rather than an error — an error would say "that
 * account exists but will not talk to you", which is the fact the setting is
 * there to withhold.
 */
export async function lookupExact(
  ctx: QueryCtx | MutationCtx,
  caller: Doc<'users'>,
  term: string,
): Promise<PublicProfile[]> {
  const trimmed = term.trim();
  if (trimmed === '') {
    return [];
  }

  const found = trimmed.includes('@') && !trimmed.startsWith('@')
    ? await ctx.db
        .query('users')
        .withIndex('by_email', (q) => q.eq('email', trimmed.toLowerCase()))
        .unique()
    : await handleLookup(ctx, trimmed);

  if (found === null || found._id === caller._id) {
    return [];
  }
  return (await isFindableBy(ctx, found, caller)) ? [toPublicProfile(found)] : [];
}

/** The handle branch, kept separate so a malformed handle is empty rather than thrown. */
async function handleLookup(
  ctx: QueryCtx | MutationCtx,
  term: string,
): Promise<Doc<'users'> | null> {
  const handle = term.replace(/^@/, '').toLowerCase();
  if (!HANDLE_PATTERN.test(handle) || handle.length < HANDLE_MIN || handle.length > HANDLE_MAX) {
    return null;
  }
  return await ctx.db
    .query('users')
    .withIndex('by_handle', (q) => q.eq('handle', handle))
    .unique();
}

/**
 * People in the caller's own groups whose name starts with this.
 *
 * The only prefix search in the application, and it is not an index — it is a
 * walk of the caller's memberships followed by a filter in memory. That sounds
 * worse than a search index and is much better: the set it can ever return is
 * the caller's own graph, so there is nothing here to enumerate that they
 * cannot already see by opening their groups.
 *
 * It is bounded twice over — memberships, then members per group — and it
 * de-duplicates, because somebody in three of the caller's groups is one
 * person and three rows.
 */
export async function searchWithinGraph(
  ctx: QueryCtx | MutationCtx,
  caller: Doc<'users'>,
  prefix: string,
): Promise<PublicProfile[]> {
  const needle = prefix.trim().toLowerCase();
  if (needle.length < DISCOVERY_PREFIX_MIN) {
    return [];
  }

  const memberships = await ctx.db
    .query('groupMembers')
    .withIndex('by_user', (q) => q.eq('userId', caller._id))
    .take(DISCOVERY_LIMIT * 2);

  const seen = new Set<string>([caller._id]);
  const out: PublicProfile[] = [];

  for (const membership of memberships) {
    if (out.length >= DISCOVERY_LIMIT) {
      break;
    }
    const peers = await ctx.db
      .query('groupMembers')
      .withIndex('by_group_and_added', (q) => q.eq('groupId', membership.groupId))
      .take(GROUP_MEMBER_MAX);

    for (const peer of peers) {
      if (out.length >= DISCOVERY_LIMIT || seen.has(peer.userId)) {
        continue;
      }
      seen.add(peer.userId);
      const person = await ctx.db.get('users', peer.userId);
      if (person === null || !matches(person, needle)) {
        continue;
      }
      // Still gated: being in a group with somebody does not override their
      // having turned discovery off, it only satisfies the `groups` setting.
      if (await isFindableBy(ctx, person, caller)) {
        out.push(toPublicProfile(person));
      }
    }
  }
  return out;
}

/** Prefix on either the display name or the handle. Never on the email. */
function matches(user: Doc<'users'>, needle: string): boolean {
  const name = user.name?.toLowerCase() ?? '';
  const handle = user.handle ?? '';
  return name.startsWith(needle) || handle.startsWith(needle) || name.includes(` ${needle}`);
}

/**
 * The profile of somebody the caller already has a relationship with.
 *
 * Used by every list that renders a name beside a row — who shared this, who
 * has access, who is in this group. It does **not** go through `isFindableBy`:
 * being unfindable stops somebody appearing in a search, and cannot retroactively
 * blank out the name on a document they shared with you last week.
 */
export async function profileOf(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
): Promise<PublicProfile | null> {
  const user = await ctx.db.get('users', userId);
  return user === null ? null : toPublicProfile(user);
}
