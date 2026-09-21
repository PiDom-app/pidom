import { app } from 'electron';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
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

/** Bumped when the DDL below changes. A newer app re-runs migrateUp from here. */
const SCHEMA_VERSION = 1;

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
  `);
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (db) return db;
  const file = join(app.getPath('userData'), 'pidom-cache.db');
  raw = new Database(file);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');

  const current = raw.pragma('user_version', { simple: true });
  const version = typeof current === 'number' ? current : 0;
  if (version < SCHEMA_VERSION) {
    migrateUp(raw);
    // pragma value cannot be parameterised; SCHEMA_VERSION is a trusted literal.
    raw.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  db = drizzle(raw, { schema });
  return db;
}

/** Trivial round-trip used to prove the native connection rebuilt and opened. */
export function userVersion(): number {
  if (!raw) getDb();
  const row = raw!.pragma('user_version', { simple: true });
  return typeof row === 'number' ? row : 0;
}
