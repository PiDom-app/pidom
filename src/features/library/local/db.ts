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
import * as SecureStore from 'expo-secure-store';
import { addDatabaseChangeListener, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

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

let handle: Handle | null = null;
/** The open in flight, so concurrent first callers share one rather than race. */
let opening: { profileId: string; promise: Promise<SQLiteDatabase | null> } | null = null;
let textIndexReady = false;
let encrypted = false;

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

async function openFor(profileId: string): Promise<SQLiteDatabase | null> {
  const key = await keyFor(profileId);
  if (key === null) {
    return null;
  }

  // `enableChangeListener` is what makes the database reactive: every write
  // raises an event naming the table it touched, and `use-local-query.ts` turns
  // that into a re-render. Without it every screen would have to be told by
  // hand which of a dozen callers had just changed something.
  const db = await openDatabaseAsync(`pidom-${profileId}.db`, { enableChangeListener: true });

  // `PRAGMA key` must be the first statement on the connection — anything
  // before it reads the file as plaintext and fails. `RAW_KEY` has already
  // proved the interpolation is 64 hex characters and nothing else.
  await db.execAsync(`PRAGMA key = "x'${key}'"`);

  // SQLCipher answers this; plain SQLite returns no row. Worth knowing rather
  // than assuming, because a build without it accepts `PRAGMA key` silently and
  // writes an unencrypted file that looks exactly like a working one.
  const cipher = await db
    .getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version')
    .catch(() => null);
  encrypted = cipher !== null;
  if (!encrypted) {
    log.error(SCOPE, 'this build has no SQLCipher; the local library is not encrypted');
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

/** Whether the file on disk is actually encrypted. False means a bad build. */
export function databaseEncrypted(): boolean {
  return encrypted;
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
