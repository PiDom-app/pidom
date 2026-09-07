/**
 * What the account's answer means for an operation in the queue.
 *
 * This is the part of a sync engine that is easy to get wrong quietly. A queue
 * that retries everything jams for ever on the first operation that can never
 * succeed; a queue that drops everything that failed loses the reader's work
 * without saying so. The four codes this backend throws each want a different
 * answer, and two of them are not obvious.
 *
 * **`FORBIDDEN` on a delete or an update is success.** `assertOwner` reports
 * "no such row" and "not yours" identically, on purpose — a caller who could
 * tell them apart could enumerate which ids exist. So a delete that comes back
 * `FORBIDDEN` means the document is not there, which is what the operation
 * wanted. Retrying it is retrying for ever, and the alternative reading — that
 * this account genuinely never owned the row — leads to the same place, because
 * there is nothing this device can do about that either.
 *
 * On a *create* the same code means something else entirely: a create cannot
 * find a row that is not there, so `FORBIDDEN` there is about the parent — the
 * document a note was being written on has gone — and the note goes with it.
 *
 * **`RATE_LIMITED` is not a failure.** The account has run out of a bucket, and
 * the error carries how long in milliseconds. Waiting that long is the whole
 * instruction; counting it as an attempt would burn the retry budget on a
 * queue that is behaving exactly as intended.
 */
import { codeOf, retryAfterOf } from '../data/errors';
import type { QueueOp } from '../local/repository/queue';

export type Outcome =
  /** Done. Leave the queue. */
  | { kind: 'done' }
  /**
   * The thing this operation was about is gone, and so is the local row.
   *
   * Distinct from `done` because the device has cleaning up to do: a note whose
   * document was deleted on another phone is a row here with nothing behind it,
   * and leaving it would put it in a list under a book that no longer exists.
   */
  | { kind: 'dropped' }
  /**
   * Not now — a network, a socket, a bucket. Comes back later.
   *
   * `counts` says whether this should spend one of the eight attempts an
   * operation gets before it is put in front of a person. A refusal counts; a
   * queue doing as it was told does not.
   */
  | { kind: 'retry'; afterMs: number; reason: string; counts: boolean }
  /** Never, without a person. Shows up on the sync screen. */
  | { kind: 'failed'; reason: string };

/** Doubling, from four seconds, with a ceiling of five minutes. */
const BACKOFF_BASE_MS = 4_000;
const BACKOFF_CEILING_MS = 5 * 60_000;

/**
 * Jitter, so a queue of fifty operations that all failed on one dropped socket
 * does not come back as fifty simultaneous requests the moment it reopens.
 */
function jitter(ms: number): number {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

export function backoffFor(attempts: number): number {
  return jitter(Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_CEILING_MS));
}

/** How many times an operation is retried before it is put in front of a person. */
export const MAX_ATTEMPTS = 8;

export function classify(error: unknown, op: QueueOp, attempts: number): Outcome {
  const code = codeOf(error);

  if (code === 'RATE_LIMITED') {
    const retryAfter = retryAfterOf(error);
    return {
      kind: 'retry',
      // The server said when. Believe it, and do not spend an attempt: the
      // account is working exactly as designed, and a reader who imported nine
      // books in an evening should not find the tenth in the failed list for it.
      afterMs: retryAfter === null ? backoffFor(0) : jitter(retryAfter),
      reason: 'The account is sending too many changes at once.',
      counts: false,
    };
  }

  if (code === 'FORBIDDEN') {
    // A create cannot fail to find a row it is about to make, so here the code
    // is about the parent: the document this note or bookmark hangs off was
    // deleted somewhere else. The local row goes with it.
    //
    // On an update or a remove it means the row itself is not there, which is
    // what the operation wanted in the second case and cannot be helped in the
    // first.
    return op === 'create' ? { kind: 'dropped' } : { kind: 'done' };
  }

  if (code === 'INVALID') {
    // The server refused the content, and it will refuse it again. This is the
    // one outcome worth a reader's attention.
    return { kind: 'failed', reason: 'The account would not accept this change.' };
  }

  if (code === 'UNAUTHENTICATED' || code === 'NO_PROFILE') {
    // The token lapsed mid-drain. The session recovers on its own; the queue
    // waits rather than throwing the reader's work away over it. Not an attempt
    // either — nothing about the operation is wrong, and a phone left signed out
    // over a weekend should not come back to a list of failures.
    return {
      kind: 'retry',
      afterMs: backoffFor(attempts),
      reason: 'Waiting to sign in again.',
      counts: false,
    };
  }

  if (attempts + 1 >= MAX_ATTEMPTS) {
    return { kind: 'failed', reason: 'This change would not go through.' };
  }

  return {
    kind: 'retry',
    afterMs: backoffFor(attempts),
    reason: 'Could not reach your account.',
    counts: true,
  };
}
