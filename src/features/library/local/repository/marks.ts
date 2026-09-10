/**
 * Bookmarks and notes, on the device.
 *
 * The two live in one file because they are the same shape of problem: a small
 * row hanging off a document, written far more often than the document is, and
 * read as a list in page order. They differ in one way that matters to the
 * outbox — the account identifies a bookmark by its page and an annotation by
 * an id it minted — and `ids.ts` explains why that makes a bookmark's local id
 * derivable and an annotation's not.
 */
import { type SQLiteDatabase } from 'expo-sqlite';

import { bookmarkId, mintId } from './ids';
import type { LibraryAnnotation, LibraryBookmark } from './types';

/* ── bookmarks ──────────────────────────────────────────────────────── */

export async function bookmarksOf(
  db: SQLiteDatabase,
  documentId: string,
): Promise<LibraryBookmark[]> {
  return await db.getAllAsync<LibraryBookmark>(
    `SELECT id, documentId, page, label, createdAt, clientUpdatedAt
       FROM bookmarks
      WHERE documentId = ? AND deletedAt IS NULL
      ORDER BY page ASC`,
    documentId,
  );
}

/**
 * The id a page's bookmark has, without touching the database.
 *
 * Re-exported from `ids.ts` so callers outside this folder have one place to
 * ask, rather than each of them knowing how the id is spelled.
 */
export const idOfBookmark = bookmarkId;

/** One bookmark by its id, deleted or not — what the outbox reads before it sends. */
export async function bookmarkRow(db: SQLiteDatabase, id: string): Promise<LibraryBookmark | null> {
  const row = await db.getFirstAsync<LibraryBookmark>(
    'SELECT id, documentId, page, label, createdAt, clientUpdatedAt FROM bookmarks WHERE id = ?',
    id,
  );
  return row;
}

/**
 * Marks a page, or renames the mark that is already there.
 *
 * Never two rows for one page: the id is derived from the pair, so the same
 * page marked twice — on this device or on another — is one row either way.
 * That is also what makes the operation safe to send again, which the outbox
 * relies on.
 */
export async function addBookmark(
  db: SQLiteDatabase,
  documentId: string,
  page: number,
  label: string | null,
): Promise<string> {
  const id = bookmarkId(documentId, page);
  const now = Date.now();

  await db.runAsync(
    `INSERT INTO bookmarks (id, documentId, page, label, createdAt, updatedAt, clientUpdatedAt, syncState, deletedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL)
     ON CONFLICT (id) DO UPDATE SET
       label = excluded.label,
       updatedAt = excluded.updatedAt,
       clientUpdatedAt = excluded.clientUpdatedAt,
       syncState = 'pending',
       deletedAt = NULL`,
    [id, documentId, page, label, now, now, now],
  );

  return id;
}

/** Silent when the page was not marked, which is what a toggle needs. */
export async function removeBookmark(
  db: SQLiteDatabase,
  documentId: string,
  page: number,
): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `UPDATE bookmarks SET deletedAt = ?, updatedAt = ?, clientUpdatedAt = ?, syncState = 'pending'
      WHERE id = ?`,
    [now, now, now, bookmarkId(documentId, page)],
  );
}

/** Returns the local id, so the reconcile can keep a set of what it saw. */
export async function upsertRemoteBookmark(
  db: SQLiteDatabase,
  documentId: string,
  remote: { page: number; label: string | null; createdAt: number },
): Promise<string> {
  const id = bookmarkId(documentId, remote.page);
  await db.runAsync(
    `INSERT INTO bookmarks (id, documentId, page, label, createdAt, updatedAt, clientUpdatedAt, syncState)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'synced')
     ON CONFLICT (id) DO UPDATE SET
       label = CASE WHEN bookmarks.syncState = 'synced' THEN excluded.label ELSE bookmarks.label END,
       createdAt = excluded.createdAt
     WHERE bookmarks.deletedAt IS NULL`,
    [id, documentId, remote.page, remote.label, remote.createdAt, Date.now()],
  );
  return id;
}

/**
 * Drops marks the account no longer has.
 *
 * Only rows that already agreed with it: a bookmark this device made and has
 * not sent yet is not missing from the answer, it is ahead of it.
 */
export async function pruneBookmarks(db: SQLiteDatabase, keep: Set<string>): Promise<void> {
  const rows = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM bookmarks WHERE syncState = 'synced'",
  );
  for (const row of rows) {
    if (!keep.has(row.id)) {
      await db.runAsync('DELETE FROM bookmarks WHERE id = ?', row.id);
    }
  }
}

export async function pruneAnnotations(db: SQLiteDatabase, keep: Set<string>): Promise<void> {
  const rows = await db.getAllAsync<{ id: string; remoteId: string | null }>(
    "SELECT id, remoteId FROM annotations WHERE syncState = 'synced' AND remoteId IS NOT NULL",
  );
  for (const row of rows) {
    if (row.remoteId !== null && !keep.has(row.remoteId)) {
      await db.runAsync('DELETE FROM annotations WHERE id = ?', row.id);
    }
  }
}

/* ── annotations ────────────────────────────────────────────────────── */

export async function annotationsOf(
  db: SQLiteDatabase,
  documentId: string,
): Promise<LibraryAnnotation[]> {
  const rows = await db.getAllAsync<LibraryAnnotation & { kind: string }>(
    `SELECT id, remoteId, documentId, page, kind, text, note, createdAt, updatedAt,
            clientUpdatedAt, authorId, visibility
       FROM annotations
      WHERE documentId = ? AND deletedAt IS NULL
      ORDER BY page ASC, createdAt ASC`,
    documentId,
  );
  return rows.map((row) => ({
    ...row,
    kind: row.kind as 'passage' | 'note',
    visibility: (row.visibility as 'private' | 'shared' | null) ?? 'private',
  }));
}

export async function annotationById(
  db: SQLiteDatabase,
  id: string,
): Promise<LibraryAnnotation | null> {
  const row = await db.getFirstAsync<LibraryAnnotation & { kind: string }>(
    `SELECT id, remoteId, documentId, page, kind, text, note, createdAt, updatedAt,
            clientUpdatedAt, authorId, visibility
       FROM annotations WHERE id = ?`,
    id,
  );
  return row === null
    ? null
    : {
        ...row,
        kind: row.kind as 'passage' | 'note',
        visibility: (row.visibility as 'private' | 'shared' | null) ?? 'private',
      };
}

export async function addAnnotation(
  db: SQLiteDatabase,
  next: {
    documentId: string;
    page: number;
    kind: 'passage' | 'note';
    text: string | null;
    note: string | null;
    /**
     * The account id of whoever is writing it, and whether it is theirs alone.
     *
     * Both optional, and absent means the ordinary case: the reader writing on
     * their own document. A note on a document shared with them is `shared`,
     * because that is what `annotator` is for — a note nobody else can read is
     * not collaboration.
     */
    authorId?: string | null;
    visibility?: 'private' | 'shared';
  },
): Promise<string> {
  const id = mintId();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO annotations (id, documentId, page, kind, text, note, createdAt, updatedAt, clientUpdatedAt, syncState, authorId, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', ?, ?)`,
    [
      id,
      next.documentId,
      next.page,
      next.kind,
      next.text,
      next.note,
      now,
      now,
      now,
      next.authorId ?? null,
      next.visibility ?? 'private',
    ],
  );
  return id;
}

export async function updateAnnotation(
  db: SQLiteDatabase,
  id: string,
  note: string,
): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `UPDATE annotations
        SET note = ?, updatedAt = ?, clientUpdatedAt = ?,
            syncState = CASE WHEN syncState = 'local' THEN 'local' ELSE 'pending' END
      WHERE id = ?`,
    [note, now, now, id],
  );
}

export async function removeAnnotation(db: SQLiteDatabase, id: string): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `UPDATE annotations SET deletedAt = ?, updatedAt = ?, clientUpdatedAt = ?, syncState = 'pending'
      WHERE id = ?`,
    [now, now, now, id],
  );
}

/** The account's id for a row this device created, once the create lands. */
export async function attachAnnotationRemoteId(
  db: SQLiteDatabase,
  id: string,
  remoteId: string,
): Promise<void> {
  await db.runAsync("UPDATE annotations SET remoteId = ?, syncState = 'synced' WHERE id = ?", [
    remoteId,
    id,
  ]);
}

export async function upsertRemoteAnnotation(
  db: SQLiteDatabase,
  remote: {
    id: string;
    documentId: string;
    page: number;
    kind: 'passage' | 'note';
    text: string | null;
    note: string | null;
    createdAt: number;
    updatedAt: number;
  },
): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string; syncState: string }>(
    'SELECT id, syncState FROM annotations WHERE remoteId = ? OR id = ? LIMIT 1',
    [remote.id, remote.id],
  );

  if (existing === null) {
    await db.runAsync(
      `INSERT INTO annotations (id, remoteId, documentId, page, kind, text, note, createdAt, updatedAt, clientUpdatedAt, syncState)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'synced')`,
      [
        remote.id,
        remote.id,
        remote.documentId,
        remote.page,
        remote.kind,
        remote.text,
        remote.note,
        remote.createdAt,
        remote.updatedAt,
      ],
    );
    return;
  }

  // A row with unsent changes keeps the reader's words. Theirs is the version
  // that has not been seen anywhere else yet.
  if (existing.syncState !== 'synced') {
    return;
  }

  await db.runAsync(
    `UPDATE annotations SET remoteId = ?, page = ?, kind = ?, text = ?, note = ?, updatedAt = ?
      WHERE id = ? AND deletedAt IS NULL`,
    [remote.id, remote.page, remote.kind, remote.text, remote.note, remote.updatedAt, existing.id],
  );
}

/** Removes rows for good once the account has been told. */
export async function purgeMarks(db: SQLiteDatabase, ids: string[]): Promise<void> {
  for (const id of ids) {
    await db.runAsync('DELETE FROM bookmarks WHERE id = ?', id);
    await db.runAsync('DELETE FROM annotations WHERE id = ?', id);
  }
}
