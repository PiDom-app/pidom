/**
 * Collections, on the device.
 *
 * A collection owns no files and duplicates no document — the relationship and
 * nothing else, which is the stance `convex/schema.ts` takes and this side
 * keeps.
 *
 * **The count is computed rather than stored.** The server denormalises it
 * because counting membership rows there means an index scan per collection on
 * every render of the home screen. Here it is a `COUNT(*)` over a few dozen
 * rows in a local B-tree, and a stored counter would be a number two devices
 * could disagree about for no benefit.
 */
import { type SQLiteDatabase } from 'expo-sqlite';

import { mintId } from './ids';
import {
  DOCUMENT_COLUMNS,
  DOCUMENT_FROM,
  toLibraryDocument,
  type DocumentRow,
  type LibraryCollection,
  type LibraryDocument,
} from './types';
import { inTransaction } from '../transaction';

/** Up to four covers on a collection tile, newest first. */
const MOSAIC = 4;

type CollectionRow = {
  id: string;
  remoteId: string | null;
  name: string;
  createdAt: number;
  documentCount: number;
};

const LIST_SQL = `
  SELECT c.id, c.remoteId, c.name, c.createdAt,
         (SELECT COUNT(*) FROM collectionDocuments m
           WHERE m.collectionId = c.id AND m.deletedAt IS NULL) AS documentCount
    FROM collections c
   WHERE c.deletedAt IS NULL
   ORDER BY c.createdAt DESC
`;

async function withCovers(
  db: SQLiteDatabase,
  rows: CollectionRow[],
): Promise<LibraryCollection[]> {
  const collections: LibraryCollection[] = [];

  for (const row of rows) {
    const covers = await db.getAllAsync<{ documentId: string }>(
      `SELECT m.documentId FROM collectionDocuments m
         JOIN documents d ON d.id = m.documentId
        WHERE m.collectionId = ? AND m.deletedAt IS NULL AND d.deletedAt IS NULL
        ORDER BY m.addedAt DESC LIMIT ${MOSAIC}`,
      row.id,
    );
    collections.push({
      id: row.id,
      remoteId: row.remoteId,
      name: row.name,
      documentCount: row.documentCount,
      coverDocumentIds: covers.map((cover) => cover.documentId),
      createdAt: row.createdAt,
    });
  }

  return collections;
}

export async function listCollections(db: SQLiteDatabase): Promise<LibraryCollection[]> {
  return await withCovers(db, await db.getAllAsync<CollectionRow>(LIST_SQL));
}

export async function collectionById(
  db: SQLiteDatabase,
  id: string,
): Promise<LibraryCollection | null> {
  const row = await db.getFirstAsync<CollectionRow>(
    `SELECT c.id, c.remoteId, c.name, c.createdAt,
            (SELECT COUNT(*) FROM collectionDocuments m
              WHERE m.collectionId = c.id AND m.deletedAt IS NULL) AS documentCount
       FROM collections c WHERE c.id = ? AND c.deletedAt IS NULL`,
    id,
  );
  if (row === null) {
    return null;
  }
  const [collection] = await withCovers(db, [row]);
  return collection ?? null;
}

export async function documentsIn(
  db: SQLiteDatabase,
  collectionId: string,
  limit: number,
): Promise<LibraryDocument[]> {
  const rows = await db.getAllAsync<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} ${DOCUMENT_FROM}
       JOIN collectionDocuments m ON m.documentId = d.id
      WHERE m.collectionId = ? AND m.deletedAt IS NULL AND d.deletedAt IS NULL
      ORDER BY m.addedAt DESC LIMIT ?`,
    [collectionId, limit],
  );
  return rows.map(toLibraryDocument);
}

/** Which collections a document is in — the ticks in the picker. */
export async function collectionsOf(
  db: SQLiteDatabase,
  documentId: string,
): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ collectionId: string }>(
    'SELECT collectionId FROM collectionDocuments WHERE documentId = ? AND deletedAt IS NULL',
    documentId,
  );
  return new Set(rows.map((row) => row.collectionId));
}

/**
 * One collection by its id, deleted or not.
 *
 * Without the `deletedAt IS NULL` every other read here carries, because the
 * outbox has to be able to read a row precisely in order to tell the account it
 * is gone.
 */
export async function collectionRow(
  db: SQLiteDatabase,
  id: string,
): Promise<{
  id: string;
  remoteId: string | null;
  name: string;
  clientUpdatedAt: number;
} | null> {
  // `clientUpdatedAt` is here for the outbox rather than for a screen: it is
  // when the reader renamed this collection, and the account orders two
  // devices by it. Reading it at send time instead would make whichever phone
  // reconnected last the winner.
  return await db.getFirstAsync<{
    id: string;
    remoteId: string | null;
    name: string;
    clientUpdatedAt: number;
  }>('SELECT id, remoteId, name, clientUpdatedAt FROM collections WHERE id = ?', id);
}

/* ── writes ─────────────────────────────────────────────────────────── */

export async function createCollection(db: SQLiteDatabase, name: string): Promise<string> {
  const id = mintId();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO collections (id, name, createdAt, updatedAt, clientUpdatedAt, syncState)
     VALUES (?, ?, ?, ?, ?, 'local')`,
    [id, name, now, now, now],
  );
  return id;
}

export async function renameCollection(
  db: SQLiteDatabase,
  id: string,
  name: string,
): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `UPDATE collections
        SET name = ?, updatedAt = ?, clientUpdatedAt = ?,
            syncState = CASE WHEN syncState = 'local' THEN 'local' ELSE 'pending' END
      WHERE id = ?`,
    [name, now, now, id],
  );
}

export async function removeCollection(db: SQLiteDatabase, id: string): Promise<void> {
  const now = Date.now();
  await inTransaction(db, async (txn) => {
    await txn.runAsync(
      `UPDATE collections SET deletedAt = ?, updatedAt = ?, clientUpdatedAt = ?, syncState = 'pending'
        WHERE id = ?`,
      [now, now, now, id],
    );
    // Membership goes with it locally. The account cascades its own when the
    // delete lands, so these rows are never sent — they are removed outright
    // rather than left as pending operations nobody will ever drain.
    await txn.runAsync('DELETE FROM collectionDocuments WHERE collectionId = ?', id);
  });
}

/** Membership as a set operation: adding twice is adding once. */
export async function addToCollection(
  db: SQLiteDatabase,
  collectionId: string,
  documentId: string,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO collectionDocuments (collectionId, documentId, addedAt, syncState, deletedAt)
     VALUES (?, ?, ?, 'pending', NULL)
     ON CONFLICT (collectionId, documentId) DO UPDATE SET
       deletedAt = NULL, syncState = 'pending', addedAt = excluded.addedAt`,
    [collectionId, documentId, Date.now()],
  );
}

export async function removeFromCollection(
  db: SQLiteDatabase,
  collectionId: string,
  documentId: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE collectionDocuments SET deletedAt = ?, syncState = 'pending'
      WHERE collectionId = ? AND documentId = ?`,
    [Date.now(), collectionId, documentId],
  );
}

export async function attachCollectionRemoteId(
  db: SQLiteDatabase,
  id: string,
  remoteId: string,
): Promise<void> {
  await db.runAsync(
    "UPDATE collections SET remoteId = ?, syncState = 'synced' WHERE id = ?",
    [remoteId, id],
  );
}

export async function upsertRemoteCollection(
  db: SQLiteDatabase,
  remote: { id: string; name: string; createdAt: number },
): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string; syncState: string }>(
    'SELECT id, syncState FROM collections WHERE remoteId = ? OR id = ? LIMIT 1',
    [remote.id, remote.id],
  );

  if (existing === null) {
    await db.runAsync(
      `INSERT INTO collections (id, remoteId, name, createdAt, updatedAt, clientUpdatedAt, syncState)
       VALUES (?, ?, ?, ?, ?, 0, 'synced')`,
      [remote.id, remote.id, remote.name, remote.createdAt, Date.now()],
    );
    return;
  }

  if (existing.syncState !== 'synced') {
    await db.runAsync('UPDATE collections SET remoteId = ? WHERE id = ?', [remote.id, existing.id]);
    return;
  }

  await db.runAsync(
    'UPDATE collections SET remoteId = ?, name = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL',
    [remote.id, remote.name, Date.now(), existing.id],
  );
}

export async function replaceRemoteMembership(
  db: SQLiteDatabase,
  collectionId: string,
  documentIds: string[],
): Promise<void> {
  await inTransaction(db, async (txn) => {
    // Only the rows that agree with the account are replaced. A membership this
    // device changed and has not sent yet is left where the reader put it.
    await txn.runAsync(
      "DELETE FROM collectionDocuments WHERE collectionId = ? AND syncState = 'synced'",
      collectionId,
    );
    const now = Date.now();
    for (const documentId of documentIds) {
      await txn.runAsync(
        `INSERT INTO collectionDocuments (collectionId, documentId, addedAt, syncState)
         VALUES (?, ?, ?, 'synced')
         ON CONFLICT (collectionId, documentId) DO NOTHING`,
        [collectionId, documentId, now],
      );
    }
  });
}

export async function localIdFor(db: SQLiteDatabase, remoteId: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM collections WHERE remoteId = ? OR id = ? LIMIT 1',
    [remoteId, remoteId],
  );
  return row?.id ?? null;
}

/** Every live collection on this device, for the membership pass. */
export async function localIdsOf(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM collections WHERE deletedAt IS NULL',
  );
  return rows.map((row) => row.id);
}

/** Drops collections the account no longer has, keeping unsent local ones. */
export async function pruneCollections(db: SQLiteDatabase, keep: Set<string>): Promise<void> {
  const rows = await db.getAllAsync<{ id: string; remoteId: string | null }>(
    "SELECT id, remoteId FROM collections WHERE syncState = 'synced' AND remoteId IS NOT NULL",
  );
  for (const row of rows) {
    if (row.remoteId !== null && !keep.has(row.remoteId)) {
      await purgeCollection(db, row.id);
    }
  }
}

/** One membership row, named `<collectionId>:<documentId>` as the queue does. */
export async function purgeMembership(db: SQLiteDatabase, entityId: string): Promise<void> {
  const [collectionId, documentId] = entityId.split(':');
  if (collectionId === undefined || documentId === undefined) {
    return;
  }
  await db.runAsync(
    'DELETE FROM collectionDocuments WHERE collectionId = ? AND documentId = ?',
    [collectionId, documentId],
  );
}

export async function purgeCollection(db: SQLiteDatabase, id: string): Promise<void> {
  await inTransaction(db, async (txn) => {
    await txn.runAsync('DELETE FROM collections WHERE id = ?', id);
    await txn.runAsync('DELETE FROM collectionDocuments WHERE collectionId = ?', id);
  });
}
