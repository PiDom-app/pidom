/**
 * The verbs the screens call.
 *
 * `downloads/actions.ts`'s rule, and it is the rule that keeps the queue
 * honest: **every one of these writes a row and returns.** None of them starts
 * work, waits for it, or reports on it. The drain notices on its next tick,
 * which is at most a moment away because `watchTables(['localJobs'])` fires on
 * the write this function just made.
 *
 * That is what makes "Index now" instant in the UI and makes cancelling a
 * 1,000-page job a single `UPDATE` rather than something that has to reach
 * inside a loop.
 */
import { type SQLiteDatabase } from 'expo-sqlite';

import * as Chunks from '@/features/library/local/repository/chunks';
import * as Jobs from '@/features/library/local/repository/jobs';
import { mirroredIds } from '@/features/library/local/text-index';
import { log } from '@/lib/logger';
import { indexCapBytes, preferencesNow } from '@/stores/preferences-store';

import { CHUNK_VERSION, MODEL_VERSION } from '../model';

const SCOPE = 'intelligence-actions';

const versions = { modelVersion: MODEL_VERSION, chunkVersion: CHUNK_VERSION };

/** Asks for one document to be indexed, at the priority a tap deserves. */
export async function request(
  db: SQLiteDatabase,
  documentId: string,
  priority = Jobs.TAP_PRIORITY,
): Promise<void> {
  await Jobs.enqueue(db, Jobs.INDEX_JOB, documentId, { priority, ...versions });
}

/**
 * Asks for the document the reader just opened, ahead of everything else.
 *
 * The one place `OPEN_PRIORITY` is used. Somebody who has a book on screen is
 * the person most likely to search it in the next minute, and a background
 * sweep that queued forty books an hour ago should not be in front of them.
 */
export async function requestForReading(db: SQLiteDatabase, documentId: string): Promise<void> {
  await Jobs.enqueue(db, Jobs.INDEX_JOB, documentId, {
    priority: Jobs.OPEN_PRIORITY,
    ...versions,
  });
}

export async function pauseIndexing(db: SQLiteDatabase): Promise<void> {
  await Jobs.pauseAll(db, Jobs.INDEX_JOB);
}

export async function resumeIndexing(db: SQLiteDatabase): Promise<void> {
  await Jobs.resumeAll(db, Jobs.INDEX_JOB);
}

/** Drops one document's index and queues it again. */
export async function rebuild(db: SQLiteDatabase, documentId: string): Promise<void> {
  await Chunks.forgetIndex(db, documentId);
  await Jobs.forgetJobs(db, documentId);
  await request(db, documentId);
}

/**
 * Drops every index on this device and starts again.
 *
 * The settings screen's most expensive row, and it says so before the tap. The
 * jobs are re-queued by the next sweep rather than here, because "every
 * document" is a list this function has no business reading.
 */
export async function rebuildEverything(db: SQLiteDatabase): Promise<void> {
  await Chunks.forgetEverything(db);
  await Jobs.forgetKind(db, Jobs.INDEX_JOB);
}

/**
 * Queues whatever is eligible and is not indexed yet.
 *
 * **The mirror is the eligibility.** A document has local text exactly when it
 * has been synced, extracted by the account and then pulled down here once —
 * `use-text-mirror.ts` owns all three conditions — so the set of documents this
 * device *could* index is precisely the set `mirroredIds` returns. There is no
 * document list to take: asking for one would mean re-deriving a subset of what
 * the mirror already knows, and getting it subtly wrong.
 *
 * Runs on every pass of the queue, which is how a book that finishes arriving
 * gets queued without anything having to notice that it did. Cheap enough to:
 * two indexed reads and a set difference, and an `enqueue` is idempotent on a
 * derived id, so re-queueing something already queued is one `ON CONFLICT`.
 */
export async function sweep(db: SQLiteDatabase, profileId: string): Promise<number> {
  if (!preferencesNow().indexAutomatically) {
    return 0;
  }

  const mirrored = await mirroredIds(profileId);
  if (mirrored.size === 0) {
    return 0;
  }
  const indexed = await Chunks.indexedIds(db, MODEL_VERSION, CHUNK_VERSION);

  let queued = 0;
  for (const documentId of mirrored) {
    if (indexed.has(documentId)) {
      continue;
    }
    await Jobs.enqueue(db, Jobs.INDEX_JOB, documentId, { priority: 0, ...versions });
    queued += 1;
  }

  if (queued > 0) {
    log.debug(SCOPE, `queued ${queued} for indexing`);
  }
  return queued;
}

/**
 * Drops the least useful indexes until the library is under the ceiling.
 *
 * `downloads/actions.ts:evictToCap` for vectors, and one difference worth
 * stating: a download removed comes back on a tap over the network, and an
 * index removed has to be rebuilt by the model. So this runs only when the
 * ceiling is actually exceeded, never speculatively, and the order is
 * least-recently-opened — the question is which book the reader is least likely
 * to search next, which is not the same as which index is oldest.
 */
export async function evictToCap(db: SQLiteDatabase): Promise<number> {
  const cap = indexCapBytes();
  if (cap === null) {
    return 0;
  }

  let used = await Chunks.indexBytes(db);
  if (used <= cap) {
    return 0;
  }

  let dropped = 0;
  // Twenty at a time: enough to clear a real overage in one pass, and bounded
  // so a badly set ceiling cannot turn one tick into a loop over the library.
  for (const candidate of await Chunks.evictionCandidates(db, 20)) {
    if (used <= cap) {
      break;
    }
    await Chunks.forgetIndex(db, candidate.documentId);
    await Jobs.forgetJobs(db, candidate.documentId);
    used -= candidate.bytes;
    dropped += 1;
  }

  if (dropped > 0) {
    log.debug(SCOPE, `dropped ${dropped} indexes to stay under the ceiling`);
  }
  return dropped;
}
