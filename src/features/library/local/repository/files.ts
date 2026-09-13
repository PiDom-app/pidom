/**
 * What this device holds, and whether it opens.
 *
 * The account can say a document *can* be fetched. It cannot say whether a
 * given phone has fetched it, whether the bytes arrived whole, or whether the
 * file is still there after the reader cleared some space — and a stale flag
 * would put a wrong badge on the one screen whose job is to say what opens
 * offline. So this table is written by the filesystem and by verification, and
 * by nothing that came over a wire.
 *
 * `available` is the only state the reader will open, and a row reaches it only
 * after the bytes have been checked. `corrupt` exists because a half-written
 * PDF used to be indistinguishable from a good one until somebody tapped it and
 * got a blank screen.
 *
 * Since the download queue exists, this table also carries what a transfer is
 * *waiting for* — its place in the queue, its progress, the reason it is held,
 * and enough of a paused task to resume it rather than start again. All of it
 * is still device-local and still has no counterpart in the account: see the
 * V3 migration for what each column is for, and `docs/architecture.md` for why
 * no server field will ever say "downloaded".
 */
import { type SQLiteDatabase } from 'expo-sqlite';

import type { FileState, HoldReason } from './types';
import { inTransaction } from '../transaction';

export type FileRecord = {
  documentId: string;
  state: FileState;
  expectedBytes: number | null;
  localBytes: number | null;
  verifiedAt: number | null;
  coverState: 'missing' | 'available';
  failure: string | null;
  /** When the reader asked for it. The queue's ordering key, after priority. */
  queuedAt: number | null;
  /** Higher goes first. A tap is 10; an automatic rule is 0. */
  priority: number;
  bytesWritten: number | null;
  totalBytes: number | null;
  /** `DownloadTask.savable()`, as JSON. Never leaves this database. */
  pauseState: string | null;
  heldReason: HoldReason | null;
  attempts: number;
  nextAttemptAt: number | null;
  /**
   * The account's fingerprint this file was last verified against.
   *
   * Not a hash of anything here. It is the value `noteAccountFingerprint`
   * compares on every reconcile to notice that somebody replaced the document
   * from another device.
   */
  remoteHash: string | null;
  /** The whole file's sha256, when the file was small enough to have one. */
  verifiedHash: string | null;
  lastVerifiedAt: number | null;
};

type FileRow = Omit<FileRecord, 'state' | 'coverState' | 'heldReason'> & {
  state: string;
  coverState: string;
  heldReason: string | null;
};

const COLUMNS = `documentId, state, expectedBytes, localBytes, verifiedAt, coverState, failure,
                 queuedAt, priority, bytesWritten, totalBytes, pauseState, heldReason,
                 attempts, nextAttemptAt, remoteHash, verifiedHash, lastVerifiedAt`;

function toRecord(row: FileRow): FileRecord {
  return {
    ...row,
    state: row.state as FileState,
    coverState: row.coverState as 'missing' | 'available',
    heldReason: row.heldReason as HoldReason | null,
  };
}

export async function fileOf(db: SQLiteDatabase, documentId: string): Promise<FileRecord | null> {
  const row = await db.getFirstAsync<FileRow>(
    `SELECT ${COLUMNS} FROM documentFiles WHERE documentId = ?`,
    documentId,
  );
  return row === null ? null : toRecord(row);
}

export async function setState(
  db: SQLiteDatabase,
  documentId: string,
  state: FileState,
  extra: { localBytes?: number; expectedBytes?: number; failure?: string | null } = {},
): Promise<void> {
  const now = Date.now();
  // `verifiedAt` is stamped only on the way into `available`, because that is
  // the only transition anything actually checked.
  await db.runAsync(
    `INSERT INTO documentFiles (documentId, state, expectedBytes, localBytes, verifiedAt, failure, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (documentId) DO UPDATE SET
       state = excluded.state,
       expectedBytes = COALESCE(excluded.expectedBytes, documentFiles.expectedBytes),
       localBytes = COALESCE(excluded.localBytes, documentFiles.localBytes),
       verifiedAt = CASE WHEN excluded.state = 'available' THEN excluded.verifiedAt ELSE documentFiles.verifiedAt END,
       failure = excluded.failure,
       updatedAt = excluded.updatedAt`,
    [
      documentId,
      state,
      extra.expectedBytes ?? null,
      extra.localBytes ?? null,
      state === 'available' ? now : null,
      extra.failure ?? null,
      now,
    ],
  );
}

export async function setCoverState(
  db: SQLiteDatabase,
  documentId: string,
  coverState: 'missing' | 'available',
): Promise<void> {
  await db.runAsync(
    `INSERT INTO documentFiles (documentId, coverState, updatedAt)
     VALUES (?, ?, ?)
     ON CONFLICT (documentId) DO UPDATE SET coverState = excluded.coverState, updatedAt = excluded.updatedAt`,
    [documentId, coverState, Date.now()],
  );
}

/** The ids whose file is here and verified. The set every tile reads. */
export async function availableIds(db: SQLiteDatabase): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ documentId: string }>(
    "SELECT documentId FROM documentFiles WHERE state = 'available'",
  );
  return new Set(rows.map((row) => row.documentId));
}

/** Documents whose cover has not been fetched or rendered yet. */
export async function missingCoverIds(db: SQLiteDatabase): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ documentId: string }>(
    "SELECT documentId FROM documentFiles WHERE coverState != 'available'",
  );
  return new Set(rows.map((row) => row.documentId));
}

/**
 * How much of this device the library is using.
 *
 * Summed from what was measured on disk rather than from `byteSize`, which is
 * the size the account recorded and says nothing about what is actually here.
 */
export async function bytesOnDevice(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ total: number | null }>(
    "SELECT SUM(localBytes) AS total FROM documentFiles WHERE state = 'available'",
  );
  return row?.total ?? 0;
}

/**
 * Makes the table agree with the disk.
 *
 * Run once per authenticated launch and on a pull to refresh. The filesystem
 * is the authority here and this table is its record: a file the reader cleared
 * with the system's storage settings is gone whatever any row says, and a file
 * that reappeared — a restored backup, a reinstall over the same directory — is
 * present whatever the row says.
 *
 * `corrupt` is left alone deliberately. The file is on disk, so a scan would
 * call it available and hand the reader a document that was already found not
 * to open; only a verified download clears that state.
 */
export async function reconcileFiles(
  db: SQLiteDatabase,
  found: Map<string, number>,
): Promise<void> {
  const now = Date.now();

  await inTransaction(db, async (txn) => {
    for (const [documentId, size] of found) {
      await txn.runAsync(
        `INSERT INTO documentFiles (documentId, state, localBytes, verifiedAt, updatedAt)
         VALUES (?, 'available', ?, ?, ?)
         ON CONFLICT (documentId) DO UPDATE SET
           state = CASE WHEN documentFiles.state = 'corrupt' THEN 'corrupt' ELSE 'available' END,
           localBytes = excluded.localBytes,
           verifiedAt = CASE WHEN documentFiles.state = 'corrupt' THEN documentFiles.verifiedAt ELSE excluded.verifiedAt END,
           updatedAt = excluded.updatedAt`,
        [documentId, size, now, now],
      );
    }

    const rows = await txn.getAllAsync<{ documentId: string }>(
      "SELECT documentId FROM documentFiles WHERE state IN ('available', 'corrupt')",
    );
    for (const row of rows) {
      if (!found.has(row.documentId)) {
        await txn.runAsync(
          "UPDATE documentFiles SET state = 'missing', localBytes = NULL, verifiedAt = NULL, failure = NULL, updatedAt = ? WHERE documentId = ?",
          [now, row.documentId],
        );
      }
    }
  });
}

/**
 * A transfer that was running when the app went away.
 *
 * `downloading` is not a state anything can still be in after a relaunch — the
 * JavaScript task is gone with the process — but what it had already written
 * is not. This used to reset the row to `missing`, which threw away the partial
 * file with it: a textbook two thirds fetched over a hotel connection started
 * again from nothing because somebody answered a phone call.
 *
 * It becomes `paused` instead. The `.download` file stays, the progress on the
 * row stays, and the queue offers to resume. `pauseState` is deliberately *not*
 * kept across the relaunch — it carries a signed URL that expired five minutes
 * after it was minted, so it is a dead credential rather than a useful one, and
 * a resume re-mints. See `local/transfer.ts`.
 */
export async function clearStaleTransfers(db: SQLiteDatabase): Promise<void> {
  await db.runAsync(
    `UPDATE documentFiles SET state = 'paused', pauseState = NULL, updatedAt = ?
      WHERE state IN ('downloading', 'verifying')`,
    Date.now(),
  );
}

/**
 * Asks for a document, and says how loudly.
 *
 * `priority` is what separates a tap from a rule. A reader who just pressed
 * Download on the book they are about to read should not wait behind four
 * favourites an automatic setting asked for while they were on the bus.
 *
 * Idempotent on purpose: tapping Download twice on a row already queued is a
 * reader checking that it worked, not a second request. It bumps the priority
 * and leaves everything else, so a second tap can promote but never restart.
 */
export async function enqueue(
  db: SQLiteDatabase,
  documentId: string,
  { priority = 0, expectedBytes }: { priority?: number; expectedBytes?: number } = {},
): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO documentFiles (documentId, state, queuedAt, priority, expectedBytes, attempts, nextAttemptAt, failure, heldReason, updatedAt)
     VALUES (?, 'queued', ?, ?, ?, 0, NULL, NULL, NULL, ?)
     ON CONFLICT (documentId) DO UPDATE SET
       state = CASE
         WHEN documentFiles.state IN ('downloading', 'verifying', 'available') THEN documentFiles.state
         ELSE 'queued' END,
       queuedAt = COALESCE(documentFiles.queuedAt, excluded.queuedAt),
       priority = MAX(documentFiles.priority, excluded.priority),
       expectedBytes = COALESCE(excluded.expectedBytes, documentFiles.expectedBytes),
       attempts = CASE WHEN documentFiles.state IN ('failed', 'corrupt') THEN 0 ELSE documentFiles.attempts END,
       nextAttemptAt = NULL,
       failure = NULL,
       heldReason = NULL,
       updatedAt = excluded.updatedAt`,
    [documentId, now, priority, expectedBytes ?? null, now],
  );
}

/** The next thing to move, or `null`. Highest priority first, then oldest. */
export async function nextQueued(db: SQLiteDatabase, now: number): Promise<FileRecord | null> {
  const row = await db.getFirstAsync<FileRow>(
    `SELECT ${COLUMNS} FROM documentFiles
      WHERE state IN ('queued', 'paused')
        AND (nextAttemptAt IS NULL OR nextAttemptAt <= ?)
      ORDER BY priority DESC, queuedAt ASC
      LIMIT 1`,
    now,
  );
  return row === null ? null : toRecord(row);
}

/** How many transfers are in flight, so the queue can respect its own ceiling. */
export async function movingCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM documentFiles WHERE state IN ('downloading', 'verifying')",
  );
  return row?.n ?? 0;
}

/**
 * Not now, and here is which rule said so.
 *
 * A hold is not an attempt: the reader's Wi-Fi-only setting doing exactly what
 * it was asked to do must never consume the retry budget, or a week of commutes
 * would leave a perfectly good download in the failed list.
 */
export async function hold(
  db: SQLiteDatabase,
  documentId: string,
  reason: HoldReason,
): Promise<void> {
  await db.runAsync(
    `UPDATE documentFiles SET state = 'held', heldReason = ?, updatedAt = ?
      WHERE documentId = ? AND state IN ('queued', 'held', 'paused')`,
    [reason, Date.now(), documentId],
  );
}

/**
 * Lets held downloads go, because the thing they were waiting for happened.
 *
 * Wi-Fi came back, or room was made. Scoped to the reasons that have actually
 * changed rather than releasing everything, so a queue held for want of disk
 * space does not all start moving the moment somebody joins a network.
 */
export async function release(db: SQLiteDatabase, reasons: HoldReason[]): Promise<number> {
  if (reasons.length === 0) {
    return 0;
  }
  const marks = reasons.map(() => '?').join(', ');
  const result = await db.runAsync(
    `UPDATE documentFiles SET state = 'queued', heldReason = NULL, updatedAt = ?
      WHERE state = 'held' AND heldReason IN (${marks})`,
    [Date.now(), ...reasons],
  );
  return result.changes;
}

/**
 * Progress, on the row rather than only in the store.
 *
 * `transfer-store` stays the thing a tile subscribes to — it is in memory and
 * re-renders one row rather than a database write every few hundred
 * milliseconds — and this is written on a much coarser beat, so that a paused
 * download can still say 62% after the process that was running it is gone.
 */
export async function recordProgress(
  db: SQLiteDatabase,
  documentId: string,
  bytesWritten: number,
  totalBytes: number,
): Promise<void> {
  await db.runAsync(
    `UPDATE documentFiles SET bytesWritten = ?, totalBytes = ?, updatedAt = ?
      WHERE documentId = ?`,
    [bytesWritten, totalBytes > 0 ? totalBytes : null, Date.now(), documentId],
  );
}

/**
 * Stopped by the reader, with enough kept to carry on.
 *
 * `savable` is `DownloadTask.savable()` serialised. It carries the signed URL
 * the transfer was using, which is a bearer credential — anybody holding it can
 * fetch the file for as long as its five minutes last, with no further check.
 * It is therefore written only here, in a database opened under SQLCipher, and
 * cleared by `settle` the instant the transfer is over. A resume re-mints
 * through `library.downloadUrl` first and falls back to this only if that
 * fails; see `local/transfer.ts`.
 */
export async function pause(
  db: SQLiteDatabase,
  documentId: string,
  savable: string | null,
): Promise<void> {
  await db.runAsync(
    `UPDATE documentFiles SET state = 'paused', pauseState = ?, updatedAt = ?
      WHERE documentId = ? AND state IN ('downloading', 'queued', 'held')`,
    [savable, Date.now(), documentId],
  );
}

/** An attempt that failed, with the backoff the next one has to wait for. */
export async function defer(
  db: SQLiteDatabase,
  documentId: string,
  afterMs: number,
  failure: string | null,
): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `UPDATE documentFiles SET state = 'queued', attempts = attempts + 1, nextAttemptAt = ?,
            failure = ?, updatedAt = ?
      WHERE documentId = ?`,
    [now + afterMs, failure, now, documentId],
  );
}

/**
 * The end of a transfer, however it ended.
 *
 * One function for every terminal state so that the credential in `pauseState`
 * cannot survive any of them. Forgetting to clear it on one unusual path is
 * exactly the kind of omission that leaves a signed URL in a database for a
 * year, so there is one path.
 */
export async function settle(
  db: SQLiteDatabase,
  documentId: string,
  state: FileState,
  extra: {
    localBytes?: number | null;
    failure?: string | null;
    verifiedHash?: string | null;
    remoteHash?: string | null;
  } = {},
): Promise<void> {
  const now = Date.now();
  const verified = state === 'available' || state === 'outdated';
  await db.runAsync(
    `UPDATE documentFiles SET
       state = ?,
       localBytes = COALESCE(?, localBytes),
       failure = ?,
       pauseState = NULL,
       heldReason = NULL,
       queuedAt = NULL,
       nextAttemptAt = NULL,
       bytesWritten = NULL,
       totalBytes = NULL,
       attempts = CASE WHEN ? THEN 0 ELSE attempts END,
       verifiedHash = COALESCE(?, verifiedHash),
       remoteHash = COALESCE(?, remoteHash),
       verifiedAt = CASE WHEN ? THEN ? ELSE verifiedAt END,
       lastVerifiedAt = CASE WHEN ? THEN ? ELSE lastVerifiedAt END,
       updatedAt = ?
     WHERE documentId = ?`,
    [
      state,
      extra.localBytes ?? null,
      extra.failure ?? null,
      verified ? 1 : 0,
      extra.verifiedHash ?? null,
      extra.remoteHash ?? null,
      state === 'available' ? 1 : 0,
      now,
      verified ? 1 : 0,
      now,
      now,
      documentId,
    ],
  );
}

/**
 * Notices that the account's copy has moved on.
 *
 * `remoteHash` is not a hash of anything on this device. It is **the account's
 * fingerprint at the moment this file was last verified against it** — written
 * by `settle` on the way into `available`, and compared here on every
 * reconcile. When the two disagree, somebody replaced the document from another
 * device and the file here is a good PDF that is no longer the right one.
 *
 * That is `outdated`, and it is deliberately not `corrupt`. The local copy
 * opens, the reader can go on reading it, and the offer to replace it is an
 * offer. A design that deleted it for them would be one that threw away the
 * only readable copy somebody had on a plane because a colleague re-uploaded a
 * chapter.
 *
 * It flips back, too. A document replaced and then replaced again with the
 * original is `available` once more without anything being re-downloaded,
 * because the comparison is against a value rather than a one-way flag.
 *
 * The fingerprint rather than `documents.contentHash`: the account carries a
 * fingerprint for every document and `contentHash` for almost none — R2 only
 * records a sha256 when the upload asks for one, and Pidom's presigned PUT does
 * not. See `docs/security.md`.
 */
export async function noteAccountFingerprint(
  db: SQLiteDatabase,
  documentId: string,
  fingerprint: string | null,
): Promise<void> {
  if (fingerprint === null) {
    return;
  }
  await db.runAsync(
    `UPDATE documentFiles SET
       state = CASE
         WHEN state = 'available' AND remoteHash IS NOT NULL AND remoteHash != ? THEN 'outdated'
         WHEN state = 'outdated' AND remoteHash = ? THEN 'available'
         ELSE state END,
       updatedAt = ?
     WHERE documentId = ? AND state IN ('available', 'outdated')`,
    [fingerprint, fingerprint, Date.now(), documentId],
  );
}

/** Everything the Downloads screen counts, in one read. */
export async function queueSummary(db: SQLiteDatabase): Promise<Record<FileState, number>> {
  const rows = await db.getAllAsync<{ state: string; n: number }>(
    'SELECT state, COUNT(*) AS n FROM documentFiles GROUP BY state',
  );
  const out = {} as Record<FileState, number>;
  for (const row of rows) {
    out[row.state as FileState] = row.n;
  }
  return out;
}

/** Downloads that have been here longest without a check. The re-verify list. */
export async function staleVerifications(
  db: SQLiteDatabase,
  before: number,
  limit: number,
): Promise<string[]> {
  const rows = await db.getAllAsync<{ documentId: string }>(
    `SELECT documentId FROM documentFiles
      WHERE state = 'available' AND (lastVerifiedAt IS NULL OR lastVerifiedAt < ?)
      ORDER BY COALESCE(lastVerifiedAt, 0) ASC
      LIMIT ?`,
    [before, limit],
  );
  return rows.map((row) => row.documentId);
}
