import { log } from '@/lib/logger';

import { database, localSearchAvailable } from './db';
import { inTransaction } from './transaction';

const SCOPE = 'local-search';

/**
 * The device's own copy of the text inside its documents.
 *
 * This is the *second* index, and it answers a question the Convex one cannot:
 * what does this document say, with no connection. Convex's search index is
 * reactive, cross-device and always current; this one is on the phone and works
 * in aeroplane mode. Neither replaces the other — the search screen reads this
 * one first, because it is the one that is always there, and widens to Convex
 * when the backend is answering.
 *
 * **It is a mirror, not a second extractor**, and that is not a shortcut —
 * `react-native-pdf` has no text API at all, so the device physically cannot
 * read a PDF's words. The only text in the system is what the Node action read
 * out of the R2 copy, so a document has local text exactly when it has been
 * synced, extracted, and then mirrored down here once.
 *
 * The `pages` table lives in the profile's own database beside the library
 * rather than in a file of its own. It used to be separate and unencrypted;
 * `migrations.ts` carries the old one across on first open and deletes it,
 * because a plaintext copy of somebody's books sitting next to an encrypted one
 * makes the encryption decorative.
 */

/**
 * Ids become filenames elsewhere in this feature. Checked here too, for the
 * same reason `paths.ts` checks them: "the id is safe" should be an assertion
 * in the code, not a belief about somebody else's id format.
 */
const SAFE_ID = /^[a-z0-9]+$/i;

type Row = { documentId: string; page: number; snippet: string };

export { localSearchAvailable };

/**
 * Replaces a document's mirrored text.
 *
 * Replace rather than append, so a re-mirror after a reprocess cannot leave two
 * copies of a page in the index — FTS5 has no upsert, and a duplicate row is a
 * duplicate hit.
 */
export async function mirrorPages(
  profileId: string,
  documentId: string,
  pages: { page: number; text: string }[],
): Promise<void> {
  const db = await database(profileId);
  if (db === null || !localSearchAvailable() || !SAFE_ID.test(documentId)) {
    return;
  }

  try {
    // Exclusive, because a half-written document is worse than an absent one:
    // it answers searches with part of a book and no way to tell. The ordinary
    // transaction is documented as letting outside queries interleave, and a
    // search running mid-write is exactly that.
    await inTransaction(db, async (txn) => {
      await txn.runAsync('DELETE FROM pages WHERE documentId = ?', documentId);
      for (const entry of pages) {
        await txn.runAsync('INSERT INTO pages (text, documentId, page) VALUES (?, ?, ?)', [
          entry.text,
          documentId,
          entry.page,
        ]);
      }
    });
  } catch (error) {
    log.debug(SCOPE, 'could not mirror a document', error);
  }
}

/** Which documents already have their text here, so the mirror runs once each. */
export async function mirroredIds(profileId: string): Promise<Set<string>> {
  const db = await database(profileId);
  if (db === null || !localSearchAvailable()) {
    return new Set();
  }
  try {
    const rows = await db.getAllAsync<{ documentId: string }>(
      'SELECT DISTINCT documentId FROM pages',
    );
    return new Set(rows.map((row) => row.documentId));
  } catch (error) {
    log.debug(SCOPE, 'could not list mirrored documents', error);
    return new Set();
  }
}

/**
 * Pages matching a term, with the line the term appears on.
 *
 * `snippet()` is FTS5's own excerpt function, so the highlighting is done by the
 * thing that found the match rather than by a second search over the text in
 * JavaScript. The markers are the same shape the Convex path produces, so the
 * screen renders both without knowing which answered.
 */
export async function searchLocally(
  profileId: string,
  term: string,
  documentId: string | null,
  limit: number,
): Promise<Row[]> {
  const db = await database(profileId);
  const trimmed = term.trim();
  if (db === null || !localSearchAvailable() || trimmed === '') {
    return [];
  }

  try {
    // The term is passed as a bound parameter and quoted as an FTS5 string, so
    // a reader typing `AND` or `*` searches for those characters rather than
    // writing a query. Double quotes are doubled, which is FTS5's own escape.
    const query = `"${trimmed.replace(/"/g, '""')}"`;
    const where = documentId === null ? '' : ' AND documentId = ?';
    const params = documentId === null ? [query, limit] : [query, documentId, limit];

    return await db.getAllAsync<Row>(
      `SELECT documentId, page, snippet(pages, 0, '', '', '…', 24) AS snippet
       FROM pages WHERE pages MATCH ?${where}
       ORDER BY rank LIMIT ?`,
      params,
    );
  } catch (error) {
    // A malformed FTS expression the escaping did not catch. An empty result is
    // the honest answer; the screen already says when it found nothing.
    log.debug(SCOPE, 'local search failed', error);
    return [];
  }
}

/** Drops a document's text. Called wherever the local file is dropped. */
export async function forgetLocally(profileId: string, documentId: string): Promise<void> {
  const db = await database(profileId);
  if (db === null || !localSearchAvailable() || !SAFE_ID.test(documentId)) {
    return;
  }
  try {
    await db.runAsync('DELETE FROM pages WHERE documentId = ?', documentId);
  } catch (error) {
    log.debug(SCOPE, 'could not forget a document', error);
  }
}
