import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { SWEEP_LIMIT } from './limits';

/**
 * What an account is using, counted once and then kept.
 *
 * `library.usage` renders one line on the settings screen and the two caveats
 * under a search result. It used to answer by reading up to two thousand
 * document rows — and it is a *reactive* query, so every favourite toggle,
 * every page turn and every sync tick re-ran the whole scan on every device the
 * account had open. It was the largest read in the app that nobody had asked
 * for, and it grew with the library rather than with what the screen showed.
 *
 * So the four numbers are maintained instead of derived. Four is the entire
 * surface: whether a document has a cloud copy, how big that copy is, and
 * whether it turned out to be a scan. Each is written by the handful of
 * mutations that can change it.
 *
 * Kept honest by `recount`, which the nightly pass runs over a few accounts at
 * a time. Incremental counters drift — a mutation added later that forgets to
 * call `apply`, a crash between two patches — and a number that drifts with no
 * way back is worse than a scan. This way the worst case is a figure that is
 * briefly wrong on a screen that shows it to one person.
 */

/** The shape both the query and the stored field use. */
export type Usage = {
  syncedCount: number;
  syncedBytes: number;
  localOnlyCount: number;
  scanCount: number;
};

/**
 * The four fields of a document that any of this depends on.
 *
 * Narrower than `Doc<'documents'>` so a caller can pass what it is about to
 * insert rather than reading the row back to hand it over — and so the compiler
 * says something when a fifth field starts mattering.
 */
export type Counted = Pick<Doc<'documents'>, 'ownerId' | 'byteSize' | 'storageKey' | 'textStatus'>;

const ZERO: Usage = { syncedCount: 0, syncedBytes: 0, localOnlyCount: 0, scanCount: 0 };

/** How one document counts, in the four numbers. Nothing else decides this. */
function contribution(doc: Counted): Usage {
  if (doc.storageKey === undefined) {
    return { ...ZERO, localOnlyCount: 1 };
  }
  return {
    syncedCount: 1,
    syncedBytes: doc.byteSize,
    localOnlyCount: 0,
    scanCount: doc.textStatus === 'none' ? 1 : 0,
  };
}

/** Applies a delta to the stored counters, never letting one go negative. */
async function shift(ctx: MutationCtx, ownerId: Id<'users'>, delta: Usage): Promise<void> {
  const user = await ctx.db.get('users', ownerId);
  if (user === null) {
    return;
  }
  // An account that has never been counted is left uncounted. Applying a delta
  // to an assumed zero would invent a total — `read` scans in that case, and
  // the nightly pass fills it in properly.
  const current = user.usage;
  if (current === undefined) {
    return;
  }
  await ctx.db.patch('users', user._id, {
    usage: {
      syncedCount: Math.max(0, current.syncedCount + delta.syncedCount),
      syncedBytes: Math.max(0, current.syncedBytes + delta.syncedBytes),
      localOnlyCount: Math.max(0, current.localOnlyCount + delta.localOnlyCount),
      scanCount: Math.max(0, current.scanCount + delta.scanCount),
      countedAt: current.countedAt,
    },
  });
}

/** A document joined the library. */
export async function added(ctx: MutationCtx, doc: Counted): Promise<void> {
  await shift(ctx, doc.ownerId, contribution(doc));
}

/** A document left it. */
export async function removed(ctx: MutationCtx, doc: Counted): Promise<void> {
  const gone = contribution(doc);
  await shift(ctx, doc.ownerId, {
    syncedCount: -gone.syncedCount,
    syncedBytes: -gone.syncedBytes,
    localOnlyCount: -gone.localOnlyCount,
    scanCount: -gone.scanCount,
  });
}

/**
 * A document changed in one of the ways that counts.
 *
 * Takes both versions rather than a description of the change, so a caller
 * cannot get the arithmetic wrong — gaining a cloud copy is a `localOnlyCount`
 * down *and* a `syncedCount` up, and being told only "it synced" loses half of
 * that. Pass the row as it was and the fields being patched onto it.
 */
export async function changed(
  ctx: MutationCtx,
  before: Counted,
  patch: Partial<Counted>,
): Promise<void> {
  const after = { ...before, ...patch };
  const from = contribution(before);
  const to = contribution(after);
  if (
    from.syncedCount === to.syncedCount &&
    from.syncedBytes === to.syncedBytes &&
    from.localOnlyCount === to.localOnlyCount &&
    from.scanCount === to.scanCount
  ) {
    return;
  }
  await shift(ctx, before.ownerId, {
    syncedCount: to.syncedCount - from.syncedCount,
    syncedBytes: to.syncedBytes - from.syncedBytes,
    localOnlyCount: to.localOnlyCount - from.localOnlyCount,
    scanCount: to.scanCount - from.scanCount,
  });
}

/**
 * The counters, scanning once if this account has never been counted.
 *
 * The fallback is the same scan the query used to do on every render, and it
 * happens at most once per account — `recount` writes the result, so the next
 * read is a field on a row already loaded.
 */
export async function read(ctx: QueryCtx, user: Doc<'users'>): Promise<Usage> {
  if (user.usage !== undefined) {
    const { syncedCount, syncedBytes, localOnlyCount, scanCount } = user.usage;
    return { syncedCount, syncedBytes, localOnlyCount, scanCount };
  }
  return await tally(ctx, user._id);
}

/** The four numbers, read off the rows themselves. The expensive way. */
async function tally(ctx: QueryCtx, ownerId: Id<'users'>): Promise<Usage> {
  const docs = await ctx.db
    .query('documents')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .take(SWEEP_LIMIT);

  const total = { ...ZERO };
  for (const doc of docs) {
    const one = contribution(doc);
    total.syncedCount += one.syncedCount;
    total.syncedBytes += one.syncedBytes;
    total.localOnlyCount += one.localOnlyCount;
    total.scanCount += one.scanCount;
  }
  return total;
}

/** Re-derives the counters from the rows and writes them. The drift guard. */
export async function recount(ctx: MutationCtx, ownerId: Id<'users'>): Promise<void> {
  const user = await ctx.db.get('users', ownerId);
  if (user === null) {
    return;
  }
  await ctx.db.patch('users', user._id, {
    usage: { ...(await tally(ctx, ownerId)), countedAt: Date.now() },
  });
}
