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
/**
 * One transaction at a time, per connection.
 *
 * `withExclusiveTransactionAsync` got its exclusivity from having a connection
 * to itself. Running on the shared one instead means two callers can reach
 * `BEGIN` at the same moment — and SQLite has no nested transactions, so the
 * second one fails with `cannot start a transaction within a transaction`.
 *
 * That is not hypothetical: the sync engine's reconcile and the live sharing
 * subscription both replace the event feed, and they are triggered by different
 * things. Whichever arrived second lost its write.
 *
 * So top-level transactions queue behind each other. The chain swallows
 * failures before passing the baton — one caller's rollback is not the next
 * caller's problem — while the original error still reaches the caller that
 * caused it.
 */
const queues = new WeakMap<SQLiteDatabase, Promise<unknown>>();

/**
 * Whether a transaction is already open on this connection.
 *
 * A task that calls `inTransaction` again joins the one it is already inside
 * rather than opening a second. Without this a nested call would wait on a
 * queue that cannot advance until it returns, which is a deadlock — a worse
 * failure than the error it replaced, and silent.
 */
const open = new WeakSet<SQLiteDatabase>();

export async function inTransaction(
  db: SQLiteDatabase,
  task: (txn: SQLiteDatabase) => Promise<void>,
): Promise<void> {
  if (open.has(db)) {
    await task(db);
    return;
  }

  const previous = queues.get(db) ?? Promise.resolve();
  const run = previous.then(async () => {
    await db.execAsync('BEGIN IMMEDIATE');
    open.add(db);
    try {
      await task(db);
      await db.execAsync('COMMIT');
    } catch (error) {
      // Best effort: if the transaction is already gone the rollback is a
      // no-op and the original failure is the one worth reporting.
      await db.execAsync('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      open.delete(db);
    }
  });

  // The queue holds a settled-either-way promise so one failure does not stop
  // every later transaction on this connection.
  queues.set(db, run.catch(() => undefined));
  await run;
}
