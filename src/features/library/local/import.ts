import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { log } from '@/lib/logger';

import { documentFile, ensureLibraryDirectory, ensureStagingDirectory } from './paths';
import { readsAsPdf } from './validate';

const SCOPE = 'import';

/**
 * Picking a PDF and putting it where the reader can open it offline.
 *
 * The order is the security property. The Convex row is written first so the
 * server mints the id, and the id is what names the file — the picker's own
 * `name` is only ever a title. See `./paths.ts`.
 *
 * Nothing is staged until the file's first five bytes say `%PDF-`. See
 * `./validate.ts` for why neither the MIME type nor the extension is enough.
 *
 * That leaves one window worth handling: a row can exist for a moment with no
 * file behind it. If the move fails, the row is deleted again, because a row
 * with no file reads as permanently "not on this device" and there is nothing
 * the reader could do about it.
 */

export type PickedDocument = {
  /** The cache URI `expo-document-picker` copied the file to. */
  uri: string;
  /** The picker's filename, minus `.pdf`. A title, never a path. */
  title: string;
  /** The picker's filename, whole. Presentation metadata, never a path. */
  originalFileName: string;
  /** What the picker claimed. Recorded, not trusted — the bytes decided. */
  mimeType: string | null;
  byteSize: number;
};

export type PickOutcome =
  | { ok: true; document: PickedDocument }
  | { ok: false; reason: 'cancelled' | 'not-a-pdf' | 'no-size' | 'unknown' };

/**
 * Opens the system document sheet.
 *
 * `copyToCacheDirectory` is on because the picked URI is otherwise a content
 * provider handle that other Expo APIs cannot read. The copy is what makes the
 * move below a plain filesystem operation.
 */
export async function pickPdf(): Promise<PickOutcome> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled) {
      return { ok: false, reason: 'cancelled' };
    }

    const asset = result.assets[0];
    if (asset === undefined) {
      return { ok: false, reason: 'unknown' };
    }

    // Android file managers hand back `application/octet-stream` for a PDF
    // often enough that rejecting on MIME type alone would refuse real
    // documents. The extension is the second chance, and one of the two has to
    // agree before the file is even opened.
    const claimsToBePdf =
      asset.mimeType === 'application/pdf' || asset.name.toLowerCase().endsWith('.pdf');
    if (!claimsToBePdf) {
      return { ok: false, reason: 'not-a-pdf' };
    }

    // Without a size there is nothing to record and, more to the point, nothing
    // to check a limit against.
    if (asset.size === undefined || asset.size === null || asset.size <= 0) {
      return { ok: false, reason: 'no-size' };
    }

    // And then the bytes, which are the only thing that actually settles it.
    // Both answers above came from the reader: a MIME type Android guessed and
    // a filename they chose. A `.docx` renamed `.pdf` used to import cleanly,
    // sit in the library with a tinted cover, and open to nothing.
    if (!readsAsPdf(asset.uri)) {
      return { ok: false, reason: 'not-a-pdf' };
    }

    // Out of the picker's cache and into ours, immediately. From here on the
    // probe and the commit both work from a path this app owns, and neither can
    // be surprised by the other or by the system reclaiming the picker's copy.
    // See `stagingDirectory` for the whole reason.
    const staged = stage(asset.uri);

    return {
      ok: true,
      document: {
        uri: staged.uri,
        title: titleFromFilename(asset.name),
        originalFileName: asset.name,
        mimeType: asset.mimeType ?? null,
        byteSize: asset.size,
      },
    };
  } catch (error) {
    log.error(SCOPE, 'the document picker failed', error);
    return { ok: false, reason: 'unknown' };
  }
}

/**
 * Moves a picked file into the staging directory under a fresh random name.
 *
 * A UUID, not the picked filename: the reader's filename never becomes a path
 * segment anywhere in this app, and staging is no exception.
 */
function stage(sourceUri: string): File {
  ensureStagingDirectory();
  const destination = new File(ensureStagingDirectory(), `${Crypto.randomUUID()}.pdf`);
  new File(sourceUri).move(destination);
  return destination;
}

/** Deletes a staged file. Called when the reader cancels, or after a commit. */
export function discardStaged(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch (error) {
    // Staging lives in the cache. Failing to clean up costs nothing the system
    // will not reclaim on its own.
    log.debug(SCOPE, 'could not discard a staged file', error);
  }
}

/** `Thinking, Fast and Slow.pdf` becomes `Thinking, Fast and Slow`. */
export function titleFromFilename(name: string): string {
  const withoutExtension = name.replace(/\.pdf$/i, '');
  return withoutExtension.trim() === '' ? name : withoutExtension.trim();
}

/**
 * Moves a picked file into the library directory under its document id.
 *
 * A move rather than a copy: the source is in the cache directory, which the
 * system may clear whenever it likes, so leaving the only good copy there would
 * lose the document at an unpredictable later date.
 */
export function storeLocally(profileId: string, documentId: string, sourceUri: string): void {
  ensureLibraryDirectory(profileId);
  const destination = documentFile(profileId, documentId);

  // A file already sitting at the destination means a previous import got this
  // far and then failed; the new one is the one the reader just chose.
  if (destination.exists) {
    destination.delete();
  }

  new File(sourceUri).move(destination);
}

/** Removes the local copy. Missing is success — the goal is that it is gone. */
export function removeLocally(profileId: string, documentId: string): void {
  try {
    const file = documentFile(profileId, documentId);
    if (file.exists) {
      file.delete();
    }
  } catch (error) {
    // Never passed a title or a path: `log.error` survives into release builds,
    // and both are reader content.
    log.error(SCOPE, 'could not delete a local document');
    log.debug(SCOPE, 'delete failed', error);
  }
}
