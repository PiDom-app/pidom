import { RateLimiter, HOUR } from '@convex-dev/rate-limiter';
import { ConvexError } from 'convex/values';

import { components } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

/**
 * Per-account bounds on the writes that cost money or work.
 *
 * `SECURITY.md` named this as the one thing not covered, and `uploadUrl` is
 * why it mattered: that mutation mints a signed PUT against a bucket Pidom is
 * billed for, and nothing stood in front of it but authentication. A verified
 * Google account was enough to fill R2 a hundred megabytes at a time.
 *
 * **Token buckets, not fixed windows.** A reader who adds nine books in one
 * evening is doing something real, and a fixed window would refuse the tenth
 * for no reason a person could understand. A bucket lets a burst through and
 * then refills at the rate the limit is actually about.
 *
 * Not sharded. Sharding trades occasional false refusals for throughput under
 * contention, and these are keyed per account — one reader is not contending
 * with themselves.
 *
 * Every number carries the reason for it, as in `./limits.ts`. A limit with no
 * reason gets raised the first time somebody hits it.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  /**
   * Importing. A row, a file move and a probe — cheap on the server, and the
   * bound is on the library filling with rows nobody asked for.
   */
  import: { kind: 'token bucket', rate: 40, period: HOUR, capacity: 10 },

  /**
   * A signed write capability against a billed bucket, which is the one worth
   * capping first. Two per document (the PDF and its cover) and a re-sync mints
   * fresh ones, so the burst is wider than the document count suggests.
   */
  uploadUrl: { kind: 'token bucket', rate: 80, period: HOUR, capacity: 20 },

  /**
   * Fetching. A new phone pulling down a whole library is exactly what this
   * feature is for, so the ceiling is high and the burst is a rail's worth.
   */
  downloadUrl: { kind: 'token bucket', rate: 200, period: HOUR, capacity: 40 },

  /**
   * Reprocessing. Each one is a Node action that pulls a file out of R2 and
   * runs pdf.js over it, so this is the most expensive thing a reader can ask
   * for and the only one they can ask for repeatedly by tapping.
   */
  reprocess: { kind: 'token bucket', rate: 10, period: HOUR, capacity: 3 },

  /**
   * Naming a collection. Not expensive — but a mutation that inserts a row per
   * call is a mutation that fills a table, and the home screen reads all of them.
   */
  createCollection: { kind: 'token bucket', rate: 60, period: HOUR, capacity: 15 },

  /**
   * Recording what a probe found, which is the largest single write a client
   * can make: a patch on `documents` plus a whole `documentOutline` row, up to
   * `OUTLINE_ENTRY_MAX` entries of `OUTLINE_TITLE_MAX` characters.
   *
   * Wide, because the honest callers are frequent and cheap — one per import,
   * one per reprocess, and one per document the library re-probes after an
   * import that committed early. The bound is on a client looping on it, not on
   * a reader importing a shelf of books.
   */
  setProcessed: { kind: 'token bucket', rate: 200, period: HOUR, capacity: 40 },

  /**
   * Where the reader got to. The most frequent write in the app now that the
   * reader debounces instead of only writing on the way out.
   *
   * Sized against what reading actually looks like: a debounce of fifteen
   * seconds is four writes a minute at the very worst, and nobody reads for an
   * hour without pausing, so 240 an hour is a ceiling a person cannot reach by
   * reading. The burst is a session's worth of jumping around a contents list.
   *
   * Cheap per call — one patch on one row — but it is a patch that re-runs the
   * home query on every device the account owns, which is the cost worth
   * bounding.
   */
  recordProgress: { kind: 'token bucket', rate: 240, period: HOUR, capacity: 30 },

  /**
   * Marking a page. One row in, one row out, and a reader working through a
   * chapter marks a handful — so the burst is a session's worth and the rate is
   * far past anything a person does by hand. The bound is on a loop, not on
   * somebody reading with a pencil.
   */
  bookmark: { kind: 'token bucket', rate: 200, period: HOUR, capacity: 40 },

  /**
   * Linking an uploaded object to its document — and, when it is the PDF, the
   * call that starts text extraction.
   *
   * That is the same Node action `reprocess` is capped at three bursts for: it
   * pulls up to 32 MB out of R2 and runs pdf.js over it. `attachUpload` is
   * idempotent for an already-synced document, so every repeat cancels one
   * workflow and starts another — a second, unmetered door into the room
   * `reprocess` is throttled at. Wider than `reprocess`, because an honest
   * caller makes two per document and a re-sync makes two more.
   */
  attachUpload: { kind: 'token bucket', rate: 60, period: HOUR, capacity: 16 },

  /**
   * Removing a cloud copy, and deleting a document.
   *
   * Each fires R2 deletes and a bounded page-text delete. Bounded in practice
   * by the caller's own document count, so this is high enough that clearing
   * out a library never meets it and low enough to stop a loop.
   */
  removeDocument: { kind: 'token bucket', rate: 200, period: HOUR, capacity: 40 },
});

/**
 * Reads are deliberately absent, including search.
 *
 * Spending a token is a write, and a query cannot write — so a rate limit on a
 * query is not expressible here at all. Declaring one that nothing enforces
 * would be worse than declaring none: it would read as covered. Search stays
 * bounded the way every read in this backend is, by `.take(n)`.
 */

/** Thrown when an account has run out of a bucket. */
export const RATE_LIMITED = 'RATE_LIMITED';

type LimitName =
  | 'import'
  | 'uploadUrl'
  | 'downloadUrl'
  | 'reprocess'
  | 'createCollection'
  | 'setProcessed'
  | 'recordProgress'
  | 'bookmark'
  | 'attachUpload'
  | 'removeDocument';

/**
 * Spends one token, or throws.
 *
 * Keyed on the profile row's id rather than on anything the caller sends — the
 * same rule the rest of the backend holds to. `retryAfter` rides along in the
 * error so the client can say *when* rather than only *no*; it is a number of
 * milliseconds, and the screen decides what sentence that becomes.
 */
export async function limit(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  name: LimitName,
): Promise<void> {
  const status = await rateLimiter.limit(ctx, name, { key: owner._id });
  if (!status.ok) {
    throw new ConvexError({ code: RATE_LIMITED, retryAfter: status.retryAfter });
  }
}
