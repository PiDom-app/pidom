import { app } from 'electron';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from './schema';

/**
 * The local cache database. Opened once in the main process — better-sqlite3 is
 * a native, synchronous, Node-only module and MUST NOT be imported into the
 * sandboxed renderer. The renderer reaches it only through IPC.
 *
 * The schema is applied here with idempotent DDL gated on `user_version`, rather
 * than by shipping drizzle-kit's SQL files and resolving them at runtime: a
 * packaged asar makes that path fragile, and this database is a rebuildable
 * cache (Convex owns the data, the PDFs re-download), so a plain versioned init
 * is both simpler and safe. The drizzle schema in ./schema.ts stays the typed
 * source of truth for every query. `drizzle-kit generate` still records the SQL
 * under ./drizzle for review; nothing reads it at runtime.
 */
let db: BetterSQLite3Database<typeof schema> | null = null;
let raw: Database.Database | null = null;

/** Bumped when the DDL below changes. A newer app re-runs migrateUp from here.
 *  v2 added `local_settings`; a Phase-1 database stamped at v1 must re-run
 *  migrateUp (IF NOT EXISTS no-ops the existing tables) or that table is missing
 *  and every `local_settings` read throws. */
const SCHEMA_VERSION = 2;

/**
 * A synchronous diagnostic line, straight to stderr.
 *
 * Not `console.log`: main's stdout is block-buffered under a pipe (electron-forge
 * captures it), so if the synchronous open ever blocks the event loop the last
 * buffered lines never flush and the trace lies about where it stopped. stderr is
 * unbuffered on a pipe, so each step is committed before the next call can hang.
 */
function dbg(message: string): void {
  try {
    process.stderr.write(`[db] ${message}\n`);
  } catch {
    /* a closed stderr is not worth crashing a database open over */
  }
}

/**
 * Creates every table and index if absent. Each statement is `IF NOT EXISTS`, so
 * running it against a database already at the current version is a no-op — the
 * `user_version` gate below skips it anyway, this is the belt to that braces.
 */
function migrateUp(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS documents_cache (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      page_count INTEGER,
      byte_size INTEGER,
      current_page INTEGER NOT NULL DEFAULT 1,
      progress REAL NOT NULL DEFAULT 0,
      is_finished INTEGER NOT NULL DEFAULT 0,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_synced INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS local_files (
      document_id TEXT PRIMARY KEY NOT NULL,
      path TEXT,
      hash TEXT,
      bytes INTEGER,
      version TEXT,
      state TEXT NOT NULL DEFAULT 'queued',
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS local_files_by_state ON local_files (state);

    CREATE TABLE IF NOT EXISTS download_jobs (
      document_id TEXT PRIMARY KEY NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued',
      received_bytes INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS download_jobs_by_state ON download_jobs (state);

    CREATE TABLE IF NOT EXISTS local_settings (
      id TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);
}

/**
 * Opens the connection, applies pragmas, and brings the schema to the current
 * version. Throws on any failure so the caller can recover. `timeout` bounds
 * lock waits (a lingering process holding the file throws SQLITE_BUSY rather
 * than hanging the main event loop). The journal mode is set *after* the timeout.
 *
 * `useWal` lets the recovery path fall back to the rollback journal. WAL keeps a
 * memory-mapped `-shm` file whose POSIX locking can hang on a few network/overlay
 * home-directory filesystems, and for a rebuildable cache a slower DELETE-journal
 * database that opens beats a WAL open that wedges the synchronous main thread.
 */
function open(file: string, useWal: boolean): Database.Database {
  dbg(`opening (${useWal ? 'wal' : 'delete'}) ${file}`);
  const connection = new Database(file, { timeout: 5000 });
  dbg('connection created');
  // Set the busy timeout before anything that can contend for a lock, so a
  // lingering holder bounces off SQLITE_BUSY at 5s instead of blocking forever.
  connection.pragma('busy_timeout = 5000');
  connection.pragma(`journal_mode = ${useWal ? 'WAL' : 'DELETE'}`);
  connection.pragma('foreign_keys = ON');
  dbg('pragmas set');

  const current = connection.pragma('user_version', { simple: true });
  const version = typeof current === 'number' ? current : 0;
  if (version < SCHEMA_VERSION) {
    dbg(`migrating ${version} -> ${SCHEMA_VERSION}`);
    migrateUp(connection);
    // pragma value cannot be parameterised; SCHEMA_VERSION is a trusted literal.
    connection.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
  dbg('open ok');
  return connection;
}

/** Deletes the cache database and its WAL/SHM sidecars. Safe: Convex owns the
 *  data and the PDFs re-download, so a corrupt or locked cache is rebuilt, not
 *  repaired. Deleting the inode also frees the file from a lingering process's
 *  lock — the next `open` creates a fresh, unlocked file. */
function wipe(file: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      rmSync(file + suffix, { force: true });
    } catch {
      /* best effort — a missing sidecar is the desired end state */
    }
  }
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (db) return db;
  const file = join(app.getPath('userData'), 'pidom-cache.db');

  // A recovery ladder, each rung more conservative than the last, because the
  // main thread cannot survive a wedged open: (1) WAL, the normal path; (2) wipe
  // the possibly-corrupt/locked file and retry WAL; (3) wipe and open without WAL,
  // in case the `-shm` mmap locking is what hangs on this filesystem. The cache is
  // regenerable, so wiping costs nothing but the re-download it already assumes.
  try {
    raw = open(file, true);
  } catch (firstError) {
    dbg(`open failed, rebuilding: ${String(firstError)}`);
    closeQuietly();
    wipe(file);
    try {
      raw = open(file, true);
    } catch (secondError) {
      dbg(`wal open failed, falling back to delete journal: ${String(secondError)}`);
      closeQuietly();
      wipe(file);
      raw = open(file, false);
    }
  }

  db = drizzle(raw, { schema });
  dbg('ready');
  return db;
}

/** Closes the raw handle without throwing, so a failed open can be retried. */
function closeQuietly(): void {
  try {
    raw?.close();
  } catch {
    /* ignore — a half-open handle is being discarded anyway */
  }
  raw = null;
}

/** Trivial round-trip used to prove the native connection rebuilt and opened. */
export function userVersion(): number {
  if (!raw) getDb();
  const row = raw!.pragma('user_version', { simple: true });
  return typeof row === 'number' ? row : 0;
}
