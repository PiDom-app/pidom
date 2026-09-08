import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * A write transaction on the connection that holds the key.
 *
 * **This exists because `withExclusiveTransactionAsync` cannot be used against
 * an encrypted database, and fails in a way that looks like corruption.**
 * Expo's own implementation is three lines:
 *
 * ```js
 * const options = { ...db.options, useNewConnection: true };
 * const nativeDatabase = new ExpoSQLite.NativeDatabase(db.databasePath, ...);
 * ```
 *
 * A *second native connection* to the same file — and `PRAGMA key` is a
 * property of a connection, not of a file. The new one has never been given
 * one, so its first read of page one fails, and SQLCipher's way of saying "I
 * cannot decrypt this" is `file is not a database`.
 *
 * That error was reported from inside `migrate`, on a freshly created
 * database, for every account on every launch. It looked exactly like a corrupt
 * file, which is what sent the first four attempts at this chasing recovery
 * paths for a file that was never damaged.
 *
 * So: `BEGIN IMMEDIATE` on the connection we already hold. `IMMEDIATE` takes
 * the write lock at the start rather than on the first write, which is the
 * ordering guarantee the exclusive variant was being used for — without a
 * second connection to guarantee it with.
 *
 * The task is handed the same `db` it was called with. Every call site already
 * wrote `txn.runAsync(...)`, and it stays correct: there is one connection, and
 * now both names point at it.
 */
export async function inTransaction(
  db: SQLiteDatabase,
  task: (txn: SQLiteDatabase) => Promise<void>,
): Promise<void> {
  await db.execAsync('BEGIN IMMEDIATE');
  try {
    await task(db);
    await db.execAsync('COMMIT');
  } catch (error) {
    // Best effort: if the transaction is already gone the rollback is a no-op
    // and the original failure is the one worth reporting.
    await db.execAsync('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
