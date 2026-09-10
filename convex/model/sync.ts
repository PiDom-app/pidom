import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

/**
 * What a backend written for request and response needs before a client is
 * allowed to send the same thing twice.
 *
 * Pidom's device is offline-first now: a reader's changes are written to the
 * phone and put in a queue, and the queue drains whenever there is a
 * connection. That turns two assumptions this backend used to be able to make
 * into things it has to defend against.
 *
 * **A create can arrive twice.** Not because the client is careless — because
 * the reply can be lost after the write committed, and a queue that does not
 * retry in that case loses the operation instead. So the three creates a device
 * can queue each carry an id the device minted, and each looks it up before
 * inserting. See `documents.localId`, `documentAnnotations.clientOpId` and
 * `collections.clientOpId`.
 *
 * **A write can arrive late.** An operation queued at nine and delivered at
 * five stamps the server clock at five, and silently wins against a change made
 * from another device at four. So every write that *overwrites* rather than
 * accumulates carries the device's clock and is compared against the last one
 * stored.
 *
 * The clocks are not synchronised and cannot be. Two devices whose clocks
 * disagree by an hour will resolve a conflict wrongly, and that is a smaller
 * and rarer harm than the alternative — which is that the slower device always
 * wins, every time, by arriving last.
 */

/**
 * Whether an incoming write is older than what is stored.
 *
 * Absent on either side means apply it: a client that sends no clock is an
 * older client and not a wrong one, and a row with no clock has never been
 * written by a client that had one. Equal timestamps apply too — a tie is not
 * a conflict, and refusing one would drop a legitimate write from a device that
 * simply wrote twice in the same millisecond.
 */
export function isStale(stored: number | undefined, incoming: number | undefined): boolean {
  if (incoming === undefined || stored === undefined) {
    return false;
  }
  return incoming < stored;
}

/**
 * The `clientUpdatedAt` half of a patch.
 *
 * Spread rather than assigned, for the reason every optional in this backend
 * is: Convex reads an explicit `undefined` in a patch as "delete this field",
 * so a client that stops sending a clock would erase the one already stored and
 * make the next stale write win.
 */
export function clientClock(incoming: number | undefined): { clientUpdatedAt?: number } {
  return incoming === undefined ? {} : { clientUpdatedAt: incoming };
}

/**
 * A document this device has already imported, if it has.
 *
 * Looked up on `localId` first, which is what a device that minted its own id
 * sends. Falling back to the id itself covers every document imported before
 * the device minted ids: the client adopted the Convex id as its local one, so
 * the two are the same string and a queued retry names a row that is already
 * there under `_id`.
 */
export async function documentByLocalId(
  ctx: QueryCtx,
  owner: Doc<'users'>,
  localId: string,
): Promise<Doc<'documents'> | null> {
  const byLocal = await ctx.db
    .query('documents')
    .withIndex('by_owner_and_local', (q) => q.eq('ownerId', owner._id).eq('localId', localId))
    .unique();

  if (byLocal !== null) {
    return byLocal;
  }

  // `ctx.db.get` on a string that is not a valid id throws rather than
  // answering null, and a client-minted id is not a Convex id — so this is only
  // asked when the shape could be one.
  const normalized = ctx.db.normalizeId('documents', localId);
  if (normalized === null) {
    return null;
  }

  const byId = await ctx.db.get('documents', normalized);
  return byId !== null && byId.ownerId === owner._id ? byId : null;
}

/** The same lookup for the two tables that carry a `clientOpId`. */
export async function annotationByOpId(
  ctx: QueryCtx,
  owner: Doc<'users'>,
  clientOpId: string,
): Promise<Doc<'documentAnnotations'> | null> {
  return await ctx.db
    .query('documentAnnotations')
    .withIndex('by_owner_and_op', (q) => q.eq('ownerId', owner._id).eq('clientOpId', clientOpId))
    .unique();
}

export async function collectionByOpId(
  ctx: QueryCtx,
  owner: Doc<'users'>,
  clientOpId: string,
): Promise<Doc<'collections'> | null> {
  return await ctx.db
    .query('collections')
    .withIndex('by_owner_and_op', (q) => q.eq('ownerId', owner._id).eq('clientOpId', clientOpId))
    .unique();
}

/**
 * The device's id for a document, as this backend should record it.
 *
 * Bounded and checked for the same reason `cleanFingerprint` is: it goes into
 * an index, and a client should not be able to put an arbitrary string there.
 * Thirty-two hexadecimal characters is what `repository/ids.ts` mints; a Convex
 * id is what every device that predates it sends.
 */
export function isLocalId(value: string): boolean {
  return /^[a-z0-9]{16,64}$/.test(value);
}

/** Marks a row as belonging to a device's create, for the retry that follows. */
export function localIdField(localId: string | undefined): { localId?: string } {
  return localId === undefined ? {} : { localId };
}
