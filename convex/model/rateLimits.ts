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
const LIMITS = {
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
   * Keeping a passage, or writing a note.
   *
   * Sized like `bookmark` and for the same reason, with one difference worth
   * naming: this one carries the reader's text rather than a page number, so a
   * loop against it writes bytes rather than rows. The row ceiling in
   * `limits.ts` is the harder bound — 500 per document — and this is what stops
   * somebody reaching it in a second.
   */
  annotation: { kind: 'token bucket', rate: 200, period: HOUR, capacity: 40 },

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

  /**
   * Renaming a document, and favouriting one.
   *
   * These were the only unmetered public writes in the app, and that was
   * defensible while every one of them was a thumb on a control. It is not now:
   * a device that spent a day offline drains its outbox in one connection, and
   * an unmetered mutation in that flush is an unmetered mutation in a loop.
   *
   * The capacity is a flush and the rate is a reader — forty in a burst covers
   * emptying a queue after a long trip, and three hundred an hour is far past
   * anything a person does by hand.
   */
  editDocument: { kind: 'token bucket', rate: 300, period: HOUR, capacity: 40 },

  /**
   * Renaming a collection, deleting one, and moving documents in and out.
   *
   * Unmetered for the same reason and now metered for the same one. Wider than
   * `editDocument` because moving a dozen documents into a new collection is
   * one gesture and a dozen mutations, and refusing the eleventh would be
   * refusing something a reader plainly meant.
   */
  editCollection: { kind: 'token bucket', rate: 400, period: HOUR, capacity: 60 },

  /**
   * Establishing the profile row a verified token belongs to.
   *
   * Called once per launch and idempotent, so an honest caller spends one token
   * a session and the bucket is invisible to them. What it stops is the loop:
   * `ensureProfile` is the one mutation reachable with nothing but a verified
   * Google token — every other write needs a profile that this call creates —
   * so it was the only door into the deployment that a token alone opened, and
   * it writes a row.
   *
   * Generous, because a reader who reinstalls, signs out and signs back in, or
   * force-quits repeatedly is doing something real.
   */
  ensureProfile: { kind: 'token bucket', rate: 60, period: HOUR, capacity: 10 },

  /**
   * Reading an uploaded object's metadata back out of R2.
   *
   * The component's own `syncMetadata` is public because the client has to call
   * it between the PUT and `attachUpload` — nothing else knows the upload
   * finished. It is ownership-bound by the `onUpload` callback in `../r2.ts`,
   * which is why this was not a hole; it was simply unmetered, and each call
   * schedules an R2 HEAD and a component write against a bucket Pidom is billed
   * for.
   *
   * Sized just above `attachUpload`, which follows it once per upload: a caller
   * that reaches this limit has already been refused by that one.
   */
  syncMetadata: { kind: 'token bucket', rate: 80, period: HOUR, capacity: 20 },

  /* ── sharing ──────────────────────────────────────────────────────── */

  /**
   * Offering a document to somebody.
   *
   * The bucket that matters most in this group, because one call can reach two
   * hundred people: a group share fans out to every member, and each of those
   * is a row, an event and a push. The capacity is a session of deliberate
   * sharing — picking four people for a document and doing it again for the
   * next — and the rate is far past anything a person does by hand.
   *
   * It is spent once per `createShare` rather than once per recipient. The
   * per-recipient bound is `SHARES_PER_DOCUMENT` and the fan-out's own paging;
   * charging per recipient would refuse a group share on its own size, which
   * is the one thing groups exist to make cheap.
   */
  createShare: { kind: 'token bucket', rate: 120, period: HOUR, capacity: 20 },

  /**
   * Accepting or declining one.
   *
   * A tap, and idempotent after the first — a second accept on an accepted
   * share changes nothing. Sized like a reader working through an inbox that
   * filled up while they were away.
   */
  respondShare: { kind: 'token bucket', rate: 200, period: HOUR, capacity: 40 },

  /**
   * Changing a permission, and removing access.
   *
   * Removing access is the expensive half: it deletes the recipient's
   * annotations on the document and their pending events, so it is a bounded
   * cascade rather than a patch. Wide enough that clearing everybody off a
   * document never meets it.
   */
  editShare: { kind: 'token bucket', rate: 200, period: HOUR, capacity: 40 },

  /**
   * A recipient fetching the file they were granted.
   *
   * Deliberately narrower than `downloadUrl`, which is the owner's own. That
   * one is sized for a new phone pulling down a whole library, which is a thing
   * an owner legitimately does; a recipient downloads the handful of documents
   * somebody sent them. A wide bucket here would be a wide bucket on egress
   * billed to the sender, spendable by anybody they ever shared with.
   */
  shareDownloadUrl: { kind: 'token bucket', rate: 60, period: HOUR, capacity: 15 },

  /**
   * Making a group, and adding or removing members.
   *
   * A membership write is one row, but it changes what its subject can open
   * across every document the group holds — so the bound is on churn rather
   * than on cost. Capacity is filling a new group in one sitting.
   */
  createGroup: { kind: 'token bucket', rate: 30, period: HOUR, capacity: 8 },
  editGroup: { kind: 'token bucket', rate: 300, period: HOUR, capacity: 50 },

  /**
   * Registering a device for push.
   *
   * Called once per launch and idempotent on the token, so an honest caller
   * spends one token a session. What it stops is a loop inserting rows in a
   * table this deployment sends network requests from.
   */
  registerDevice: { kind: 'token bucket', rate: 60, period: HOUR, capacity: 10 },

  /**
   * Changing a sharing or notification preference.
   *
   * Every one of these is a switch somebody flipped. Generous, because a reader
   * going through a settings screen once flips a dozen in a minute.
   */
  editSettings: { kind: 'token bucket', rate: 200, period: HOUR, capacity: 40 },

  /**
   * Deleting the account.
   *
   * Narrow to the point of being nearly one-shot, because it is: an account is
   * deleted once, and a stolen session that can spend this bucket forty times
   * an hour is a stolen session that has already done its damage on the first.
   * The rate refills slowly enough that a retry after a genuine network
   * failure still goes through.
   */
  deleteAccount: { kind: 'token bucket', rate: 3, period: HOUR, capacity: 2 },

  /**
   * Claiming a handle.
   *
   * The narrowest bucket here, and the only one that is narrow on purpose
   * rather than by cost. A handle lookup is how one account is found by
   * another, so an unmetered claim is an unmetered probe of which handles are
   * taken — and taking a name is not something anybody does repeatedly.
   */
  setHandle: { kind: 'token bucket', rate: 6, period: HOUR, capacity: 3 },

  /**
   * Saying "still here" in a document or group room.
   *
   * A heartbeat is a mutation, and the client sends one every ten seconds per
   * open room. Six an hour would be wrong and six hundred is the honest
   * ceiling: 360 is one room held open continuously, and the capacity absorbs
   * a reader moving between documents. Past that is a client with a broken
   * interval, which is exactly what this exists to stop.
   */
  presence: { kind: 'token bucket', rate: 600, period: HOUR, capacity: 60 },
} as const;

export const rateLimiter = new RateLimiter(components.rateLimiter, LIMITS);

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

/**
 * Derived from the buckets rather than written out beside them.
 *
 * It used to be a hand-kept union, which is a second list to update every time
 * a limit is added — and the failure mode is the quiet one: a bucket that
 * exists, is configured, and cannot be named by `limit()`, so the function it
 * was written for stays unmetered and nothing says so.
 */
type LimitName = keyof typeof LIMITS;

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
