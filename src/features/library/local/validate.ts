import * as Crypto from 'expo-crypto';
import { File, FileMode, type FileHandle } from 'expo-file-system';

import { log } from '@/lib/logger';

const SCOPE = 'validate';

/**
 * Looking at a picked file's bytes before it becomes a document.
 *
 * The picker answers two questions and neither is trustworthy. `mimeType`
 * arrives as `application/octet-stream` from Android file managers often enough
 * that Pidom cannot refuse on it, and `name` is a string the reader chose. So a
 * `.docx` renamed `.pdf` used to import cleanly, sit in the library with a
 * tinted cover, and open to nothing.
 *
 * Five bytes off the front settles it, and the same open reads both ends for a
 * fingerprint. Neither costs anything a reader would notice.
 */

/** `%PDF-`, which every PDF since 1.0 begins with. */
const MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

/**
 * How much of each end goes into the fingerprint.
 *
 * 64 KB is past the header and into real page content at the front, and past
 * the cross-reference table at the back — the two parts of a PDF that differ
 * between two documents that happen to share a producer and a size.
 */
const EDGE = 64 * 1024;

/**
 * True when the file starts like a PDF.
 *
 * A header check, not a parse. It closes the renamed-file case, which is the
 * one that actually happens; a file that starts `%PDF-` and is corrupt after
 * that is caught by the probe, which is the thing that can tell.
 */
export function readsAsPdf(uri: string): boolean {
  let handle: FileHandle | null = null;
  try {
    handle = new File(uri).open(FileMode.ReadOnly);
    const head = handle.readBytes(MAGIC.length);
    return MAGIC.every((byte, i) => head[i] === byte);
  } catch (error) {
    // Unreadable is not a PDF as far as the import is concerned, and the
    // refusal the reader sees says the file could not be read.
    log.debug(SCOPE, 'could not read the file header', error);
    return false;
  } finally {
    handle?.close();
  }
}

/**
 * A staged file's size, or `null` if it cannot be read.
 *
 * The picker reports a size and a file another app handed over does not, so
 * this is the second answer to the same question — and the answer a limit is
 * checked against either way. `null` refuses the import, because a size is what
 * `CLOUD_BYTE_MAX` and `BYTE_SIZE_MAX` are compared to.
 */
export function sizeOf(uri: string): number | null {
  try {
    const size = new File(uri).size;
    return size !== null && size > 0 ? size : null;
  } catch {
    return null;
  }
}

/**
 * Enough of a file to recognise it again.
 *
 * `<byteSize>-<sha256 of the first 64 KB, the last 64 KB, and the size>`.
 *
 * Deliberately not a digest of the whole file. `expo-crypto` hashes a buffer
 * with no streaming API, so a real content hash means holding a 100 MB textbook
 * in memory on a phone — which is a crash on the low-end devices this app is
 * meant to work on. Both ends plus the length is decisive for the case this
 * exists for, which is the same file picked twice, and it is not represented as
 * anything stronger: the field is called `fingerprint`, and `contentHash` beside
 * it is R2's real digest of the copy in the account.
 *
 * The size is hashed in as well, so two documents sharing a template's first
 * and last pages cannot collide on length alone.
 */
export async function fingerprintOf(uri: string): Promise<string | null> {
  let handle: FileHandle | null = null;
  try {
    const file = new File(uri);
    const size = file.size ?? 0;
    if (size <= 0) {
      return null;
    }

    handle = file.open(FileMode.ReadOnly);
    const head = handle.readBytes(Math.min(EDGE, size));

    // A file smaller than one edge has already been read whole, and seeking
    // backwards into it would hash the same bytes twice.
    let tail = new Uint8Array(0);
    if (size > EDGE) {
      handle.offset = Math.max(0, size - EDGE);
      tail = handle.readBytes(Math.min(EDGE, size));
    }

    const sizeBytes = new TextEncoder().encode(`|${size}|`);
    const joined = new Uint8Array(head.length + sizeBytes.length + tail.length);
    joined.set(head, 0);
    joined.set(sizeBytes, head.length);
    joined.set(tail, head.length + sizeBytes.length);

    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, joined);
    return `${size}-${hex(digest)}`;
  } catch (error) {
    // A fingerprint is an optimisation. Failing to take one costs the reader a
    // duplicate warning they will not see, and nothing else — so the import
    // carries on without it.
    log.debug(SCOPE, 'could not fingerprint the file', error);
    return null;
  } finally {
    handle?.close();
  }
}

/** Lowercase, matching the shape `cleanFingerprint` checks server-side. */
function hex(buffer: ArrayBuffer): string {
  let out = '';
  for (const byte of new Uint8Array(buffer)) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}
