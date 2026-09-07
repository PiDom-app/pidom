/**
 * Ids this device mints for itself.
 *
 * Until the local database existed, every id came from Convex — which is why
 * importing a document with no connection was impossible: `importDocument`
 * minted the id, and the id was the filename, so there was nothing to name the
 * file until a round trip returned. The device mints them now, and the account
 * learns about them.
 *
 * **Hex with the dashes taken out**, deliberately. `paths.ts`, `text-index.ts`
 * and `document-password.ts` each assert an id matches `/^[a-z0-9]+$/i` before
 * it becomes a filename or a keychain key, and a UUID's dashes fail all three.
 * Thirty-two hex characters pass, and are the same shape as a Convex id, so
 * nothing downstream can tell which of the two it is holding — including the
 * documents already on every existing device, which keep the Convex id they
 * were filed under rather than being renamed.
 */
import * as Crypto from 'expo-crypto';

export function mintId(): string {
  return Crypto.randomUUID().replace(/-/g, '');
}

/**
 * The bookmark id for a page.
 *
 * A bookmark is a page of a document, and the account identifies it that way
 * too — `addBookmark` and `removeBookmark` take a page, not an id. Deriving the
 * id from the pair rather than minting one means the same page marked twice on
 * two devices converges instead of becoming two rows.
 */
export function bookmarkId(documentId: string, page: number): string {
  return `${documentId}p${page}`;
}
