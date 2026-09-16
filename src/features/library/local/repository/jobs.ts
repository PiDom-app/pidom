/**
 * The work this device owes itself, and where it got to.
 *
 * `localJobs` was created by the V1 migration, indexed, and then never written
 * to by anything — a generic job row sitting empty for a year. This is what it
 * was for.
 *
 * The verbs are `files.ts`'s, because the two queues are the same queue. A
 * drain claims the next thing, decides whether a rule forbids it, does a bounded
 * piece of work, advances a cursor, and either defers with backoff or settles.
 * `settle` is the one terminal path in both, which is what stops a state
 * machine growing a second way to reach `failed` that clears half the columns.
 *
 * **The cursor is the point.** A 1,000-page book is not an operation, it is a
 * few thousand bounded ones, and the reader will close the app in the middle of
 * them. `cursor` is the last chunk ordinal written, `completedUnits` is what the
 * tile renders, and `clearStaleJobs` at launch rewrites whatever was running
 * back to `queued` — the same recovery `clearStaleTransfers` does for a
 * download, for the same reason.
 */
import { type SQLiteDatabase } from 'expo-sqlite';

import type { IndexHold } from './types';
import { inTransaction } from '../transaction';

/** The only kind so far. A column rather than a table, so a second is cheap. */
export const INDEX_JOB = 'index';

/**
 * What a claimed job is doing right now.
 *
 * Distinct from `IndexState`, which is what the *document* is, because a job
 * exists only while there is work and a document has a state whether or not one
 * does. `stage` is which half of `running` is running.
 */
export type JobStage = 'queued' | 'chunking' | 'embedding' | 'summarising' | 'done';

/** Higher goes first. A document the reader just opened outranks a sweep. */
export const TAP_PRIORITY = 10;
export const OPEN_PRIORITY = 20;

export type JobRecord = {
  id: string;
  kind: string;
  documentId: string;
  /** `queued` · `running` · `held` · `done` · `failed`. The lifecycle. */
  state: string;
  stage: JobStage;
  /** The last chunk ordinal written. Where a resumed pass starts. */
  cursor: number;
  totalUnits: number | null;
  completedUnits: number;
  priority: number;
  attempts: number;
  nextAttemptAt: number | null;
  heldReason: IndexHold | null;
  /** What built this. A job queued under one model is not resumed under another. */
  modelVersion: string | null;
  chunkVersion: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

type JobRow = Omit<JobRecord, 'stage' | 'heldReason'> & {
  stage: string;
  heldReason: string | null;
};

const COLUMNS = `id, kind, documentId, state, stage, cursor, totalUnits, completedUnits,
                 priority, attempts, nextAttemptAt, heldReason, modelVersion, chunkVersion,
                 lastError, createdAt, updatedAt`;

function toRecord(row: JobRow): JobRecord {
  return {
    ...row,
    stage: row.stage as JobStage,
    heldReason: row.heldReason as IndexHold | null,
  };
}

/**
 * The job id for a document.
 *
 * Derived rather than minted, the way `bookmarkId` is: one job per document per
 * kind, so asking twice is the same row and a retry cannot leave a second job
 * behind to fight the first.
 */
export function jobId(kind: string, documentId: string): string {
  return `${kind}:${documentId}`;
}

export async function jobFor(
  db: SQLiteDatabase,
  kind: string,
  documentId: string,
): Promise<JobRecord | null> {
  const row = await db.getFirstAsync<JobRow>(
    `SELECT ${COLUMNS} FROM localJobs WHERE id = ?`,
    jobId(kind, documentId),
  );
  return row === null ? null : toRecord(row);
}

/**
 * Asks for a document to be indexed.
 *
 * Idempotent, and the conflict clause is where the care is. Asking again takes
 * the *higher* priority — a reader who opens a book that a background sweep had
 * already queued should not be put behind it — and resets the attempt counter
 * only from a state that has given up, so tapping a running job does not make
 * its backoff start over.
 */
export async function enqueue(
  db: SQLiteDatabase,
  kind: string,
  documentId: string,
  options: { priority?: number; modelVersion: string; chunkVersion: number } = {
    modelVersion: '',
    chunkVersion: 0,
  },
): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO localJobs
       (id, kind, documentId, state, stage, cursor, completedUnits, priority, attempts,
        nextAttemptAt, modelVersion, chunkVersion, createdAt, updatedAt)
     VALUES (?, ?, ?, 'queued', 'queued', 0, 0, ?, 0, NULL, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       priority = MAX(localJobs.priority, excluded.priority),
       state = CASE WHEN localJobs.state IN ('failed', 'held', 'done') THEN 'queued' ELSE localJobs.state END,
       attempts = CASE WHEN localJobs.state IN ('failed', 'held') THEN 0 ELSE localJobs.attempts END,
       nextAttemptAt = CASE WHEN localJobs.state IN ('failed', 'held') THEN NULL ELSE localJobs.nextAttemptAt END,
       heldReason = NULL,
       lastError = NULL,
       updatedAt = excluded.updatedAt`,
    [
      jobId(kind, documentId),
      kind,
      documentId,
      options.priority ?? 0,
      options.modelVersion,
      options.chunkVersion,
      now,
      now,
    ],
  );
}

/**
 * The next job to work on, or `null` when there is nothing to do.
 *
 * Reads the index the V5 migration created. Not a true claim — no row is marked
 * in flight — because the drain's own `running` guard is what stops two passes
 * overlapping, exactly as it does for downloads. A second mechanism would be a
 * second thing to get wrong.
 */
export async function nextQueued(
  db: SQLiteDatabase,
  kind: string,
  now: number,
): Promise<JobRecord | null> {
  const row = await db.getFirstAsync<JobRow>(
    `SELECT ${COLUMNS} FROM localJobs
     WHERE kind = ? AND state = 'queued' AND (nextAttemptAt IS NULL OR nextAttemptAt <= ?)
     ORDER BY priority DESC, createdAt ASC
     LIMIT 1`,
    [kind, now],
  );
  return row === null ? null : toRecord(row);
}

/** Marks a job as the one running, so the tile can say so. */
export async function begin(
  db: SQLiteDatabase,
  id: string,
  stage: JobStage,
  totalUnits: number | null,
): Promise<void> {
  await db.runAsync(
    `UPDATE localJobs
     SET state = 'running', stage = ?, totalUnits = COALESCE(?, totalUnits),
         heldReason = NULL, lastError = NULL, updatedAt = ?
     WHERE id = ?`,
    [stage, totalUnits, Date.now(), id],
  );
}

/**
 * A batch finished. Moves the cursor and nothing else.
 *
 * Called once per batch rather than once per passage, because this is a write
 * and a batch is sixteen to sixty-four passages. The tile reads
 * `completedUnits` and re-renders on the table change, which is the only
 * progress signal in the system — there is no server field for it and no store
 * to keep in step.
 */
export async function advance(
  db: SQLiteDatabase,
  id: string,
  cursor: number,
  completedUnits: number,
): Promise<void> {
  await db.runAsync(
    `UPDATE localJobs SET cursor = ?, completedUnits = ?, updatedAt = ? WHERE id = ?`,
    [cursor, completedUnits, Date.now(), id],
  );
}

/** Not allowed to run yet, and why. Keeps the cursor: the work is not lost. */
export async function hold(db: SQLiteDatabase, id: string, reason: IndexHold): Promise<void> {
  await db.runAsync(
    `UPDATE localJobs SET state = 'held', heldReason = ?, updatedAt = ? WHERE id = ?`,
    [reason, Date.now(), id],
  );
}

/**
 * Releases everything held for reasons that no longer apply.
 *
 * Takes the list rather than one reason because a single event lifts several:
 * plugging a phone in clears `battery`, and Wi-Fi returning clears `wifi`.
 * Returns how many moved so the caller can decide whether a pass is worth it.
 */
export async function release(db: SQLiteDatabase, reasons: readonly IndexHold[]): Promise<number> {
  if (reasons.length === 0) {
    return 0;
  }
  const marks = reasons.map(() => '?').join(', ');
  const result = await db.runAsync(
    `UPDATE localJobs
     SET state = 'queued', heldReason = NULL, updatedAt = ?
     WHERE state = 'held' AND heldReason IN (${marks})`,
    [Date.now(), ...reasons],
  );
  return result.changes;
}

/** Try again later, and count it against the attempts. Keeps the cursor. */
export async function defer(
  db: SQLiteDatabase,
  id: string,
  afterMs: number,
  reason: string,
): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `UPDATE localJobs
     SET state = 'queued', attempts = attempts + 1, nextAttemptAt = ?, lastError = ?, updatedAt = ?
     WHERE id = ?`,
    [now + afterMs, reason, now, id],
  );
}

/**
 * The one terminal path.
 *
 * Every column that only means something to a job in flight is cleared here, so
 * a settled row cannot carry a stale hold reason or a next-attempt time into
 * whatever asks about it next. `files.ts:settle` is the same function for the
 * same reason.
 */
export async function settle(
  db: SQLiteDatabase,
  id: string,
  state: 'done' | 'failed',
  error: string | null = null,
): Promise<void> {
  await db.runAsync(
    `UPDATE localJobs
     SET state = ?, stage = CASE WHEN ? = 'done' THEN 'done' ELSE stage END,
         heldReason = NULL, nextAttemptAt = NULL, lastError = ?, updatedAt = ?
     WHERE id = ?`,
    [state, state, error, Date.now(), id],
  );
}

/**
 * What a crash leaves behind, at the next launch.
 *
 * A job that was `running` when the process went away is not running now, and
 * nothing will ever finish it — the same hole `clearStaleTransfers` closes for
 * downloads. The cursor survives, so this costs at most the batch that was in
 * flight rather than the book.
 */
export async function clearStaleJobs(db: SQLiteDatabase): Promise<void> {
  await db.runAsync(
    `UPDATE localJobs SET state = 'queued', updatedAt = ? WHERE state = 'running'`,
    Date.now(),
  );
}

/** Everything about one document's jobs, dropped. Called by `sweepDocument`. */
export async function forgetJobs(db: SQLiteDatabase, documentId: string): Promise<void> {
  await db.runAsync(`DELETE FROM localJobs WHERE documentId = ?`, documentId);
}

/** Drops a whole kind, for "rebuild every index". */
export async function forgetKind(db: SQLiteDatabase, kind: string): Promise<void> {
  await db.runAsync(`DELETE FROM localJobs WHERE kind = ?`, kind);
}

export type JobSummary = {
  queued: number;
  running: number;
  held: number;
  failed: number;
  /** The one being worked on, for the line on the settings screen. */
  current: JobRecord | null;
};

/**
 * The counts the settings screen reads, in one pass.
 *
 * `GROUP BY` rather than four `COUNT(*)` queries, because this runs on every
 * change to the table and four round trips through the bridge to render one
 * sentence is three too many.
 */
export async function summary(db: SQLiteDatabase, kind: string): Promise<JobSummary> {
  const rows = await db.getAllAsync<{ state: string; n: number }>(
    `SELECT state, COUNT(*) AS n FROM localJobs WHERE kind = ? GROUP BY state`,
    kind,
  );
  const counts = new Map(rows.map((row) => [row.state, row.n]));
  const current = await db.getFirstAsync<JobRow>(
    `SELECT ${COLUMNS} FROM localJobs WHERE kind = ? AND state = 'running' LIMIT 1`,
    kind,
  );
  return {
    queued: counts.get('queued') ?? 0,
    running: counts.get('running') ?? 0,
    held: counts.get('held') ?? 0,
    failed: counts.get('failed') ?? 0,
    current: current === null ? null : toRecord(current),
  };
}

/**
 * Pauses everything, without losing where any of it got to.
 *
 * One statement inside a transaction rather than a loop, because "pause
 * indexing" is one decision and a half-paused queue is a queue that starts
 * again the moment the next tick fires.
 */
export async function pauseAll(db: SQLiteDatabase, kind: string): Promise<void> {
  await inTransaction(db, async (txn) => {
    await txn.runAsync(
      `UPDATE localJobs SET state = 'held', heldReason = NULL, updatedAt = ?
       WHERE kind = ? AND state IN ('queued', 'running')`,
      [Date.now(), kind],
    );
  });
}

/** The other half of `pauseAll`. Only touches rows with no reason to be held. */
export async function resumeAll(db: SQLiteDatabase, kind: string): Promise<void> {
  await db.runAsync(
    `UPDATE localJobs SET state = 'queued', updatedAt = ?
     WHERE kind = ? AND state = 'held' AND heldReason IS NULL`,
    [Date.now(), kind],
  );
}
