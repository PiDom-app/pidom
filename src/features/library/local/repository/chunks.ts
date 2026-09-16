/**
 * What a document means, as far as this device can say.
 *
 * Three tables and one rule between them: **the text is not here.** A chunk is
 * a range — a page and a character offset at each end — into the FTS5 `pages`
 * table that `use-text-mirror.ts` already fills. Storing the passages as well
 * would put a second copy of every book on the phone, and the phone's disk is
 * the resource this whole feature is spending.
 *
 * A vector is 384 signed bytes and the float that de-quantises them, 388 bytes
 * a passage and about 400 KB a book. It is a BLOB in an ordinary table rather
 * than a `vec0` virtual table because `sqlite-vec`'s iOS framework is missing
 * from `expo-sqlite@57.0.2` (expo/expo#43455, open) — a retrieval path that
 * exists on Android and not on iOS is two products, and the scan is fast enough
 * without it: 384 multiply-adds over an `Int8Array` view of the BLOB, with no
 * allocation in the loop.
 *
 * `documentVectors` is one row per document, and it is what makes a
 * library-wide question cheap. A hundred books is a hundred dot products to
 * decide which three are worth opening, rather than three hundred thousand.
 *
 * Everything written here is inside the profile's SQLCipher database, under the
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` key `db.ts` mints. No vector leaves the
 * phone; see the `AiBoundary` artboard for the whole of what does.
 */
import { type SQLiteDatabase } from 'expo-sqlite';

import { inTransaction } from '../transaction';

/** A passage, as a range rather than as text. */
export type Chunk = {
  id: string;
  documentId: string;
  ordinal: number;
  startPage: number;
  endPage: number;
  /** Characters into `startPage`'s text. */
  startOffset: number;
  /** Characters into `endPage`'s text, exclusive. */
  endOffset: number;
  chars: number;
};

/** A chunk and its embedding, which is what a scan holds. */
export type StoredVector = {
  chunkId: string;
  documentId: string;
  vector: Uint8Array;
  scale: number;
};

export type DocumentVector = {
  documentId: string;
  vector: Uint8Array;
  scale: number;
  modelVersion: string;
  chunkVersion: number;
  chunkCount: number;
  bytes: number;
  updatedAt: number;
};

/**
 * The chunk id for an ordinal.
 *
 * Derived rather than minted, the way `bookmarkId` is. A batch that failed
 * halfway and ran again overwrites the same rows instead of appending a second
 * copy of the passages it had already done — which is what makes the whole
 * pipeline safe to interrupt.
 */
export function chunkId(documentId: string, chunkVersion: number, ordinal: number): string {
  return `${documentId}c${chunkVersion}x${ordinal}`;
}

/**
 * Replaces one document's chunks at a given version.
 *
 * Delete-then-insert inside one transaction, and scoped to the version: a
 * rebuild at `chunkVersion` 2 leaves version 1's rows and vectors alone, so the
 * reader goes on searching the old index until the new one is complete and the
 * switch is one write to `documentVectors`. An index mutated underneath
 * somebody mid-search is an index that answers half of one question with half
 * of another.
 */
export async function replaceChunks(
  db: SQLiteDatabase,
  documentId: string,
  chunkVersion: number,
  chunks: readonly Omit<Chunk, 'id' | 'documentId'>[],
): Promise<void> {
  const now = Date.now();
  await inTransaction(db, async (txn) => {
    await txn.runAsync(`DELETE FROM chunks WHERE documentId = ? AND chunkVersion = ?`, [
      documentId,
      chunkVersion,
    ]);
    for (const chunk of chunks) {
      await txn.runAsync(
        `INSERT INTO chunks
           (id, documentId, ordinal, startPage, endPage, startOffset, endOffset, chars, chunkVersion, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          chunkId(documentId, chunkVersion, chunk.ordinal),
          documentId,
          chunk.ordinal,
          chunk.startPage,
          chunk.endPage,
          chunk.startOffset,
          chunk.endOffset,
          chunk.chars,
          chunkVersion,
          now,
        ],
      );
    }
  });
}

/**
 * One batch of chunks to embed, starting after `afterOrdinal`.
 *
 * The cursor on the job row is an ordinal, so resuming is this query with a
 * different number. `LIMIT` rather than reading the book: the whole point of
 * the batch is that neither the text nor the tensors are ever all in memory at
 * once.
 */
export async function chunksAfter(
  db: SQLiteDatabase,
  documentId: string,
  chunkVersion: number,
  afterOrdinal: number,
  limit: number,
): Promise<Chunk[]> {
  return await db.getAllAsync<Chunk>(
    `SELECT id, documentId, ordinal, startPage, endPage, startOffset, endOffset, chars
     FROM chunks
     WHERE documentId = ? AND chunkVersion = ? AND ordinal > ?
     ORDER BY ordinal ASC
     LIMIT ?`,
    [documentId, chunkVersion, afterOrdinal, limit],
  );
}

export async function chunkCount(
  db: SQLiteDatabase,
  documentId: string,
  chunkVersion: number,
): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM chunks WHERE documentId = ? AND chunkVersion = ?`,
    [documentId, chunkVersion],
  );
  return row?.n ?? 0;
}

/** The chunks covering a page, for "what is near where the reader is". */
export async function chunksOnPage(
  db: SQLiteDatabase,
  documentId: string,
  chunkVersion: number,
  page: number,
): Promise<Chunk[]> {
  return await db.getAllAsync<Chunk>(
    `SELECT id, documentId, ordinal, startPage, endPage, startOffset, endOffset, chars
     FROM chunks
     WHERE documentId = ? AND chunkVersion = ? AND startPage <= ? AND endPage >= ?
     ORDER BY ordinal ASC`,
    [documentId, chunkVersion, page, page],
  );
}

/**
 * Commits a batch of vectors.
 *
 * One transaction for the batch, not one per vector. A 1,000-page book is a few
 * thousand of these and a transaction each would spend most of an evening in
 * `BEGIN`.
 */
export async function writeVectors(
  db: SQLiteDatabase,
  documentId: string,
  modelVersion: string,
  vectors: readonly { chunkId: string; vector: Uint8Array; scale: number }[],
): Promise<void> {
  const now = Date.now();
  await inTransaction(db, async (txn) => {
    for (const row of vectors) {
      await txn.runAsync(
        `INSERT INTO embeddings (chunkId, documentId, vector, scale, modelVersion, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (chunkId) DO UPDATE SET
           vector = excluded.vector,
           scale = excluded.scale,
           modelVersion = excluded.modelVersion,
           createdAt = excluded.createdAt`,
        [row.chunkId, documentId, row.vector, row.scale, modelVersion, now],
      );
    }
  });
}

/**
 * Every vector for a document, for a scan.
 *
 * Returns the chunk ranges alongside, because a hit is useless without the page
 * it is on and a second query per hit would be a round trip per result.
 */
export async function vectorsOf(
  db: SQLiteDatabase,
  documentId: string,
  modelVersion: string,
): Promise<(StoredVector & { ordinal: number; startPage: number; endPage: number })[]> {
  return await db.getAllAsync<
    StoredVector & { ordinal: number; startPage: number; endPage: number }
  >(
    `SELECT e.chunkId, e.documentId, e.vector, e.scale, c.ordinal, c.startPage, c.endPage
     FROM embeddings e
     JOIN chunks c ON c.id = e.chunkId
     WHERE e.documentId = ? AND e.modelVersion = ?
     ORDER BY c.ordinal ASC`,
    [documentId, modelVersion],
  );
}

/** Every document-level vector, which is the first stage of a library search. */
export async function documentVectors(
  db: SQLiteDatabase,
  modelVersion: string,
): Promise<DocumentVector[]> {
  return await db.getAllAsync<DocumentVector>(
    `SELECT documentId, vector, scale, modelVersion, chunkVersion, chunkCount, bytes, updatedAt
     FROM documentVectors WHERE modelVersion = ?`,
    modelVersion,
  );
}

export async function documentVector(
  db: SQLiteDatabase,
  documentId: string,
): Promise<DocumentVector | null> {
  const row = await db.getFirstAsync<DocumentVector>(
    `SELECT documentId, vector, scale, modelVersion, chunkVersion, chunkCount, bytes, updatedAt
     FROM documentVectors WHERE documentId = ?`,
    documentId,
  );
  return row ?? null;
}

/**
 * Publishes a finished index.
 *
 * This single write is the switch. Until a `documentVectors` row names a
 * version, nothing searches that version's chunks — so a rebuild can take an
 * evening, be interrupted four times, and never once leave the reader with half
 * an index. `bytes` is recorded here rather than counted because the ceiling is
 * checked on every pass and `SUM(LENGTH(vector))` over a library is not a thing
 * to do on a tick.
 */
export async function publishIndex(
  db: SQLiteDatabase,
  entry: Omit<DocumentVector, 'updatedAt'>,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO documentVectors
       (documentId, vector, scale, modelVersion, chunkVersion, chunkCount, bytes, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (documentId) DO UPDATE SET
       vector = excluded.vector,
       scale = excluded.scale,
       modelVersion = excluded.modelVersion,
       chunkVersion = excluded.chunkVersion,
       chunkCount = excluded.chunkCount,
       bytes = excluded.bytes,
       updatedAt = excluded.updatedAt`,
    [
      entry.documentId,
      entry.vector,
      entry.scale,
      entry.modelVersion,
      entry.chunkVersion,
      entry.chunkCount,
      entry.bytes,
      Date.now(),
    ],
  );
}

/** The ids with a usable index, for the eligibility filter and the counts. */
export async function indexedIds(
  db: SQLiteDatabase,
  modelVersion: string,
  chunkVersion: number,
): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ documentId: string }>(
    `SELECT documentId FROM documentVectors WHERE modelVersion = ? AND chunkVersion = ?`,
    [modelVersion, chunkVersion],
  );
  return new Set(rows.map((row) => row.documentId));
}

/** What every index on this device adds up to, for the ceiling and the screen. */
export async function indexBytes(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ bytes: number | null }>(
    `SELECT SUM(bytes) AS bytes FROM documentVectors`,
  );
  return row?.bytes ?? 0;
}

/**
 * The least recently opened indexes, for eviction at the ceiling.
 *
 * Ordered by the document's own `lastOpenedAt` rather than by when the index
 * was built: the question is which book the reader is least likely to search
 * next, and that is not the same as which index is oldest. A book indexed
 * yesterday and never opened should go before one indexed last year and read
 * this morning.
 */
export async function evictionCandidates(
  db: SQLiteDatabase,
  limit: number,
): Promise<{ documentId: string; bytes: number }[]> {
  return await db.getAllAsync<{ documentId: string; bytes: number }>(
    `SELECT v.documentId, v.bytes
     FROM documentVectors v
     JOIN documents d ON d.id = v.documentId
     WHERE d.deletedAt IS NULL
     ORDER BY COALESCE(d.lastOpenedAt, 0) ASC, v.updatedAt ASC
     LIMIT ?`,
    limit,
  );
}

/**
 * Everything this device worked out about one document, dropped.
 *
 * Called by `sweepDocument` and by `Documents.purge`, which are the two places
 * a document stops existing here. `embeddings` has `ON DELETE CASCADE` from
 * `chunks`, but `PRAGMA foreign_keys` being on is a property of the connection
 * rather than of the schema, so the delete is explicit — a cascade that did not
 * happen leaves a phone carrying vectors for a book nobody can name.
 */
export async function forgetIndex(db: SQLiteDatabase, documentId: string): Promise<void> {
  await inTransaction(db, async (txn) => {
    await txn.runAsync(`DELETE FROM embeddings WHERE documentId = ?`, documentId);
    await txn.runAsync(`DELETE FROM chunks WHERE documentId = ?`, documentId);
    await txn.runAsync(`DELETE FROM documentVectors WHERE documentId = ?`, documentId);
  });
}

/** Drops every index on the device, for "rebuild everything". */
export async function forgetEverything(db: SQLiteDatabase): Promise<void> {
  await inTransaction(db, async (txn) => {
    await txn.runAsync(`DELETE FROM embeddings`);
    await txn.runAsync(`DELETE FROM chunks`);
    await txn.runAsync(`DELETE FROM documentVectors`);
  });
}

/**
 * The last few messages of a conversation, so a reopened sheet is not blank.
 *
 * A bound rather than a store. The conversation itself lives in the account and
 * is deleted there after a month; this is a convenience for the moment somebody
 * opens Ask in a tunnel, and it is trimmed on every write so it cannot become a
 * second, permanent, un-swept copy of every chat the reader has ever had.
 */
export async function cacheMessages(
  db: SQLiteDatabase,
  threadId: string,
  messages: readonly { ordinal: number; role: string; body: string }[],
  keep: number,
): Promise<void> {
  const now = Date.now();
  await inTransaction(db, async (txn) => {
    for (const message of messages) {
      await txn.runAsync(
        `INSERT INTO askCache (threadId, ordinal, role, body, createdAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (threadId, ordinal) DO UPDATE SET
           role = excluded.role, body = excluded.body, createdAt = excluded.createdAt`,
        [threadId, message.ordinal, message.role, message.body, now],
      );
    }
    await txn.runAsync(
      `DELETE FROM askCache
       WHERE threadId = ? AND ordinal NOT IN (
         SELECT ordinal FROM askCache WHERE threadId = ? ORDER BY ordinal DESC LIMIT ?
       )`,
      [threadId, threadId, keep],
    );
  });
}

export async function cachedMessages(
  db: SQLiteDatabase,
  threadId: string,
): Promise<{ ordinal: number; role: string; body: string }[]> {
  return await db.getAllAsync<{ ordinal: number; role: string; body: string }>(
    `SELECT ordinal, role, body FROM askCache WHERE threadId = ? ORDER BY ordinal ASC`,
    threadId,
  );
}

/** Drops a conversation's cache, when the account says it is gone. */
export async function forgetCachedThread(db: SQLiteDatabase, threadId: string): Promise<void> {
  await db.runAsync(`DELETE FROM askCache WHERE threadId = ?`, threadId);
}

/**
 * Drops cached turns the account can no longer be holding.
 *
 * By age rather than by asking, and that is what makes it correct offline: the
 * server clamps every thread's life to `AI_RETENTION_MAX_DAYS`, so anything
 * cached longer ago than that is expired there whatever the device has heard.
 * No thread list, no round trip, and no window in which the claim "deleted
 * after a month" is true on the server and false on the phone.
 *
 * A delete-by-absence against the live thread list would be the reconcile
 * shape, and it would need a network to run — which is the one condition under
 * which somebody is most likely to be reading old cached answers.
 */
export async function pruneCachedBefore(db: SQLiteDatabase, cutoff: number): Promise<number> {
  const result = await db.runAsync(`DELETE FROM askCache WHERE createdAt < ?`, cutoff);
  return result.changes;
}
