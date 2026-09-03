import { File } from 'expo-file-system';

import { log } from '@/lib/logger';

import { coverFile, documentFile, ensureCoversDirectory, ensureLibraryDirectory } from './paths';

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

/**
 * Downloads a document's PDF to its place in the library directory.
 *
 * To a temporary name first, then moved into place. A download interrupted
 * halfway would otherwise leave a truncated file under the name the scan reads
 * as "this document is on this device", and the reader would open a broken PDF
 * with no way to tell why.
 */
export async function downloadDocument(
  profileId: string,
  documentId: string,
  signedUrl: string,
  onProgress?: (progress: Progress) => void,
): Promise<void> {
  const directory = ensureLibraryDirectory(profileId);
  const partial = new File(directory, `${documentId}.download`);
  if (partial.exists) {
    partial.delete();
  }

  // No `Authorization` header: the URL carries its own signature, and it
  // expires. See `library.downloadUrl`.
  const task = File.createDownloadTask(signedUrl, partial, {
    onProgress: ({ bytesWritten, totalBytes }) =>
      onProgress?.({ sent: bytesWritten, total: totalBytes }),
  });

  try {
    await task.downloadAsync();
  } catch (error) {
    if (partial.exists) {
      partial.delete();
    }
    throw error;
  }

  const destination = documentFile(profileId, documentId);
  if (destination.exists) {
    destination.delete();
  }
  partial.move(destination);
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

    const partial = new File(coverFile(profileId, documentId).parentDirectory, `${documentId}.part`);
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
