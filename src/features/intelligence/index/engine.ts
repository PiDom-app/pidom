/**
 * A book, turned into something searchable, a batch at a time.
 *
 * `downloads/engine.ts`'s shape, deliberately and almost line for line: claim
 * the next row, ask the policy whether a rule forbids it, do one bounded piece
 * of work, advance a durable cursor, and either defer with backoff or settle.
 * The two queues differ in what they do with a claimed row and in nothing else,
 * which is why `backoffFor` and `MAX_ATTEMPTS` are imported from `sync/outcome`
 * here exactly as they are there.
 *
 * **The cursor is the whole design.** A 1,000-page book is minutes of
 * inference, and a reader will lock their phone in the middle of it. Every
 * batch ends in a write — the vectors and the cursor, in one transaction — so
 * the worst an interruption costs is the batch that was in flight.
 * `clearStaleJobs` at the next launch rewrites whatever was `running` back to
 * `queued`, which is `clearStaleTransfers`' job for a download.
 *
 * **Nothing here touches the network, and nothing reaches the account.** The
 * text was mirrored down long before this runs, the model is on the disk, and
 * the vectors never leave. A phone in aeroplane mode with four mirrored books
 * indexes all four.
 */
import { type SQLiteDatabase } from 'expo-sqlite';

import * as Documents from '@/features/library/local/repository/documents';
import * as Chunks from '@/features/library/local/repository/chunks';
import * as Jobs from '@/features/library/local/repository/jobs';
import { pageTextOf, mirroredPageNumbers } from '@/features/library/local/text-index';
import { backoffFor, MAX_ATTEMPTS } from '@/features/library/sync/outcome';
import { log } from '@/lib/logger';
import { preferencesNow } from '@/stores/preferences-store';

import { onnxEngine } from '../engine/onnx-engine';
import { BATCH_START, BYTES_PER_VECTOR, CHUNK_VERSION, MODEL_VERSION, PAGE_WINDOW } from '../model';
import { mean } from '../retrieve/vectors';
import { chunkPages, sliceOf, type ChunkRange } from './chunker';
import { canIndex, holdFor } from './policy';

const SCOPE = 'intelligence-index';

export type Pass = { db: SQLiteDatabase; profileId: string };

/**
 * Whether a pass is running, at module scope.
 *
 * The same guard the download engine keeps, and for the same reason: `claim` is
 * not a claim — no row is marked in flight — so this is what stops two passes
 * working the same job. A second mechanism in the database would be a second
 * thing to get wrong.
 */
let running = false;

/**
 * Cuts a document's mirrored pages into passages.
 *
 * Reads the page numbers first and the text in windows, because a 600-page book
 * is five megabytes of strings and the chunker only ever needs one window at a
 * time. The chunking itself is pure — see `chunker.ts` — so everything
 * interesting about it is tested under Node.
 */
async function chunk(pass: Pass, documentId: string): Promise<number> {
  const numbers = await mirroredPageNumbers(pass.profileId, documentId);
  if (numbers.length === 0) {
    return 0;
  }

  const pages: { page: number; text: string }[] = [];
  for (let at = 0; at < numbers.length; at += PAGE_WINDOW) {
    const window = numbers.slice(at, at + PAGE_WINDOW);
    const text = await pageTextOf(pass.profileId, documentId, window);
    for (const page of window) {
      const body = text.get(page);
      if (body !== undefined) {
        pages.push({ page, text: body });
      }
    }
  }

  const ranges = chunkPages(pages);
  await Chunks.replaceChunks(pass.db, documentId, CHUNK_VERSION, ranges);
  return ranges.length;
}

/**
 * Embeds one batch and commits it with the cursor.
 *
 * The two writes are one transaction apiece rather than one between them, and
 * the order matters: vectors first, cursor second. A crash between them repeats
 * a batch, which overwrites the same rows because a chunk id is derived rather
 * than minted. A crash the other way round would skip one.
 */
async function embedBatch(
  pass: Pass,
  job: Jobs.JobRecord,
  batch: readonly ChunkRange[],
  total: number,
): Promise<void> {
  const engine = onnxEngine(pass.profileId);

  // Every page any passage in this batch touches, read once.
  const wanted = new Set<number>();
  for (const range of batch) {
    for (let page = range.startPage; page <= range.endPage; page += 1) {
      wanted.add(page);
    }
  }
  const text = await pageTextOf(pass.profileId, job.documentId, [...wanted]);
  const passages = batch.map((range) => sliceOf(range, (page) => text.get(page)));

  const vectors = await engine.embed(passages, 'passage');

  await Chunks.writeVectors(
    pass.db,
    job.documentId,
    MODEL_VERSION,
    vectors.map((vector, at) => ({
      chunkId: Chunks.chunkId(job.documentId, CHUNK_VERSION, batch[at].ordinal),
      vector: vector.vector,
      scale: vector.scale,
    })),
  );

  const cursor = batch[batch.length - 1].ordinal;
  await Jobs.advance(pass.db, job.id, cursor, Math.min(cursor, total));
}

/**
 * Publishes the finished index.
 *
 * One write, and it is the switch: until a `documentVectors` row names this
 * model and chunk version, nothing searches this version's chunks. That is what
 * lets a rebuild take an evening, be interrupted four times, and never once
 * leave the reader searching half an index.
 */
async function publish(pass: Pass, documentId: string): Promise<void> {
  const vectors = await Chunks.vectorsOf(pass.db, documentId, MODEL_VERSION);
  if (vectors.length === 0) {
    return;
  }

  await Chunks.publishIndex(pass.db, {
    documentId,
    ...mean(vectors),
    modelVersion: MODEL_VERSION,
    chunkVersion: CHUNK_VERSION,
    chunkCount: vectors.length,
    bytes: vectors.length * BYTES_PER_VECTOR,
  });
}

/** One job, from wherever it got to, to done or to a reason it is not. */
async function work(pass: Pass, job: Jobs.JobRecord): Promise<void> {
  const document = await Documents.documentById(pass.db, job.documentId);
  if (document === null) {
    // Deleted while it was queued. `sweepDocument` will have dropped the job
    // too; this is the race where it had not yet.
    await Jobs.settle(pass.db, job.id, 'done');
    return;
  }

  // A job queued under one model is not resumed under another. The vectors it
  // already wrote are not comparable with the ones it would write now, and half
  // an index in two vocabularies is worse than no index.
  if (job.modelVersion !== MODEL_VERSION || job.chunkVersion !== CHUNK_VERSION) {
    log.debug(SCOPE, 'a job outlived its model; starting it again');
    await Chunks.forgetIndex(pass.db, job.documentId);
    await Jobs.forgetJobs(pass.db, job.documentId);
    await Jobs.enqueue(pass.db, Jobs.INDEX_JOB, job.documentId, {
      priority: job.priority,
      modelVersion: MODEL_VERSION,
      chunkVersion: CHUNK_VERSION,
    });
    return;
  }

  let total = await Chunks.chunkCount(pass.db, job.documentId, CHUNK_VERSION);

  // Chunking is cheap and idempotent, so a job with no passages yet does it and
  // a resumed job skips it. The cursor being zero is not the test — a book of
  // one passage has a cursor of zero until that passage is written.
  if (total === 0) {
    await Jobs.begin(pass.db, job.id, 'chunking', null);
    total = await chunk(pass, job.documentId);
    if (total === 0) {
      // The text is not here. Not a failure: the mirror runs on its own
      // schedule and this document will be queued again when it lands.
      await Jobs.settle(pass.db, job.id, 'done');
      return;
    }
  }

  await Jobs.begin(pass.db, job.id, 'embedding', total);

  let cursor = job.cursor;
  for (;;) {
    // `BATCH_START` passages read per round trip. The engine below may split
    // them further — it halves its own batch when a device refuses one — but
    // the commit boundary is this loop, so this is also how much work an
    // interruption can cost.
    const batch = await Chunks.chunksAfter(
      pass.db,
      job.documentId,
      CHUNK_VERSION,
      cursor,
      BATCH_START,
    );
    if (batch.length === 0) {
      break;
    }
    await embedBatch(pass, job, batch, total);
    cursor = batch[batch.length - 1].ordinal;

    // Re-asked between batches rather than once at the start. A reader who
    // unplugs the phone or leaves Wi-Fi halfway through a textbook should have
    // the job stop there, with everything already done kept.
    const hold = holdFor(
      pass.profileId,
      { bytes: (total - cursor) * BYTES_PER_VECTOR, needsText: false },
      await Chunks.indexBytes(pass.db),
    );
    if (hold !== null) {
      await Jobs.hold(pass.db, job.id, hold);
      return;
    }
  }

  await Jobs.begin(pass.db, job.id, 'summarising', total);
  await publish(pass, job.documentId);
  await Jobs.settle(pass.db, job.id, 'done');
  log.debug(SCOPE, `indexed ${total} passages`);
}

/**
 * One pass of the queue.
 *
 * Sequential, one job at a time, and that is not a simplification: the model is
 * a hundred megabytes resident and two of them is a phone that stops. The
 * download queue's `maxConcurrent` has no counterpart here for that reason.
 *
 * Returns whether anything moved, so the caller can decide whether to schedule
 * another pass immediately or wait for the heartbeat.
 */
export async function drain(pass: Pass): Promise<boolean> {
  if (running || !canIndex(pass.profileId)) {
    return false;
  }
  running = true;
  let moved = false;

  try {
    for (;;) {
      const job = await Jobs.nextQueued(pass.db, Jobs.INDEX_JOB, Date.now());
      if (job === null) {
        break;
      }

      const hold = holdFor(pass.profileId, { bytes: 0, needsText: false }, 0);
      if (hold !== null) {
        await Jobs.hold(pass.db, job.id, hold);
        continue;
      }

      moved = true;
      try {
        await work(pass, job);
      } catch (error) {
        await settleFailure(pass, job, error);
      }
    }
  } finally {
    running = false;
    // The session goes when the queue empties. Holding a hundred megabytes
    // between the last book and the next one somebody imports is holding it for
    // nothing.
    await onnxEngine(pass.profileId).release();
  }

  return moved;
}

/**
 * What a thrown pass means.
 *
 * Narrower than `sync/outcome.ts`'s `classify`, because there is no account in
 * this loop and therefore no `FORBIDDEN`, no `RATE_LIMITED` and no malformed
 * request — every failure here is the device's. What is shared is the shape:
 * spend the attempts on backoff, then stop and wait for a person rather than
 * for a tick.
 */
async function settleFailure(pass: Pass, job: Jobs.JobRecord, error: unknown): Promise<void> {
  // Never the passage, and never its length. It is the reader's own document
  // content and `docs/security.md` has the rule; an error from a graph runtime
  // is about the graph, not about the words that went through it.
  const reason = error instanceof Error ? error.message : 'unknown';
  log.debug(SCOPE, 'a pass failed', reason);

  if (!preferencesNow().retryAutomatically || job.attempts + 1 >= MAX_ATTEMPTS) {
    await Jobs.settle(pass.db, job.id, 'failed', reason);
    return;
  }
  await Jobs.defer(pass.db, job.id, backoffFor(job.attempts), reason);
}
