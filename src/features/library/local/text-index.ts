import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { log } from '@/lib/logger';

const SCOPE = 'local-search';

/**
 * The device's own copy of the text inside its documents.
 *
 * This is the *second* index, and it answers a question the Convex one cannot:
 * what does this document say, with no connection. Convex's search index is
 * reactive, cross-device and always current; this one is on the phone and works
 * in aeroplane mode. Neither replaces the other, and the search screen picks
 * between them by whether the backend is answering.
 *
 * **It is a mirror, not a second extractor**, and that is not a shortcut —
 * `react-native-pdf` has no text API at all, so the device physically cannot
 * read a PDF's words. The only text in the system is what the Node action read
 * out of the R2 copy, so a document has local text exactly when it has been
 * synced, extracted, and then mirrored down here once.
 *
 * One database per profile, for the reason the library directory is per profile:
 * these are the words of somebody's documents, and two accounts sharing one file
 * is the kind of bug that is only ever discovered by the wrong person.
 *
 * FTS5 rather than `LIKE`. `expo-sqlite` compiles it in on both platforms unless
 * `expo.sqlite.enableFTS` is set to `false`, which nothing here sets — but the
 * `CREATE VIRTUAL TABLE` below is still the proof rather than the assumption,
 * and a build without it disables local search instead of failing to launch.
 */

/**
 * Convex ids are lowercase alphanumerics, and this becomes a filename. Checked
 * for the same reason `paths.ts` checks it: "the id is safe" should be an
 * assertion in the code, not a belief about somebody else's id format.
 */
const SAFE_ID = /^[a-z0-9]+$/i;

type Row = { documentId: string; page: number; snippet: string };

let open: { profileId: string; db: SQLiteDatabase } | null = null;
/** Null until the first open decides. False disables local search entirely. */
let available: boolean | null = null;

/**
 * The database for one profile, creating it on first use.
 *
 * Cached, because opening is the expensive part and the search screen asks per
 * keystroke. A different profile closes the previous handle rather than keeping
 * two open — signing out should leave nothing of one reader's text reachable.
 */
async function database(profileId: string): Promise<SQLiteDatabase | null> {
  if (available === false || !SAFE_ID.test(profileId)) {
    return null;
  }
  if (open !== null && open.profileId === profileId) {
    return open.db;
  }

  if (open !== null) {
    await open.db.closeAsync().catch(() => undefined);
    open = null;
  }

  try {
    const db = await openDatabaseAsync(`pidom-text-${profileId}.db`);
    // `content=''` makes this a contentless table: FTS5 keeps its index and not
    // a second copy of the text. The page number and document id ride along
    // UNINDEXED, which stores them without tokenising them — a page number is
    // not something anyone searches for.
    await db.execAsync(
      `CREATE VIRTUAL TABLE IF NOT EXISTS pages
       USING fts5(text, documentId UNINDEXED, page UNINDEXED, tokenize = 'unicode61');`,
    );
    available = true;
    open = { profileId, db };
    return db;
  } catch (error) {
    // A build without FTS5. Local search is off; everything else works, and the
    // search screen falls back to asking Convex.
    log.error(SCOPE, 'no local text index on this build');
    log.debug(SCOPE, 'could not open the index', error);
    available = false;
    return null;
  }
}

/** Whether local search can answer at all on this build. */
export function localSearchAvailable(): boolean {
  return available !== false;
}

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
  if (db === null || !SAFE_ID.test(documentId)) {
    return;
  }

  try {
    // One transaction, because a half-written document is worse than an absent
    // one: it answers searches with part of a book and no way to tell.
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM pages WHERE documentId = ?', documentId);
      for (const entry of pages) {
        await db.runAsync('INSERT INTO pages (text, documentId, page) VALUES (?, ?, ?)', [
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
  if (db === null) {
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
  if (db === null || trimmed === '') {
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
  if (db === null || !SAFE_ID.test(documentId)) {
    return;
  }
  try {
    await db.runAsync('DELETE FROM pages WHERE documentId = ?', documentId);
  } catch (error) {
    log.debug(SCOPE, 'could not forget a document', error);
  }
}
