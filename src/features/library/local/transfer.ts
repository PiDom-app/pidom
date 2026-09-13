import { File, type DownloadTask } from 'expo-file-system';

import { log } from '@/lib/logger';

import { coverFile, documentFile, ensureCoversDirectory, ensureLibraryDirectory } from './paths';
import { roomFor } from './space';
import { contentHashOf, fingerprintOf, readsAsPdf, sizeOf } from './validate';

const SCOPE = 'transfer';

/**
 * Moving files between the device and Cloudflare R2.
 *
 * Both directions use a URL the server signed after checking ownership. The
 * device never holds a bucket credential and never names an object key — the
 * key is minted in `library.uploadUrl` from ids the caller cannot bend, and the
 * download URL expires five minutes after it is issued.
 *
 * This replaced an authenticated route on `.convex.site`. That route checked
 * the token on the request that moved the bytes, which was stronger, and it
 * could not carry more than 20 MiB — Convex caps an HTTP action response there
 * on every plan. A 100 MB document has to come from somewhere else.
 */

export type Progress = { sent: number; total: number };

/**
 * PUTs a local file to a signed R2 URL.
 *
 * A PUT, not a POST — an S3 signed upload URL is a PUT, which is why the
 * bucket's CORS rule lists `GET` and `PUT`. There is nothing to read from the
 * response either: the key was decided by the mutation that minted the URL, so
 * success is the status code and nothing else.
 */
export async function uploadFile(
  file: File,
  signedUrl: string,
  contentType: string,
  onProgress?: (progress: Progress) => void,
): Promise<void> {
  const task = file.createUploadTask(signedUrl, {
    httpMethod: 'PUT',
    headers: { 'Content-Type': contentType },
    onProgress: ({ bytesSent, totalBytes }) => onProgress?.({ sent: bytesSent, total: totalBytes }),
  });

  const result = await task.uploadAsync();

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Upload failed with status ${result.status}`);
  }
}

/** Why a document that finished downloading is still not usable. */
export class BadDownload extends Error {
  constructor(readonly reason: 'no-space' | 'truncated' | 'not-a-pdf' | 'wrong-file') {
    super(`The downloaded file is not usable: ${reason}.`);
    this.name = 'BadDownload';
  }
}

/** Raised when the reader pauses a transfer. Not a failure, and never an attempt. */
export class Paused extends Error {
  constructor(readonly savable: string | null) {
    super('The download was paused.');
    this.name = 'Paused';
  }
}

/**
 * A transfer in flight, and the two things the queue can do to one.
 *
 * The handle used to be created and dropped on the floor — `downloadDocument`
 * awaited the task and nothing else ever held it, so there was no object to
 * pause and nothing to cancel. That is the whole reason pausing did not exist.
 */
export type Handle = {
  pause: () => Promise<string | null>;
  cancel: () => void;
};

/**
 * Downloads a document's PDF to its place in the library directory.
 *
 * To a temporary name first, then moved into place. A download interrupted
 * halfway would otherwise leave a truncated file under the name the scan reads
 * as "this document is on this device", and the reader would open a broken PDF
 * with no way to tell why.
 *
 * **And then it is checked**, which the move alone never did. A transfer can
 * finish successfully and still deliver the wrong bytes: a proxy that returned
 * an error page with a 200, a connection cut at a byte boundary the task did
 * not notice, storage that filled between the last chunk and the move. Three
 * questions answer all of those cheaply — is it the size the account said, does
 * it start with `%PDF-`, and if the account recorded a fingerprint, is it that
 * document. A file that fails any of them is deleted rather than left under a
 * name that reads as "ready", and the caller marks it `corrupt` so the tile can
 * offer to try again.
 *
 * A fourth thing is *recorded* rather than asked: the whole file's sha256, when
 * the file is small enough to have one. It refuses nothing here — the three
 * questions above have already decided — and exists so that the same file can
 * be checked again in six months, when the interesting corruption is the kind
 * that happened after it arrived and lands nowhere near either end.
 */
export async function downloadDocument(
  profileId: string,
  documentId: string,
  signedUrl: string,
  expected: { byteSize: number; fingerprint: string | null },
  options: {
    onProgress?: (progress: Progress) => void;
    /** Hands the queue something to pause or cancel. */
    onHandle?: (handle: Handle) => void;
    /** Continue rather than start again. `DownloadTask.savable()`, as JSON. */
    resumeFrom?: string | null;
    /** Keep whatever has already arrived, instead of starting from zero. */
    keepPartial?: boolean;
  } = {},
): Promise<{ hash: string | null }> {
  const space = roomFor(expected.byteSize);
  if (!space.ok) {
    throw new BadDownload('no-space');
  }

  const directory = ensureLibraryDirectory(profileId);
  const partial = new File(directory, `${documentId}.download`);
  if (partial.exists && options.keepPartial !== true) {
    partial.delete();
  }

  // No `Authorization` header: the URL carries its own signature, and it
  // expires. See `library.downloadUrl`.
  const taskOptions = {
    onProgress: ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) =>
      options.onProgress?.({ sent: bytesWritten, total: totalBytes }),
  };

  /**
   * Resume if there is something to resume from, and fall back to starting
   * again if there is not.
   *
   * The saved state carries the URL the transfer was using, and that URL is
   * five minutes old at best — `DOWNLOAD_URL_SECONDS`. On iOS the platform's
   * own resume data embeds the original request, so a resume against an expired
   * signature is refused, and the honest answer to that is a fresh download
   * rather than a retry loop against a dead credential. The caller has already
   * minted a new URL by the time this runs; the saved state is only ever used
   * to pick up the byte offset.
   */
  let task: DownloadTask | null = null;
  if (options.resumeFrom != null) {
    try {
      const saved = JSON.parse(options.resumeFrom) as { resumeData?: string };
      task = File.createDownloadTask(signedUrl, partial, taskOptions);
      if (saved.resumeData !== undefined) {
        task = DownloadTaskFromSavable(
          {
            url: signedUrl,
            fileUri: partial.uri,
            isDirectory: false,
            resumeData: saved.resumeData,
          },
          taskOptions,
        );
      }
    } catch (error) {
      log.debug(SCOPE, 'could not resume; starting again', error);
      task = null;
    }
  }
  if (task === null) {
    task = File.createDownloadTask(signedUrl, partial, taskOptions);
  }

  let paused = false;
  options.onHandle?.({
    pause: async () => {
      paused = true;
      await task.pauseAsync();
      try {
        return JSON.stringify(task.savable());
      } catch {
        // A task that could not describe itself is one that restarts. The
        // partial file is still on disk, so nothing that arrived is lost.
        return null;
      }
    },
    cancel: () => {
      paused = true;
      task.cancel();
    },
  });

  try {
    await task.downloadAsync();
  } catch (error) {
    if (paused) {
      // The partial file stays. That is the entire point of pausing, and
      // deleting it here is what the first version of this did.
      throw new Paused(null);
    }
    if (partial.exists) {
      partial.delete();
    }
    throw error;
  }

  if (paused) {
    throw new Paused(null);
  }

  const outcome = await verify(partial.uri, expected);
  if (outcome.failure !== null) {
    partial.delete();
    throw new BadDownload(outcome.failure);
  }

  const destination = documentFile(profileId, documentId);
  if (destination.exists) {
    destination.delete();
  }
  partial.move(destination);
  return { hash: outcome.hash };
}

/**
 * `DownloadTask.fromSavable`, reached through a name TypeScript will accept.
 *
 * The static lives on the class rather than on `File`, and the type shipped
 * with SDK 57 does not always surface it on the value side.
 */
function DownloadTaskFromSavable(
  state: { url: string; fileUri: string; isDirectory: boolean; resumeData?: string },
  options: Parameters<typeof File.createDownloadTask>[2],
): DownloadTask {
  const ctor = (File.createDownloadTask as unknown as { fromSavable?: unknown }).fromSavable;
  if (typeof ctor === 'function') {
    return (ctor as (s: typeof state, o: typeof options) => DownloadTask)(state, options);
  }
  throw new Error('This build cannot resume a paused download.');
}

/**
 * Throws away a partial download.
 *
 * Called when the reader cancels rather than pauses, and when a paused transfer
 * is abandoned. Never throws: a file that will not go is not worth failing a
 * cancel over, and the next download overwrites it anyway.
 */
export function discardPartial(profileId: string, documentId: string): void {
  try {
    const partial = new File(ensureLibraryDirectory(profileId), `${documentId}.download`);
    if (partial.exists) {
      partial.delete();
    }
  } catch (error) {
    log.debug(SCOPE, 'could not remove a partial download', error);
  }
}

/**
 * Checks a file that is already here, without fetching anything.
 *
 * Two occasions. The reader asks — a download they do not trust, on a device
 * that has been full — and the periodic pass, which exists because a file that
 * verified six months ago has been sitting on a disk since. A file that passed
 * every check at the moment it arrived can still be wrong later; nothing else
 * in this application would ever notice.
 */
export async function verifyLocal(
  profileId: string,
  documentId: string,
  expected: { byteSize: number; fingerprint: string | null },
): Promise<{ failure: BadDownload['reason'] | null; hash: string | null }> {
  const file = documentFile(profileId, documentId);
  if (!file.exists) {
    return { failure: 'truncated', hash: null };
  }
  return await verify(file.uri, expected);
}

/**
 * Whether the bytes that arrived are the document that was asked for.
 *
 * The fingerprint check is skipped when the account has none — documents
 * imported before fingerprints existed have no answer, and inventing a reason
 * to refuse one would break a library nobody has touched in a year. Size and
 * the header are always asked, because both are free.
 */
async function verify(
  uri: string,
  expected: { byteSize: number; fingerprint: string | null },
): Promise<{ failure: 'truncated' | 'not-a-pdf' | 'wrong-file' | null; hash: string | null }> {
  const size = sizeOf(uri);
  if (size === null || (expected.byteSize > 0 && size !== expected.byteSize)) {
    return { failure: 'truncated', hash: null };
  }
  if (!readsAsPdf(uri)) {
    return { failure: 'not-a-pdf', hash: null };
  }
  if (expected.fingerprint !== null) {
    const actual = await fingerprintOf(uri);
    // A fingerprint that could not be computed is not a mismatch. It is a read
    // that failed, and the two questions above have already been answered.
    if (actual !== null && actual !== expected.fingerprint) {
      return { failure: 'wrong-file', hash: null };
    }
  }

  /**
   * And the whole file, when the file is small enough to have a whole-file
   * answer. Not a fourth way of refusing a download — the three above have
   * already decided that — but the record a later check compares against.
   *
   * The three questions above are all about the *ends* of the file, and they
   * are exactly the questions a page corrupted in the middle of a textbook
   * passes. Recording the digest now is what lets the periodic re-verify notice
   * that, months later, on a file nothing has touched since.
   *
   * `null` above `HASHABLE_BYTE_MAX`, and the Downloads screen says which kind
   * of check a given document got rather than implying they all got the same
   * one.
   */
  return { failure: null, hash: await contentHashOf(uri) };
}

/**
 * Fetches a document's cover, if it has one.
 *
 * Never throws. A missing cover is the fallback tint, which is a working state
 * and not an error, so a failure here must not take a rail down with it.
 */
export async function downloadCover(
  profileId: string,
  documentId: string,
  signedUrl: string,
): Promise<boolean> {
  try {
    ensureCoversDirectory(profileId);
    const destination = coverFile(profileId, documentId);
    if (destination.exists) {
      return true;
    }

    const partial = new File(
      coverFile(profileId, documentId).parentDirectory,
      `${documentId}.part`,
    );
    if (partial.exists) {
      partial.delete();
    }

    const task = File.createDownloadTask(signedUrl, partial);
    await task.downloadAsync();
    partial.move(destination);
    return true;
  } catch (error) {
    log.debug(SCOPE, 'no cover to fetch', error);
    return false;
  }
}
