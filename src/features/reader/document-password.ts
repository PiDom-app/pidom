import * as SecureStore from 'expo-secure-store';

import { log } from '@/lib/logger';

const SCOPE = 'reader-password';

/**
 * Where the password for an encrypted PDF is kept, when the reader asks.
 *
 * `SECURITY.md` reserved `expo-secure-store` for exactly this and nothing has
 * needed it until now. It is the right store and `AsyncStorage` is not: a
 * password is a credential, and the reader-preferences blob is world-readable
 * to anything that can read the app's data directory on a rooted device.
 *
 * The password never leaves the phone. It is not an argument to any Convex
 * function, it is not written to the document row, it is not logged — not even
 * its length, because a length is a fact about a secret. `react-native-pdf`
 * takes it as a prop and hands it to the platform renderer; that is the whole
 * of its travel.
 *
 * Keyed by document id, because the id is already the filename and is already
 * known to be a safe segment (`local/paths.ts` checks it). A key built from a
 * title would be a key built from a hostile string.
 *
 * Every function here swallows its failure. Keychain access can be refused —
 * a locked device, a restored backup, a simulator with no keychain — and the
 * answer to that is to ask for the password again, not to fail to open a book.
 */

const SAFE_ID = /^[a-z0-9]+$/i;

/**
 * `expo-secure-store` keys are alphanumerics, `.`, `-` and `_`. A Convex id is
 * already inside that set, and this is the assertion that says so rather than
 * the belief.
 */
function keyFor(documentId: string): string | null {
  return SAFE_ID.test(documentId) ? `pidom.pdf.${documentId}` : null;
}

export async function readPassword(documentId: string): Promise<string | null> {
  const key = keyFor(documentId);
  if (key === null) {
    return null;
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    log.debug(SCOPE, 'could not read a stored password', error);
    return null;
  }
}

export async function savePassword(documentId: string, password: string): Promise<void> {
  const key = keyFor(documentId);
  if (key === null) {
    return;
  }
  try {
    await SecureStore.setItemAsync(key, password, {
      // The document is only readable while the phone is unlocked anyway, and
      // this keeps the password off a backup restored onto a different device.
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (error) {
    log.debug(SCOPE, 'could not store a password', error);
  }
}

/**
 * Forgets one. Called when a stored password stops working, and when the
 * document it belongs to leaves the library.
 */
export async function forgetPassword(documentId: string): Promise<void> {
  const key = keyFor(documentId);
  if (key === null) {
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (error) {
    log.debug(SCOPE, 'could not forget a password', error);
  }
}
