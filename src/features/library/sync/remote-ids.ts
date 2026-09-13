import type { Id, TableNames } from '@convex/_generated/dataModel';

/**
 * The one place a row's account id becomes a typed `Id`.
 *
 * Everything under `local/` treats ids as opaque strings and everything under
 * `convex/` types them as branded ids, so a cast has to happen somewhere. It
 * happens here, and it happens with the one check that matters: **the value
 * handed over must be a `remoteId`**, not the local id beside it.
 *
 * That distinction was invisible before this file existed, and it cost a real
 * bug. `repository/ids.ts` mints a local id in exactly the shape a Convex id
 * takes — thirty-two lowercase alphanumerics — and says so outright: *"so
 * nothing downstream can tell which of the two it is holding."* Nothing did.
 * `sendShare` translated `documentId` through `document.remoteId` and then
 * wrote `share.groupId as Id<'groups'>` on the next line, on a value the device
 * had minted itself. The account answered with an `ArgumentValidationError`,
 * which is not a `ConvexError`, so `outcome.ts` read it as `UNKNOWN` and spent
 * all eight retries over ten minutes on a call that could never succeed — with
 * the rest of the queue stuck behind it.
 *
 * A cast cannot be type-checked into correctness; what it can be is impossible
 * to write by accident. `as Id<'...'>` no longer appears anywhere in this
 * directory, so reaching for an account id means calling one of these two
 * functions, and both of them take the question "has this reached the account
 * yet?" as their first argument rather than assuming the answer.
 */

/**
 * A row's account id, or a refusal the queue knows how to wait on.
 *
 * `what` is the noun a reader would recognise, because `NotYetSynced` carries
 * it into the sync screen. Pass the `remoteId` column and nothing else.
 */
export function accountId<T extends TableNames>(what: string, remoteId: string | null): Id<T> {
  if (remoteId === null) {
    throw new NotYetSynced(what);
  }
  return remoteId as Id<T>;
}

/**
 * The same, for a row that may also simply not be here any more.
 *
 * Three outcomes rather than two, and the middle one is the reason this exists:
 * a group deleted on another device leaves shares queued against it, and those
 * operations should be dropped rather than retried for ever. `null` back means
 * "there is nothing to send"; a throw means "not yet".
 */
export function accountIdOfRow<T extends TableNames>(
  what: string,
  row: { remoteId: string | null } | null,
): Id<T> | null {
  if (row === null) {
    return null;
  }
  return accountId<T>(what, row.remoteId);
}

/** Thrown when an operation depends on a create that has not landed yet. */
export class NotYetSynced extends Error {
  constructor(what: string) {
    super(`${what} has no id in the account yet.`);
    this.name = 'NotYetSynced';
  }
}
