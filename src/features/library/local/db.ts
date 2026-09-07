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
import { Directory, File } from 'expo-file-system';
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

function pathOf(name: string): string {
  return `${String(defaultDatabaseDirectory)}/${name}`;
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
 * The cheapest read that touches the database header. On a keyed connection
 * against a file the key does not fit — a plaintext database from a build with
 * no cipher, or a key that has been rotated out from under it — SQLite answers
 * `SQLITE_NOTADB` here rather than at some later query nobody is watching.
 */
async function opensWithKey(db: SQLiteDatabase): Promise<boolean> {
  try {
    await db.getFirstAsync('PRAGMA user_version');
    return true;
  } catch {
    return false;
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
  const workingName = `pidom-${profileId}.encrypting.db`;
  const workingPath = pathOf(workingName);

  // Anything left by an interrupted attempt. Its contents are a partial copy of
  // a database that still exists, so there is nothing in it worth keeping.
  await deleteDatabaseAsync(workingName).catch(() => undefined);

  let plain: SQLiteDatabase | null = null;
  try {
    // Opened with no key: if this reads, the file really is plaintext.
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

    // Delete before the move, and only now: up to this point the plaintext file
    // is still the only complete copy.
    await deleteDatabaseAsync(name);
    new File(workingPath).move(new File(new Directory(String(defaultDatabaseDirectory)), name));
    return true;
  } catch (error) {
    log.error(SCOPE, 'could not encrypt the library left by an earlier build');
    log.debug(SCOPE, 'adoptPlaintext failed', error);
    return false;
  } finally {
    await plain?.closeAsync().catch(() => undefined);
  }
}

async function openFor(profileId: string): Promise<SQLiteDatabase | null> {
  const key = await keyFor(profileId);
  if (key === null) {
    fault = 'no-keychain';
    return null;
  }

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

  // `PRAGMA key` must be the first statement that touches the file. `RAW_KEY`
  // has already proved the interpolation is 64 hex characters and nothing else.
  await db.execAsync(`PRAGMA key = "x'${key}'"`);

  if (!(await opensWithKey(db))) {
    // Either a plaintext database from the build this fix replaces, or a file
    // this key can no longer open. The first is recoverable and common; the
    // second leaves nothing to recover, and the library is rebuilt from the
    // account on the next sync.
    await db.closeAsync().catch(() => undefined);

    if (await adoptPlaintext(profileId, key)) {
      db = await openDatabaseAsync(fileNameOf(profileId), { enableChangeListener: true });
      await db.execAsync(`PRAGMA key = "x'${key}'"`);
      if (!(await opensWithKey(db))) {
        await db.closeAsync().catch(() => undefined);
        fault = 'unreadable';
        log.error(SCOPE, 'the local library did not open after being encrypted');
        return null;
      }
    } else {
      log.error(SCOPE, 'the local library cannot be opened with this device s key; starting over');
      await deleteDatabaseAsync(fileNameOf(profileId)).catch(() => undefined);
      db = await openDatabaseAsync(fileNameOf(profileId), { enableChangeListener: true });
      await db.execAsync(`PRAGMA key = "x'${key}'"`);
      if (!(await opensWithKey(db))) {
        await db.closeAsync().catch(() => undefined);
        fault = 'unreadable';
        return null;
      }
    }
  }

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);

  await migrate(db);

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
