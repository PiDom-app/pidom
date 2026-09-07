/**
 * Reading and writing documents on the device.
 *
 * These are the queries the home screen, the all-library screen and the reader
 * are built out of. They answer the same questions `convex/model/library.ts`
 * answers and in the same order, because the two have to agree about what
 * "Continue reading" means — but they answer them from a database that is on
 * the phone, so they answer them in aeroplane mode.
 *
 * **A local write is the write.** It bumps `clientUpdatedAt` from this device's
 * clock and marks the row `pending`; the outbox turns that into a mutation when
 * there is a connection. Nothing here waits for the account, and nothing here
 * fails because the account is not there.
 */
import { type SQLiteDatabase } from 'expo-sqlite';

import { RAIL_LIMIT } from '@convex/model/limits';

import {
  asFlag,
  DOCUMENT_COLUMNS,
  DOCUMENT_FROM,
  toLibraryDocument,
  type DocumentRow,
  type LibraryDocument,
  type ReadingMode,
} from './types';

/** Every read hides a soft-deleted row. A delete is pending, not undone. */
const LIVE = 'd.deletedAt IS NULL';

async function select(
  db: SQLiteDatabase,
  where: string,
  order: string,
  params: (string | number)[] = [],
): Promise<LibraryDocument[]> {
  const rows = await db.getAllAsync<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} ${DOCUMENT_FROM} WHERE ${where} ${order}`,
    params,
  );
  return rows.map(toLibraryDocument);
}

/**
 * One document, deleted or not.
 *
 * The outbox needs this shape: it has to be able to read a row precisely in
 * order to tell the account it is gone. Screens want `liveDocumentById`.
 */
export async function documentById(
  db: SQLiteDatabase,
  id: string,
): Promise<LibraryDocument | null> {
  const row = await db.getFirstAsync<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} ${DOCUMENT_FROM} WHERE d.id = ?`,
    id,
  );
  return row === null ? null : toLibraryDocument(row);
}

/** One document, as a screen should see it: absent once it has been deleted. */
export async function liveDocumentById(
  db: SQLiteDatabase,
  id: string,
): Promise<LibraryDocument | null> {
  const row = await db.getFirstAsync<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} ${DOCUMENT_FROM} WHERE d.id = ? AND ${LIVE}`,
    id,
  );
  return row === null ? null : toLibraryDocument(row);
}

/**
 * Documents the reader has started and not finished, most recently opened
 * first.
 *
 * Never-opened documents are excluded rather than sorted last, which is what
 * the server does by taking a page of the index and dropping the ones with no
 * `lastOpenedAt`. Saying it in the `WHERE` is the same answer and one less
 * thing to remember.
 */
export async function continueReading(db: SQLiteDatabase): Promise<LibraryDocument[]> {
  return await select(
    db,
    `${LIVE} AND d.isFinished = 0 AND d.lastOpenedAt IS NOT NULL`,
    `ORDER BY d.lastOpenedAt DESC LIMIT ${RAIL_LIMIT}`,
  );
}

/** Newest import first. */
export async function recentlyAdded(db: SQLiteDatabase): Promise<LibraryDocument[]> {
  return await select(db, LIVE, `ORDER BY d.createdAt DESC LIMIT ${RAIL_LIMIT}`);
}

export async function favorites(db: SQLiteDatabase): Promise<LibraryDocument[]> {
  return await select(
    db,
    `${LIVE} AND d.isFavorite = 1`,
    `ORDER BY d.lastOpenedAt DESC, d.createdAt DESC LIMIT ${RAIL_LIMIT}`,
  );
}

export async function finished(db: SQLiteDatabase): Promise<LibraryDocument[]> {
  return await select(
    db,
    `${LIVE} AND d.isFinished = 1`,
    `ORDER BY d.lastOpenedAt DESC, d.createdAt DESC LIMIT ${RAIL_LIMIT}`,
  );
}

/**
 * What is actually on this phone, most recently touched first.
 *
 * `f.state = 'available'` and not `isSynced`, and not a flag the account set:
 * this rail is the one screen whose entire job is to say what opens with no
 * connection, and only the filesystem knows that.
 */
export async function onThisDevice(db: SQLiteDatabase): Promise<LibraryDocument[]> {
  return await select(
    db,
    `${LIVE} AND f.state = 'available'`,
    `ORDER BY COALESCE(d.lastOpenedAt, d.createdAt) DESC LIMIT ${RAIL_LIMIT}`,
  );
}

/**
 * The same documents, biggest first, with what each one actually takes up.
 *
 * Unlimited where the rail beside it takes twelve, because this is the list a
 * reader is deciding from: capping it would hide exactly the long tail somebody
 * came here to find. Bounded in practice by how many files fit on the device.
 *
 * `localBytes` is the verified size on disk rather than `byteSize` from the
 * row. They agree for a file that arrived intact, and where they disagree the
 * one measured here is the one that would be reclaimed.
 */
export async function onThisDeviceBySize(
  db: SQLiteDatabase,
): Promise<(LibraryDocument & { localBytes: number })[]> {
  const rows = await db.getAllAsync<DocumentRow & { localBytes: number | null }>(
    `SELECT ${DOCUMENT_COLUMNS}, f.localBytes ${DOCUMENT_FROM}
      WHERE ${LIVE} AND f.state = 'available'
      ORDER BY COALESCE(f.localBytes, d.byteSize) DESC`,
  );
  return rows.map((row) => ({
    ...toLibraryDocument(row),
    localBytes: row.localBytes ?? row.byteSize,
  }));
}

export type LibrarySort = 'recent' | 'opened' | 'title';
export type LibraryFilter = 'all' | 'favorites' | 'finished' | 'device';

const ORDERS: Record<LibrarySort, string> = {
  recent: 'd.createdAt DESC',
  opened: 'd.lastOpenedAt DESC, d.createdAt DESC',
  title: 'd.title COLLATE NOCASE ASC',
};

/**
 * The all-library list, a page at a time.
 *
 * `device` joins the filters here where it could not on the server: local
 * availability was a fact the backend had no column for, so the client used to
 * fetch a page and intersect it with a directory listing, which returns pages
 * of uneven length. On this side it is one predicate like the others.
 */
export async function listDocuments(
  db: SQLiteDatabase,
  options: { sort: LibrarySort; filter: LibraryFilter; limit: number; offset: number },
): Promise<LibraryDocument[]> {
  const clauses = [LIVE];
  if (options.filter === 'favorites') {
    clauses.push('d.isFavorite = 1');
  } else if (options.filter === 'finished') {
    clauses.push('d.isFinished = 1');
  } else if (options.filter === 'device') {
    clauses.push("f.state = 'available'");
  }

  return await select(
    db,
    clauses.join(' AND '),
    `ORDER BY ${ORDERS[options.sort]} LIMIT ? OFFSET ?`,
    [options.limit, options.offset],
  );
}

/**
 * Title search, on the device.
 *
 * `LIKE` rather than FTS5, deliberately: a library is hundreds of rows and a
 * title is a few words, so the scan is cheap and an FTS index over titles would
 * be a second thing to keep in step with every rename. The document *text*
 * index is a different problem and has FTS5 for exactly that reason.
 */
export async function searchTitles(
  db: SQLiteDatabase,
  term: string,
  limit: number,
): Promise<LibraryDocument[]> {
  const trimmed = term.trim();
  if (trimmed === '') {
    return [];
  }
  // `\` escapes the wildcards, so a reader searching for `100%` finds it rather
  // than matching everything.
  const pattern = `%${trimmed.replace(/[\\%_]/g, '\\$&')}%`;
  return await select(
    db,
    `${LIVE} AND (d.title LIKE ? ESCAPE '\\' OR d.author LIKE ? ESCAPE '\\')`,
    'ORDER BY d.lastOpenedAt DESC, d.createdAt DESC LIMIT ?',
    [pattern, pattern, limit],
  );
}

/** "Have I already got this one?", asked once per import. */
export async function findByFingerprint(
  db: SQLiteDatabase,
  fingerprint: string,
): Promise<LibraryDocument | null> {
  const row = await db.getFirstAsync<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} ${DOCUMENT_FROM} WHERE ${LIVE} AND d.fingerprint = ? LIMIT 1`,
    fingerprint,
  );
  return row === null ? null : toLibraryDocument(row);
}

export async function documentByRemoteId(
  db: SQLiteDatabase,
  remoteId: string,
): Promise<LibraryDocument | null> {
  const row = await db.getFirstAsync<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} ${DOCUMENT_FROM} WHERE d.remoteId = ? LIMIT 1`,
    remoteId,
  );
  return row === null ? null : toLibraryDocument(row);
}

/**
 * A document's table of contents, as the account wants it.
 *
 * Stored as JSON in one row rather than a row per entry, for the reason the
 * server gives: an outline is read whole or not at all, so a row per entry is
 * one scan and forty reads to draw one list.
 */
export async function outlineOf(
  db: SQLiteDatabase,
  documentId: string,
): Promise<{ title: string; page: number; depth: number }[]> {
  const row = await db.getFirstAsync<{ entries: string }>(
    'SELECT entries FROM outlines WHERE documentId = ?',
    documentId,
  );
  if (row === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(row.entries);
    return Array.isArray(parsed)
      ? (parsed as { title: string; page: number; depth: number }[])
      : [];
  } catch {
    // An outline that will not parse is an outline the document does without.
    // It is regenerated from the PDF on the next probe.
    return [];
  }
}

export async function saveOutline(
  db: SQLiteDatabase,
  documentId: string,
  entries: { title: string; page: number; depth: number }[],
): Promise<void> {
  await db.runAsync(
    `INSERT INTO outlines (documentId, entries, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT (documentId) DO UPDATE SET entries = excluded.entries, updatedAt = excluded.updatedAt`,
    [documentId, JSON.stringify(entries), Date.now()],
  );
}

/** How many documents the account holds here at all. Drives the empty state. */
export async function documentCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ total: number }>(
    'SELECT COUNT(*) AS total FROM documents WHERE deletedAt IS NULL',
  );
  return row?.total ?? 0;
}

/* ── writes ─────────────────────────────────────────────────────────── */

export type NewDocument = {
  id: string;
  title: string;
  author: string | null;
  pageCount: number | null;
  byteSize: number;
  fingerprint: string | null;
  originalFileName: string | null;
  mimeType: string | null;
};

/**
 * A document this device has just imported.
 *
 * `syncState` is `local` rather than `pending`, and the difference is worth
 * keeping: `pending` is a row the account has and this device has changed,
 * `local` is a row the account has never heard of. Only the second needs its id
 * carried across when the queue drains.
 */
export async function insertLocal(db: SQLiteDatabase, next: NewDocument): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO documents (
       id, title, author, pageCount, byteSize, fingerprint, originalFileName, mimeType,
       processing, currentPage, progress, isFinished, isFavorite,
       createdAt, updatedAt, clientUpdatedAt, syncState
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'probing', 1, 0, 0, 0, ?, ?, ?, 'local')`,
    [
      next.id,
      next.title,
      next.author,
      next.pageCount,
      next.byteSize,
      next.fingerprint,
      next.originalFileName,
      next.mimeType,
      now,
      now,
      now,
    ],
  );
}

/**
 * The fields a reader can change, and the only way to change them.
 *
 * Every one of these bumps `clientUpdatedAt` and marks the row pending, which
 * is what makes the outbox's job mechanical: a row is waiting to go exactly
 * when something set it waiting, rather than because a caller remembered to say
 * so separately.
 */
export type DocumentPatch = Partial<{
  title: string;
  author: string | null;
  isFavorite: boolean;
  isFinished: boolean;
  currentPage: number;
  progress: number;
  readingMode: ReadingMode | null;
  lastOpenedAt: number;
  pageCount: number | null;
  processing: string;
  processingError: string | null;
  hasOutline: boolean;
  syncIntent: string | null;
}>;

const BOOLEAN_FIELDS = new Set(['isFavorite', 'isFinished', 'hasOutline']);

export async function patchLocal(
  db: SQLiteDatabase,
  id: string,
  patch: DocumentPatch,
): Promise<void> {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return;
  }

  const now = Date.now();
  const assignments = entries.map(([field]) => `${field} = ?`);
  const values = entries.map(([field, value]) =>
    BOOLEAN_FIELDS.has(field) ? asFlag(value === true) : (value as string | number | null),
  );

  await db.runAsync(
    `UPDATE documents
        SET ${assignments.join(', ')},
            updatedAt = ?,
            clientUpdatedAt = ?,
            syncState = CASE WHEN syncState = 'local' THEN 'local' ELSE 'pending' END
      WHERE id = ?`,
    [...values, now, now, id],
  );
}

/**
 * Marks a document deleted without removing the row.
 *
 * The row has to outlive the delete, because the outbox still has to tell the
 * account — and because a reconcile that found the row simply absent would
 * assume this device had never heard of it and put it straight back.
 */
export async function softDelete(db: SQLiteDatabase, id: string): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `UPDATE documents SET deletedAt = ?, updatedAt = ?, clientUpdatedAt = ?, syncState = 'pending'
      WHERE id = ?`,
    [now, now, now, id],
  );
}

/** Removes a row for good. Called once the account has been told, and only then. */
export async function purge(db: SQLiteDatabase, id: string): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM documents WHERE id = ?', id);
    await txn.runAsync('DELETE FROM documentFiles WHERE documentId = ?', id);
    await txn.runAsync('DELETE FROM bookmarks WHERE documentId = ?', id);
    await txn.runAsync('DELETE FROM annotations WHERE documentId = ?', id);
    await txn.runAsync('DELETE FROM collectionDocuments WHERE documentId = ?', id);
    await txn.runAsync('DELETE FROM outlines WHERE documentId = ?', id);
  });
}

/**
 * What the account says about one document.
 *
 * Structurally `PublicDocument` with the branded id widened to a string. It is
 * declared rather than imported so that this file — and everything under
 * `local/` — has no opinion about Convex at all; the sync engine is the one
 * place the two vocabularies meet.
 */
export type RemoteDocument = {
  id: string;
  title: string;
  author: string | null;
  pageCount: number | null;
  byteSize: number;
  currentPage: number;
  progress: number;
  isFinished: boolean;
  isFavorite: boolean;
  readingMode: ReadingMode | null;
  lastOpenedAt: number | null;
  createdAt: number;
  isSynced: boolean;
  hasCover: boolean;
  processing: string;
  textStatus: string | null;
  hasOutline: boolean;
  originalFileName: string | null;
  mimeType: string | null;
  fingerprint: string | null;
};

/**
 * Brings the account's answer down without losing what the reader just did.
 *
 * Three cases, and the middle one is the whole reason this is not an `INSERT OR
 * REPLACE`:
 *
 * - **No local row.** Insert it. The local id is the remote id, which is what
 *   keeps every document imported before this database existed on the filename
 *   it already has.
 * - **A local row with unsent changes.** Take only the fields the account owns
 *   — whether there is a cloud copy, what processing decided, whether the text
 *   was extracted — and leave the ones a reader can change alone. Overwriting
 *   `currentPage` here would move somebody back a chapter because the server
 *   has not been told where they are yet. The next reconcile after the queue
 *   drains takes everything.
 * - **A local row that agrees.** Take all of it.
 *
 * A row the device has deleted is skipped outright. The delete is on its way;
 * putting the document back until it lands would make it flicker into the
 * library and out again.
 */
export async function upsertFromRemote(
  db: SQLiteDatabase,
  remote: RemoteDocument,
): Promise<void> {
  const existing = await db.getFirstAsync<{
    id: string;
    syncState: string;
    deletedAt: number | null;
  }>('SELECT id, syncState, deletedAt FROM documents WHERE remoteId = ? OR id = ? LIMIT 1', [
    remote.id,
    remote.id,
  ]);

  const now = Date.now();

  if (existing === null) {
    await db.runAsync(
      `INSERT INTO documents (
         id, remoteId, title, author, pageCount, byteSize, originalFileName, mimeType,
         fingerprint, processing, textStatus, hasOutline, isSynced, hasCover, isFavorite,
         isFinished, currentPage, progress, readingMode, lastOpenedAt, createdAt, updatedAt,
         clientUpdatedAt, syncState
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'synced')`,
      [
        remote.id,
        remote.id,
        remote.title,
        remote.author,
        remote.pageCount,
        remote.byteSize,
        remote.originalFileName,
        remote.mimeType,
        remote.fingerprint,
        remote.processing,
        remote.textStatus,
        asFlag(remote.hasOutline),
        asFlag(remote.isSynced),
        asFlag(remote.hasCover),
        asFlag(remote.isFavorite),
        asFlag(remote.isFinished),
        remote.currentPage,
        remote.progress,
        remote.readingMode,
        remote.lastOpenedAt,
        remote.createdAt,
        now,
      ],
    );
    return;
  }

  if (existing.deletedAt !== null) {
    return;
  }

  if (existing.syncState === 'synced') {
    await db.runAsync(
      `UPDATE documents SET
         remoteId = ?, title = ?, author = ?, pageCount = ?, byteSize = ?,
         originalFileName = ?, mimeType = ?, fingerprint = ?, processing = ?, textStatus = ?,
         hasOutline = ?, isSynced = ?, hasCover = ?, isFavorite = ?, isFinished = ?,
         currentPage = ?, progress = ?, readingMode = ?, lastOpenedAt = ?,
         createdAt = ?, updatedAt = ?
       WHERE id = ?`,
      [
        remote.id,
        remote.title,
        remote.author,
        remote.pageCount,
        remote.byteSize,
        remote.originalFileName,
        remote.mimeType,
        remote.fingerprint,
        remote.processing,
        remote.textStatus,
        asFlag(remote.hasOutline),
        asFlag(remote.isSynced),
        asFlag(remote.hasCover),
        asFlag(remote.isFavorite),
        asFlag(remote.isFinished),
        remote.currentPage,
        remote.progress,
        remote.readingMode,
        remote.lastOpenedAt,
        remote.createdAt,
        now,
        existing.id,
      ],
    );
    return;
  }

  // Unsent local changes. Only the account's own facts.
  await db.runAsync(
    `UPDATE documents SET
       remoteId = ?, pageCount = ?, byteSize = ?, fingerprint = ?, processing = ?,
       textStatus = ?, hasOutline = ?, isSynced = ?, hasCover = ?, updatedAt = ?
     WHERE id = ?`,
    [
      remote.id,
      remote.pageCount,
      remote.byteSize,
      remote.fingerprint,
      remote.processing,
      remote.textStatus,
      asFlag(remote.hasOutline),
      asFlag(remote.isSynced),
      asFlag(remote.hasCover),
      now,
      existing.id,
    ],
  );
}

/**
 * The account has acknowledged this row. It matches again, as far as we know.
 *
 * Only clears `pending` when nothing else has been queued since — the queue's
 * own row for this document is checked by the caller, because a reader who
 * turned another page while the last one was in flight has not been caught up
 * with.
 */
export async function markSynced(
  db: SQLiteDatabase,
  id: string,
  remoteId: string | null,
): Promise<void> {
  await db.runAsync(
    `UPDATE documents
        SET syncState = 'synced',
            remoteId = COALESCE(?, remoteId)
      WHERE id = ?`,
    [remoteId, id],
  );
}

/** This device's id for an account id, or `null` if it has never seen it. */
export async function localIdFor(
  db: SQLiteDatabase,
  remoteId: string,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM documents WHERE remoteId = ? OR id = ? LIMIT 1',
    [remoteId, remoteId],
  );
  return row?.id ?? null;
}

/**
 * Documents whose cloud copy was asked for and has not been made.
 *
 * Only those the account already knows about: a document imported offline has
 * no id there yet, so there is nothing to upload against until its create
 * drains. It keeps the intention and appears here the moment it has one.
 */
/**
 * Documents the account says have a table of contents that this device has not
 * got a copy of.
 *
 * The outline is made on whichever device imported the file — one `<Pdf>` load
 * answers the page count, the cover and the contents together — and pushed up
 * with the processing state. A second phone that only ever *downloaded* the
 * document has never run that probe, so `hasOutline` arrives as true from the
 * account with no entries behind it and Contents is an empty list under a
 * heading that promises one.
 *
 * `LEFT JOIN ... WHERE o.documentId IS NULL` rather than a `NOT IN`, so this
 * stays one index-backed scan whatever the library holds.
 */
export async function documentsMissingOutline(
  db: SQLiteDatabase,
): Promise<{ id: string; remoteId: string }[]> {
  return await db.getAllAsync<{ id: string; remoteId: string }>(
    `SELECT d.id, d.remoteId FROM documents d
       LEFT JOIN outlines o ON o.documentId = d.id
      WHERE d.hasOutline = 1
        AND d.remoteId IS NOT NULL
        AND d.deletedAt IS NULL
        AND o.documentId IS NULL
      ORDER BY d.lastOpenedAt DESC, d.createdAt DESC`,
  );
}

export async function pendingUploads(
  db: SQLiteDatabase,
): Promise<{ id: string; remoteId: string }[]> {
  return await db.getAllAsync<{ id: string; remoteId: string }>(
    `SELECT id, remoteId FROM documents
      WHERE syncIntent = 'upload' AND isSynced = 0 AND remoteId IS NOT NULL AND deletedAt IS NULL
      ORDER BY createdAt ASC`,
  );
}

/** Every remote id this device knows about, for the reconcile's diff. */
export async function knownRemoteIds(db: SQLiteDatabase): Promise<Map<string, string>> {
  const rows = await db.getAllAsync<{ id: string; remoteId: string }>(
    'SELECT id, remoteId FROM documents WHERE remoteId IS NOT NULL AND deletedAt IS NULL',
  );
  return new Map(rows.map((row) => [row.remoteId, row.id]));
}
