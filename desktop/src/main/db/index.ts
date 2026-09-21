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
 * One database per app profile directory, following the mobile app's rule that
 * a different account never reaches the previous reader's data. (Per-account
 * separation and SQLCipher-equivalent encryption are follow-ups; the current
 * scaffold establishes the connection and migration pipeline.)
 */
let db: BetterSQLite3Database<typeof schema> | null = null;
let raw: Database.Database | null = null;

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (db) return db;
  const file = join(app.getPath('userData'), 'pidom-cache.db');
  raw = new Database(file);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  db = drizzle(raw, { schema });
  return db;
}

/** Trivial round-trip used to prove the native connection rebuilt and opened. */
export function userVersion(): number {
  if (!raw) getDb();
  const row = raw!.pragma('user_version', { simple: true });
  return typeof row === 'number' ? row : 0;
}
