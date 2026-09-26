import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { isStale } from './sync';

/**
 * How an account likes to read.
 *
 * **A row only exists once the reader changes something.** The defaults are the
 * constants below, not values written at sign-up — the same rule as
 * `convex/model/settings.ts`, and for the same two reasons: a default that
 * lives in a row has to be backfilled onto every account when it changes, and a
 * default that lives in code is corrected once, the next time it is read. So
 * every reader goes through `preferencesOf`, which fills in what is missing.
 *
 * These are the choices that mean the same thing on every screen. The device
 * keeps the rest — last zoom, sidebar width, per-document scroll position —
 * because a percentage chosen on a 27-inch display is not a percentage anybody
 * wants restored on a laptop.
 */

export type ReaderPreferences = Omit<
  Doc<'readerPreferences'>,
  '_id' | '_creationTime' | 'userId' | 'updatedAt' | 'clientUpdatedAt'
>;

/**
 * What a document opens as before anyone has said otherwise.
 *
 * `continuous` because that is what long-form reading is, and it is the one
 * mode every document supports whatever the window; a spread needs width a
 * laptop may not have. `fit-width` pairs with it: a page as wide as the column
 * and scrolled vertically is the shape continuous reading wants. The two
 * chrome behaviours default to the quiet option — the toolbar gets out of the
 * way while reading and comes back on intent — and `restorePosition` is on
 * because reopening a book anywhere but where you left it is a small betrayal.
 */
export const READER_DEFAULTS: ReaderPreferences = {
  defaultViewMode: 'continuous',
  pageScaling: 'fit-width',
  pageSpacing: 'normal',
  documentBackground: 'neutral',
  pageDirection: 'ltr',
  toolbarBehavior: 'auto-hide',
  sidebarBehavior: 'last-used',
  restorePosition: true,
  pageNavigation: 'continuous',
};

export async function preferencesOf(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
): Promise<ReaderPreferences> {
  const row = await ctx.db
    .query('readerPreferences')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique();
  return row === null ? READER_DEFAULTS : stripMeta(row, READER_DEFAULTS);
}

/**
 * The stored row, reduced to the fields the defaults declare.
 *
 * Keyed off the defaults rather than off the row, so a field added to the
 * schema and forgotten here reads as its default instead of leaking `_id` and
 * `userId` into whatever the caller returns over the wire. The same helper
 * `convex/model/settings.ts` uses, and for the same reason it lives there.
 */
function stripMeta<T extends object>(row: Record<string, unknown>, shape: T): T {
  const out = { ...shape } as Record<string, unknown>;
  for (const key of Object.keys(shape)) {
    if (row[key] !== undefined) {
      out[key] = row[key];
    }
  }
  return out as T;
}

/**
 * Writes a partial change, creating the row the first time.
 *
 * A late write is dropped rather than applied: these preferences are overwritten
 * rather than accumulated, so a change queued on one device and delivered after
 * a newer change from another would otherwise silently win by arriving last.
 * `clientUpdatedAt` is the device's clock at the moment of the change, compared
 * against the last one stored — the same guard `documents` and the annotation
 * tables carry. A caller that sends no clock is an older client and applied
 * unconditionally, which is what every write did before this existed.
 */
export async function patchPreferences(
  ctx: MutationCtx,
  userId: Id<'users'>,
  patch: Partial<ReaderPreferences>,
  clientUpdatedAt: number | undefined,
): Promise<void> {
  const row = await ctx.db
    .query('readerPreferences')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique();

  if (row === null) {
    await ctx.db.insert('readerPreferences', {
      userId,
      ...READER_DEFAULTS,
      ...patch,
      updatedAt: Date.now(),
      ...(clientUpdatedAt === undefined ? {} : { clientUpdatedAt }),
    });
    return;
  }

  if (isStale(row.clientUpdatedAt, clientUpdatedAt)) {
    return;
  }

  await ctx.db.patch('readerPreferences', row._id, {
    ...patch,
    updatedAt: Date.now(),
    // Spread rather than assigned: writing an explicit `undefined` would delete
    // the stored clock and make the next stale write win. See `sync.clientClock`.
    ...(clientUpdatedAt === undefined ? {} : { clientUpdatedAt }),
  });
}
