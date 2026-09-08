/**
 * The device's database, and the one place it is opened.
 *
 * This is the half of the application that does not need a network. The library
 * a reader sees, where they are in every document, what they have marked and
 * written, and what is queued to go to the account are all rows in here — not a
 * snapshot of an answer the backend gave once, which is what they used to be.
 * Convex is upstream of this file, not in front of it.
 *
 * **One database per profile**, for the reason the library directory is per
 * profile: these are somebody's documents, and two accounts sharing one file is
 * the kind of bug that is only ever discovered by the wrong person. Signing in
 * as somebody else closes the previous handle rather than keeping two open.
 *
 * **Encrypted**, through SQLCipher. The rows include document titles, the words
 * a reader chose to keep, the notes they wrote about them, and the full text of
 * every synced document. That is a more revealing thing to leave on a disk than
 * the PDFs themselves, which at least require knowing what to look for. The key
 * is 256 bits from the platform's own generator, held in `expo-secure-store` —
 * the same place, and with the same accessibility, as a PDF's password.
 */
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import {
  addDatabaseChangeListener,
  defaultDatabaseDirectory,
  deleteDatabaseAsync,
  openDatabaseAsync,
  type SQLiteDatabase,
} from 'expo-sqlite';

import { log } from '@/lib/logger';

import { ensureTextIndex, importLegacyText, migrate } from './migrations';

const SCOPE = 'local-db';

/**
 * The profile id becomes a filename and a SecureStore key. Checked for the
 * same reason `paths.ts` checks it: "the id is safe" should be an assertion in
 * the code, not a belief about somebody else's id format.
 */
const SAFE_ID = /^[a-z0-9]+$/i;

/** A raw 256-bit SQLCipher key, hex. Nothing else is ever accepted as one. */
const RAW_KEY = /^[0-9a-f]{64}$/;

type Handle = { profileId: string; db: SQLiteDatabase };

/**
 * Why there is no database, when there is none.
 *
 * `null` means there is one. The rest are the three ways this can fail, and
 * they are kept apart because a reader can act on one of them and not on the
 * others — a locked keychain resolves itself on the next launch, a build with
 * no cipher never will.
 */
export type DatabaseFault = 'no-cipher' | 'no-keychain' | 'unreadable';

let handle: Handle | null = null;
/** The open in flight, so concurrent first callers share one rather than race. */
let opening: { profileId: string; promise: Promise<SQLiteDatabase | null> } | null = null;
let textIndexReady = false;
let encrypted = false;
let fault: DatabaseFault | null = null;

/**
 * The key for one profile, minting one on first use.
 *
 * Raw rather than a passphrase: `PRAGMA key = "x'…'"` uses the 32 bytes
 * directly, where a quoted string would be run through PBKDF2 first. There is
 * nothing for a key derivation to add to output that already came from
 * `getRandomBytes`, and the derivation is the slow part of opening.
 *
 * If the keychain refuses — a locked device, a restored backup — there is no
 * database this launch. That is the right failure: continuing without a key
 * would either create a second, empty, unencrypted library or silently drop the
 * encryption the reader was promised.
 */
async function keyFor(profileId: string): Promise<string | null> {
  const name = `pidom.db.${profileId}`;

  try {
    const existing = await SecureStore.getItemAsync(name, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    if (existing !== null && RAW_KEY.test(existing)) {
      return existing;
    }

    const key = [...Crypto.getRandomBytes(32)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

    await SecureStore.setItemAsync(name, key, {
      // The library is only readable while the phone is unlocked anyway, and
      // this keeps the key off a backup restored onto a different device.
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return key;
  } catch (error) {
    log.error(SCOPE, 'could not reach the keychain for the database key');
    log.debug(SCOPE, 'keychain failed', error);
    return null;
  }
}

/** The file, as SQLite will address it in an `ATTACH`. */
function fileNameOf(profileId: string): string {
  return `pidom-${profileId}.db`;
}

/**
 * Where `adoptPlaintext` builds the encrypted copy before it swaps it in.
 *
 * Named here rather than inside that function because `resumeInterrupted`
 * needs it too: if the process died between the delete and the move, this file
 * is the entire library and the one next to it is a stub.
 */
function workingNameOf(profileId: string): string {
  return `pidom-${profileId}.encrypting.db`;
}

function pathOf(name: string): string {
  return `${String(defaultDatabaseDirectory)}/${name}`;
}

/**
 * The same file, as `expo-file-system` addresses it.
 *
 * `defaultDatabaseDirectory` is a bare filesystem path —
 * `context.filesDir.canonicalPath + "/SQLite"` on Android, with no scheme — and
 * that is what `ATTACH` wants. The `File` API wants a URI, and handing it the
 * bare path is why the sidecar cleanup here quietly did nothing and why the
 * original migration's file move failed hard enough to strand a library. One
 * conversion, in one place, rather than a scheme spliced in at each call site.
 */
function uriOf(name: string): string {
  return `file://${pathOf(name)}`;
}

/**
 * Whether this build has SQLCipher at all.
 *
 * `cipher_version` is a property of the library rather than of the file, so it
 * answers before anything has been keyed or read, which is what makes it usable
 * as a gate. Plain SQLite returns no row for it and — this is the dangerous
 * part — also *accepts* `PRAGMA key` without complaint, then writes an ordinary
 * unencrypted file that looks exactly like a working one from the outside.
 */
async function hasCipher(db: SQLiteDatabase): Promise<boolean> {
  const row = await db
    .getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version')
    .catch(() => null);
  return row !== null && typeof row.cipher_version === 'string' && row.cipher_version !== '';
}

/**
 * Whether the key just set actually opens the file.
 *
 * **`SELECT count(*) FROM sqlite_master`, which is SQLCipher's own answer to
 * this question, and not `PRAGMA user_version`, which was the bug.** SQLCipher
 * derives the key just in time: `PRAGMA key` never reports a wrong one, and
 * the failure only surfaces when something actually reads a page. `PRAGMA
 * user_version` did not read one — Zetetic's own documentation lists it under
 * migrations, where it *rewrites* the header rather than parsing it — so a key
 * that could not open the file passed this check, both recovery paths below
 * were skipped, and the first real statement threw `SQLITE_NOTADB` inside
 * `migrate`. The symptom was a log reading `migrating to 1` followed by `file
 * is not a database`, on every launch, with nothing able to repair it.
 *
 * Reading `sqlite_master` forces page one to be decrypted and its schema
 * parsed, which is precisely the operation that fails on a wrong key. It also
 * succeeds on a brand-new empty file, which is what makes it usable both after
 * `deleteDatabaseAsync` and against a file that has been there for months.
 */
async function opensWithKey(db: SQLiteDatabase): Promise<boolean> {
  try {
    await db.getFirstAsync('SELECT count(*) FROM sqlite_master');
    return true;
  } catch {
    return false;
  }
}

/**
 * Sets the key and proves it opens the file, in one answer.
 *
 * **Setting the key can itself throw**, and that is the half the first fix
 * missed. `PRAGMA key` is documented as not *reporting* a wrong key, which is
 * not the same as never failing: against a file that is not a database at all —
 * truncated, zero bytes, or the tail of an interrupted write — expo-sqlite
 * rejects the `execAsync` outright with `file is not a database`. That throw
 * escaped past both recovery paths below and out to the caller, so the one code
 * that could have repaired the file never ran and every launch failed the same
 * way, for ever.
 *
 * Both failures mean the same thing to the caller — this connection cannot read
 * this file — so both are `false` and the recovery path decides what to do
 * about it.
 */
async function keyed(db: SQLiteDatabase, key: string): Promise<boolean> {
  try {
    // `RAW_KEY` has already proved the interpolation is 64 hex characters and
    // nothing else.
    await db.execAsync(`PRAGMA key = "x'${key}'"`);
  } catch {
    return false;
  }
  return await opensWithKey(db);
}

/**
 * Makes `target` a copy of `source`, both keyed, without moving a file.
 *
 * **The file move is what broke on a real device**, and it broke silently. The
 * previous version deleted the original and then called
 * `new File(workingPath).move(...)` from `expo-file-system`, which needs the
 * paths it is handed to be ones it recognises — `defaultDatabaseDirectory` is
 * an opaque value from another module, not a URI this one mints. When that
 * threw, the `catch` reported "could not encrypt the library", the caller
 * treated it as an unrecoverable file and started over, and the outcome was the
 * state found on the device: a 4 KB stub where the database should be and the
 * entire 2 MB library orphaned in the working file beside it, unreadable
 * forever because nothing ever looked at it again.
 *
 * So the swap is SQL now. `sqlcipher_export` copies a whole database into an
 * attached one, `deleteDatabaseAsync` is expo-sqlite's own API for its own
 * files, and neither needs a path this module had to guess at. The only
 * filesystem path left is the one `ATTACH` takes, which is the one that was
 * always working.
 */
async function installFrom(sourceName: string, targetName: string, key: string): Promise<boolean> {
  let source: SQLiteDatabase | null = null;
  try {
    source = await openDatabaseAsync(sourceName);
    if (!(await keyed(source, key))) {
      return false;
    }

    // The target is recreated rather than written over: `sqlcipher_export`
    // copies a schema in, and copying one into a database that already has it
    // is an error rather than a merge.
    await discard(targetName);

    await source.execAsync(`ATTACH DATABASE '${pathOf(targetName)}' AS installed KEY "x'${key}'"`);
    try {
      await source.execAsync(`SELECT sqlcipher_export('installed')`);
      const version = await source.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      await source.execAsync(
        `PRAGMA installed.user_version = ${Number(version?.user_version ?? 0)}`,
      );
    } finally {
      await source.execAsync('DETACH DATABASE installed').catch(() => undefined);
    }

    await source.closeAsync();
    source = null;
    await discard(sourceName);
    return true;
  } catch (error) {
    log.error(SCOPE, 'could not install the encrypted copy of the library');
    log.debug(SCOPE, 'installFrom failed', error);
    return false;
  } finally {
    await source?.closeAsync().catch(() => undefined);
  }
}

/**
 * Encrypts a database an earlier build left in the clear.
 *
 * This is not hypothetical and not a one-device problem: `useSQLCipher` was in
 * `app.json` but never reached a build, because the config plugin only runs
 * during `prebuild` and this project commits its native directories. So every
 * install has a plaintext `pidom-<profile>.db` holding document titles, notes
 * and the full text of every synced document, and the fix that turns the cipher
 * on would otherwise make all of it unreadable at the next launch.
 *
 * `sqlcipher_export` is SQLCipher's own answer to exactly this: attach an empty
 * keyed database, copy the schema and every row into it, and swap the files.
 * The original is deleted only once the copy is in place, so a process killed
 * mid-migration leaves the old file intact and tries again next launch.
 *
 * Returns false when the file is not a plaintext database either — a genuinely
 * corrupt one, or an encrypted one whose key has been lost. There is nothing to
 * recover in that case and the caller starts over.
 */
async function adoptPlaintext(profileId: string, key: string): Promise<boolean> {
  const name = fileNameOf(profileId);
  const workingName = workingNameOf(profileId);
  const workingPath = pathOf(workingName);

  // Anything left by an interrupted attempt. Its contents are a partial copy of
  // a database that still exists, so there is nothing in it worth keeping —
  // `resumeInterrupted` has already had its chance at it.
  await discard(workingName);

  let plain: SQLiteDatabase | null = null;
  try {
    // Opened with no key: if `sqlite_master` reads, the file really is
    // plaintext rather than encrypted with a key nobody has — or not a
    // database at all, which reads the same way here and is handled the same
    // way by the caller.
    plain = await openDatabaseAsync(name);
    if (!(await opensWithKey(plain))) {
      return false;
    }

    log.warn(SCOPE, 'found an unencrypted library from an earlier build; encrypting it');

    await plain.execAsync(`ATTACH DATABASE '${workingPath}' AS encrypted KEY "x'${key}'"`);
    try {
      await plain.execAsync(`SELECT sqlcipher_export('encrypted')`);
      // The version rides across by hand: `sqlcipher_export` copies the schema
      // and the rows and not `user_version`, so without this the migration
      // runner would replay every step over a database that already has them.
      const version = await plain.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      await plain.execAsync(`PRAGMA encrypted.user_version = ${Number(version?.user_version ?? 0)}`);
    } finally {
      await plain.execAsync('DETACH DATABASE encrypted').catch(() => undefined);
    }

    await plain.closeAsync();
    plain = null;

    // The copy is complete, so the original can go and the copy can take its
    // place. `installFrom` does that with SQL rather than by moving a file —
    // see the note there for why the move is what broke.
    return await installFrom(workingName, name, key);
  } catch (error) {
    log.error(SCOPE, 'could not encrypt the library left by an earlier build');
    log.debug(SCOPE, 'adoptPlaintext failed', error);
    return false;
  } finally {
    await plain?.closeAsync().catch(() => undefined);
  }
}

/**
 * Removes a database and the two files SQLite keeps beside it.
 *
 * `deleteDatabaseAsync` takes the database file. WAL mode leaves `-wal` and
 * `-shm` next to it, and those hold pages written under the *old* key — so
 * starting over without them means a fresh, correctly keyed file with somebody
 * else's ciphertext replayed into it on first open, which is the same
 * `SQLITE_NOTADB` again with no way out of the loop.
 *
 * Best effort per file: on a clean shutdown neither exists, and a missing one
 * is the expected case rather than a failure.
 */
async function discard(name: string): Promise<void> {
  // `deleteDatabaseAsync` first, because it is the module's own API for its own
  // files and it keeps that module's bookkeeping straight.
  //
  // **But it refuses while the database is in expo-sqlite's open cache**, and
  // that refusal is not theoretical: on the device this was debugged against it
  // threw on every recovery attempt, so the corrupt file was never actually
  // removed and the "starting over" branch reopened exactly what it had just
  // decided to throw away. Unlinking the file directly is cache-independent and
  // is safe here — the handle is closed before this is called, and an unlink
  // under a still-open descriptor is something the filesystem handles rather
  // than something that corrupts anything.
  //
  // The journals go either way. `deleteDatabaseAsync` takes only the database
  // file, and `-wal` holds pages written under the old key: a fresh, correctly
  // keyed file with a foreign journal beside it fails exactly as the old one
  // did, which is the loop this whole path exists to break.
  let removed = false;
  try {
    await deleteDatabaseAsync(name);
    removed = true;
  } catch {
    removed = false;
  }

  for (const suffix of ['', '-wal', '-shm']) {
    if (suffix === '' && removed) {
      continue;
    }
    try {
      const file = new File(uriOf(`${name}${suffix}`));
      if (file.exists) {
        file.delete();
      }
    } catch (error) {
      // Only the database file itself is worth reporting: without it the
      // recovery cannot work, and a missing journal is the expected case.
      if (suffix === '') {
        log.error(SCOPE, 'could not remove a database file that is being replaced');
        log.debug(SCOPE, 'delete failed', error);
      }
    }
  }
}

/**
 * Finishes an encryption that was interrupted before the copy was installed.
 *
 * `adoptPlaintext` builds the encrypted copy beside the original and then makes
 * it the original. Its own comment claimed a process killed mid-migration
 * "leaves the old file intact and tries again next launch", and that is only
 * true of a kill *before* the swap. On a real device the swap failed instead —
 * see `installFrom` — leaving a 4 KB stub where the database should be and the
 * whole library in the working file next to it, which every later launch then
 * ignored while reporting that the library could not be opened.
 *
 * The test for "is there something worth recovering" is deliberately not
 * `File.exists`: reaching for the filesystem by path is what caused this in the
 * first place. Opening the working name creates an empty file if there is none,
 * which is why an empty one is not enough — **a copy counts only if it has a
 * schema**, and `count(*) FROM sqlite_master` is the same read that proves the
 * key fits. A file that fails either test is a partial export of a database
 * that no longer exists, worth nothing, and it is cleared.
 */
async function resumeInterrupted(profileId: string, key: string): Promise<boolean> {
  const workingName = workingNameOf(profileId);

  let working: SQLiteDatabase | null = null;
  let recoverable = false;
  try {
    working = await openDatabaseAsync(workingName);
    if (await keyed(working, key)) {
      const row = await working.getFirstAsync<{ tables: number }>(
        'SELECT count(*) AS tables FROM sqlite_master',
      );
      recoverable = Number(row?.tables ?? 0) > 0;
    }
  } catch {
    recoverable = false;
  } finally {
    await working?.closeAsync().catch(() => undefined);
  }

  if (!recoverable) {
    await discard(workingName);
    return false;
  }

  log.warn(SCOPE, 'finishing an encryption that was interrupted; the library is in the copy');
  return await installFrom(workingName, fileNameOf(profileId), key);
}

async function prepare(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  await migrate(db);
}

async function openFor(profileId: string): Promise<SQLiteDatabase | null> {
  const key = await keyFor(profileId);
  if (key === null) {
    fault = 'no-keychain';
    return null;
  }

  // Before the database is opened at all, because if this fires the file that
  // is about to be opened is the wrong one.
  await resumeInterrupted(profileId, key);

  // `enableChangeListener` is what makes the database reactive: every write
  // raises an event naming the table it touched, and `use-local-query.ts` turns
  // that into a re-render. Without it every screen would have to be told by
  // hand which of a dozen callers had just changed something.
  let db = await openDatabaseAsync(fileNameOf(profileId), { enableChangeListener: true });

  // **The gate, and it is checked before anything is written.** A build without
  // SQLCipher used to log a line and carry on, which meant the one guarantee
  // this file's own header makes — that a reader's titles, notes and document
  // text are encrypted at rest — was quietly false on every install. It refuses
  // now. Losing the offline library to a misconfigured build is a bad day;
  // writing somebody's documents to disk in the clear while telling them
  // otherwise is a different kind of thing, and not one to trade away for
  // convenience.
  encrypted = await hasCipher(db);
  if (!encrypted) {
    await db.closeAsync().catch(() => undefined);
    fault = 'no-cipher';
    log.error(
      SCOPE,
      'this build has no SQLCipher, so the local library would be stored unencrypted; refusing to open it. Rebuild with expo.sqlite.useSQLCipher=true.',
    );
    return null;
  }

  // `PRAGMA key` must be the first statement that touches the file.
  if (!(await keyed(db, key))) {
    // Either a plaintext database from the build this fix replaces, or a file
    // this key can no longer open. The first is recoverable and common; the
    // second leaves nothing to recover, and the library is rebuilt from the
    // account on the next sync.
    await db.closeAsync().catch(() => undefined);

    if (await adoptPlaintext(profileId, key)) {
      db = await openDatabaseAsync(fileNameOf(profileId), { enableChangeListener: true });
      if (!(await keyed(db, key))) {
        await db.closeAsync().catch(() => undefined);
        fault = 'unreadable';
        log.error(SCOPE, 'the local library did not open after being encrypted');
        return null;
      }
    } else {
      log.error(SCOPE, 'the local library cannot be opened with this device s key; starting over');
      await discard(fileNameOf(profileId));
      db = await openDatabaseAsync(fileNameOf(profileId), { enableChangeListener: true });
      if (!(await keyed(db, key))) {
        await db.closeAsync().catch(() => undefined);
        fault = 'unreadable';
        log.error(SCOPE, 'a fresh local library could not be created on this device');
        return null;
      }
    }
  }

  // **Everything past the key check is inside this, and that is the point.**
  // A key that fits proves the header decrypts; it does not prove the rest of
  // the file is coherent. On the device this was debugged against, the header
  // was a 4 KB stub and a 2.3 MB `-wal` beside it held pages from a different
  // database — so the key check passed and `PRAGMA journal_mode = WAL` then
  // replayed a foreign journal and threw `file is not a database` from inside
  // `migrate`. That throw went straight past both recovery paths above and out
  // to the caller, which is why the failure repeated on every launch for ever
  // instead of being repaired once.
  //
  // Now it converges: prepare, and if preparing fails, throw the whole thing
  // away — file and journals — and prepare a new one. The library is rebuilt
  // from the account on the next sync, which is a bad afternoon rather than a
  // permanently broken install.
  try {
    await prepare(db);
  } catch (error) {
    log.error(SCOPE, 'the local library could not be prepared; starting over', error);

    await db.closeAsync().catch(() => undefined);
    await discard(fileNameOf(profileId));

    db = await openDatabaseAsync(fileNameOf(profileId), { enableChangeListener: true });
    if (!(await keyed(db, key))) {
      await db.closeAsync().catch(() => undefined);
      fault = 'unreadable';
      log.error(SCOPE, 'a fresh local library could not be created on this device');
      return null;
    }
    await prepare(db);
  }

  textIndexReady = await ensureTextIndex(db);
  if (textIndexReady) {
    await importLegacyText(db, profileId);
  }

  fault = null;
  return db;
}

/**
 * The database for one profile.
 *
 * Returns `null` rather than throwing when the device cannot host one, because
 * every caller is a screen that has to render something either way. The
 * failure is logged once, here, rather than at each of them.
 */
export async function database(profileId: string): Promise<SQLiteDatabase | null> {
  if (!SAFE_ID.test(profileId)) {
    return null;
  }
  if (handle !== null && handle.profileId === profileId) {
    return handle.db;
  }
  if (opening !== null && opening.profileId === profileId) {
    return await opening.promise;
  }

  const promise = (async (): Promise<SQLiteDatabase | null> => {
    if (handle !== null) {
      await handle.db.closeAsync().catch(() => undefined);
      handle = null;
    }

    try {
      const db = await openFor(profileId);
      if (db === null) {
        return null;
      }
      handle = { profileId, db };
      return db;
    } catch (error) {
      // Anything that throws past the key check — a migration against a file
      // that turned out to be unreadable after all, a disk with no room — is
      // the same fact to the reader: there is no local library this launch.
      // Recording it is what puts the error screen in front of them instead of
      // an empty one. See `use-library-status.ts`.
      fault = fault ?? 'unreadable';
      log.error(SCOPE, 'could not open the local library');
      log.debug(SCOPE, 'open failed', error);
      return null;
    }
  })();

  opening = { profileId, promise };
  try {
    return await promise;
  } finally {
    if (opening !== null && opening.promise === promise) {
      opening = null;
    }
  }
}

/** Closes the handle. Called on sign-out, so nothing of one reader stays open. */
export async function closeDatabase(): Promise<void> {
  opening = null;
  if (handle === null) {
    return;
  }
  const closing = handle.db;
  handle = null;
  await closing.closeAsync().catch(() => undefined);
}

/** Whether local search can answer at all on this build. */
export function localSearchAvailable(): boolean {
  return textIndexReady;
}

/**
 * Whether the file on disk is actually encrypted.
 *
 * True whenever there is a database at all, now that an unencrypted one is
 * refused rather than filled. Kept because it says what it means at a call
 * site, and because "we checked" is worth being able to state.
 */
export function databaseEncrypted(): boolean {
  return encrypted;
}

/**
 * Why there is no local library, when there is none. `null` when there is one.
 *
 * Read by the screens, because the alternative to saying this is a library that
 * renders as empty with no explanation — which is what "no documents" would
 * claim, and it would be a lie about somebody's account.
 */
export function databaseFault(): DatabaseFault | null {
  return fault;
}

/**
 * Watch for writes, by table.
 *
 * `addDatabaseChangeListener` fires per changed row and names the table, so a
 * screen reading `documents` is not re-run by a write to `syncQueue`. The
 * subscription is shared: one native listener however many hooks are mounted.
 */
export function watchTables(tables: readonly string[], listener: () => void): () => void {
  const wanted = new Set(tables);
  const subscription = addDatabaseChangeListener((event) => {
    if (wanted.has(event.tableName)) {
      listener();
    }
  });
  return () => {
    subscription.remove();
  };
}
