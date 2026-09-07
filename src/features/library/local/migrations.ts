/**
 * The shape of the device's database, and how it gets there.
 *
 * Versioned through `PRAGMA user_version`, which is the pattern Expo's own
 * SQLite documentation gives: read the number, run every step above it in
 * order, write the number back. A step is never edited once it has shipped —
 * a phone that has already run it will not run it again, so a change to an old
 * step is a change that only new installs ever see.
 *
 * Each step runs inside `withExclusiveTransactionAsync` rather than
 * `withTransactionAsync`. Expo's documentation is explicit that the ordinary
 * one is non-exclusive and lets queries outside the callback interleave, which
 * for a migration means a screen reading a table that is half-built.
 */
import { defaultDatabaseDirectory, deleteDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { log } from '@/lib/logger';

const SCOPE = 'local-db';

/** Bump this, and add the step, whenever the schema changes. */
export const SCHEMA_VERSION = 1;

/**
 * Everything except the search index.
 *
 * The FTS5 virtual table is deliberately not here — see `ensureTextIndex`. A
 * build compiled without FTS5 must lose local search and keep its library, and
 * a `CREATE VIRTUAL TABLE` inside a migration would lose both.
 *
 * `deletedAt` is on every synchronised table because a delete is an operation
 * that still has to be sent. A row removed outright is a row the outbox can no
 * longer name, and a reconcile that finds it missing locally would put it back.
 *
 * `clientUpdatedAt` is the device's own clock, sent with every last-write-wins
 * patch so the backend can refuse a write that is older than what it holds.
 * `updatedAt` beside it is the server's, and the two are not interchangeable.
 *
 * `syncQueue.opId` is `<entity>:<entityId>` and the primary key, which is what
 * makes coalescing structural rather than a pass over the queue: a hundred page
 * turns in one document cannot become a hundred rows, because they are all the
 * same row. What changed is recorded as a set of field names in `payload`, and
 * the values are read off the entity when the operation is finally sent — so
 * the account receives where the reader ended up rather than every place they
 * passed through.
 */
const V1 = `
CREATE TABLE documents (
  id                TEXT PRIMARY KEY NOT NULL,
  remoteId          TEXT UNIQUE,
  title             TEXT NOT NULL,
  author            TEXT,
  pageCount         INTEGER,
  byteSize          INTEGER NOT NULL DEFAULT 0,
  fingerprint       TEXT,
  contentHash       TEXT,
  originalFileName  TEXT,
  mimeType          TEXT,
  processing        TEXT,
  processingError   TEXT,
  textStatus        TEXT,
  hasOutline        INTEGER NOT NULL DEFAULT 0,
  isSynced          INTEGER NOT NULL DEFAULT 0,
  hasCover          INTEGER NOT NULL DEFAULT 0,
  syncIntent        TEXT,
  isFavorite        INTEGER NOT NULL DEFAULT 0,
  isFinished        INTEGER NOT NULL DEFAULT 0,
  currentPage       INTEGER NOT NULL DEFAULT 1,
  progress          REAL NOT NULL DEFAULT 0,
  readingMode       TEXT,
  lastOpenedAt      INTEGER,
  createdAt         INTEGER NOT NULL,
  updatedAt         INTEGER NOT NULL,
  clientUpdatedAt   INTEGER NOT NULL DEFAULT 0,
  syncState         TEXT NOT NULL DEFAULT 'pending',
  deletedAt         INTEGER
);

CREATE INDEX documents_updated  ON documents (deletedAt, updatedAt);
CREATE INDEX documents_opened   ON documents (deletedAt, lastOpenedAt);
CREATE INDEX documents_favorite ON documents (deletedAt, isFavorite, lastOpenedAt);
CREATE INDEX documents_finished ON documents (deletedAt, isFinished, lastOpenedAt);
CREATE INDEX documents_title    ON documents (deletedAt, title);
CREATE INDEX documents_finger   ON documents (fingerprint);

CREATE TABLE documentFiles (
  documentId    TEXT PRIMARY KEY NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  state         TEXT NOT NULL DEFAULT 'missing',
  expectedBytes INTEGER,
  localBytes    INTEGER,
  verifiedAt    INTEGER,
  coverState    TEXT NOT NULL DEFAULT 'missing',
  failure       TEXT,
  updatedAt     INTEGER NOT NULL
);

CREATE INDEX documentFiles_state ON documentFiles (state);

CREATE TABLE bookmarks (
  id              TEXT PRIMARY KEY NOT NULL,
  documentId      TEXT NOT NULL,
  page            INTEGER NOT NULL,
  label           TEXT,
  createdAt       INTEGER NOT NULL,
  updatedAt       INTEGER NOT NULL,
  clientUpdatedAt INTEGER NOT NULL DEFAULT 0,
  syncState       TEXT NOT NULL DEFAULT 'pending',
  deletedAt       INTEGER
);

CREATE UNIQUE INDEX bookmarks_page ON bookmarks (documentId, page);

CREATE TABLE annotations (
  id              TEXT PRIMARY KEY NOT NULL,
  remoteId        TEXT UNIQUE,
  documentId      TEXT NOT NULL,
  page            INTEGER NOT NULL,
  kind            TEXT NOT NULL,
  text            TEXT,
  note            TEXT,
  createdAt       INTEGER NOT NULL,
  updatedAt       INTEGER NOT NULL,
  clientUpdatedAt INTEGER NOT NULL DEFAULT 0,
  syncState       TEXT NOT NULL DEFAULT 'pending',
  deletedAt       INTEGER
);

CREATE INDEX annotations_document ON annotations (documentId, deletedAt, page);

CREATE TABLE collections (
  id              TEXT PRIMARY KEY NOT NULL,
  remoteId        TEXT UNIQUE,
  name            TEXT NOT NULL,
  createdAt       INTEGER NOT NULL,
  updatedAt       INTEGER NOT NULL,
  clientUpdatedAt INTEGER NOT NULL DEFAULT 0,
  syncState       TEXT NOT NULL DEFAULT 'pending',
  deletedAt       INTEGER
);

CREATE TABLE collectionDocuments (
  collectionId TEXT NOT NULL,
  documentId   TEXT NOT NULL,
  addedAt      INTEGER NOT NULL,
  syncState    TEXT NOT NULL DEFAULT 'pending',
  deletedAt    INTEGER,
  PRIMARY KEY (collectionId, documentId)
);

CREATE INDEX collectionDocuments_document ON collectionDocuments (documentId, deletedAt);

CREATE TABLE outlines (
  documentId TEXT PRIMARY KEY NOT NULL,
  entries    TEXT NOT NULL,
  updatedAt  INTEGER NOT NULL
);

CREATE TABLE syncQueue (
  opId          TEXT PRIMARY KEY NOT NULL,
  entity        TEXT NOT NULL,
  entityId      TEXT NOT NULL,
  op            TEXT NOT NULL,
  payload       TEXT NOT NULL,
  createdAt     INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  nextAttemptAt INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending',
  lastError     TEXT
);

CREATE INDEX syncQueue_ready ON syncQueue (status, nextAttemptAt, createdAt);

CREATE TABLE localJobs (
  id         TEXT PRIMARY KEY NOT NULL,
  kind       TEXT NOT NULL,
  documentId TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'queued',
  attempts   INTEGER NOT NULL DEFAULT 0,
  createdAt  INTEGER NOT NULL,
  updatedAt  INTEGER NOT NULL
);

CREATE INDEX localJobs_ready ON localJobs (state, createdAt);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;

const STEPS: { to: number; sql: string }[] = [{ to: 1, sql: V1 }];

/** Brings a freshly opened database up to `SCHEMA_VERSION`. */
export async function migrate(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const from = row?.user_version ?? 0;

  if (from >= SCHEMA_VERSION) {
    return;
  }

  for (const step of STEPS) {
    if (step.to <= from) {
      continue;
    }
    log.debug(SCOPE, `migrating to ${step.to}`);
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(step.sql);
      // `PRAGMA` takes no bound parameters, and `step.to` is a number from the
      // literal above rather than anything that came from outside.
      await txn.execAsync(`PRAGMA user_version = ${step.to}`);
    });
  }
}

/**
 * The search index, created outside the versioned steps and allowed to fail.
 *
 * FTS5 is compiled in on both platforms unless `expo.sqlite.enableFTS` is set
 * to `false` — `app.json` now sets it to `true` rather than relying on the
 * default — but the `CREATE VIRTUAL TABLE` is still the proof rather than the
 * assumption. A build without it loses local search and keeps everything else,
 * which is why this is not part of a migration that has to succeed.
 *
 * Returns whether the index is usable.
 */
export async function ensureTextIndex(db: SQLiteDatabase): Promise<boolean> {
  try {
    // The page number and document id ride along UNINDEXED, which stores them
    // without tokenising them — a page number is not something anyone searches
    // for.
    await db.execAsync(
      `CREATE VIRTUAL TABLE IF NOT EXISTS pages
       USING fts5(text, documentId UNINDEXED, page UNINDEXED, tokenize = 'unicode61');`,
    );
    return true;
  } catch (error) {
    log.error(SCOPE, 'no local text index on this build');
    log.debug(SCOPE, 'could not create the index', error);
    return false;
  }
}

/**
 * Carries the previous release's text across, once.
 *
 * Before this database existed, mirrored page text lived in its own unencrypted
 * `pidom-text-<profile>.db`. Re-mirroring instead would mean every upgraded
 * install losing offline search until it next had a connection *and* re-fetched
 * every page of every book — which is the reader's data allowance spent on text
 * that is already on the phone.
 *
 * `KEY ''` is what attaches a plaintext database to an encrypted one. On a
 * build without SQLCipher the clause is accepted and ignored, so the same
 * statement works either way.
 *
 * The old file is deleted once its rows are across, and that is the point
 * rather than tidiness: it holds the full text of somebody's documents in the
 * clear, and leaving it beside an encrypted copy of the same words would make
 * the encryption decorative.
 */
export async function importLegacyText(db: SQLiteDatabase, profileId: string): Promise<void> {
  const done = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'legacyTextImported'",
  );
  if (done !== null) {
    return;
  }

  const path = `${String(defaultDatabaseDirectory)}/pidom-text-${profileId}.db`;

  try {
    await db.runAsync("ATTACH DATABASE ? AS legacy KEY ''", path);
    try {
      await db.execAsync(
        `INSERT INTO pages (text, documentId, page)
         SELECT text, documentId, page FROM legacy.pages;`,
      );
      log.debug(SCOPE, 'carried the previous text index across');
    } finally {
      await db.execAsync('DETACH DATABASE legacy');
    }

    await deleteDatabaseAsync(`pidom-text-${profileId}.db`).catch(() => undefined);
  } catch (error) {
    // There was nothing to carry — the ordinary case on a fresh install — or
    // the old file is unreadable. Either way the mirror will refill it, so this
    // must not stop the database opening.
    log.debug(SCOPE, 'no previous text index to carry across', error);
  }

  await db.runAsync("INSERT OR REPLACE INTO meta (key, value) VALUES ('legacyTextImported', ?)", [
    String(Date.now()),
  ]);
}
