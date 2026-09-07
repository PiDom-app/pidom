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
 */
import { type SQLiteDatabase } from 'expo-sqlite';

import type { FileState } from './types';

export type FileRecord = {
  documentId: string;
  state: FileState;
  expectedBytes: number | null;
  localBytes: number | null;
  verifiedAt: number | null;
  coverState: 'missing' | 'available';
  failure: string | null;
};

type FileRow = Omit<FileRecord, 'state' | 'coverState'> & { state: string; coverState: string };

export async function fileOf(db: SQLiteDatabase, documentId: string): Promise<FileRecord | null> {
  const row = await db.getFirstAsync<FileRow>(
    'SELECT documentId, state, expectedBytes, localBytes, verifiedAt, coverState, failure FROM documentFiles WHERE documentId = ?',
    documentId,
  );
  return row === null
    ? null
    : { ...row, state: row.state as FileState, coverState: row.coverState as 'missing' | 'available' };
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

  await db.withExclusiveTransactionAsync(async (txn) => {
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
 * task is gone with the process — so these are reset to `missing` on start and
 * the reader is offered the download again rather than watching a bar that will
 * never move.
 */
export async function clearStaleTransfers(db: SQLiteDatabase): Promise<void> {
  await db.runAsync(
    "UPDATE documentFiles SET state = 'missing', updatedAt = ? WHERE state = 'downloading'",
    Date.now(),
  );
}
