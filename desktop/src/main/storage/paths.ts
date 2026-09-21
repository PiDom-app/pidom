import { app } from 'electron';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';

/**
 * Where offline documents live on this computer, and the rules that keep a
 * renderer-supplied id from ever becoming an arbitrary path.
 *
 * The managed root is `userData/pidom-library/<accountKey>/`, with three
 * subdirectories:
 *   - `documents/` — the verified PDFs. Persistent; the point of the feature.
 *   - `cache/`     — regenerable artifacts (reserved for later phases). Safe to
 *                    clear without touching a document.
 *   - `tmp/`       — in-flight `.part` downloads. Cleared at both ends of a run
 *                    so a crash never leaves a half-file the reader trusts.
 *
 * Per-account separation follows the mobile app's rule: a different account
 * never reaches the previous reader's library. The account key is a hash of the
 * verified subject, so the directory name carries no PII and no character the
 * filesystem would choke on.
 *
 * Electron's docs warn against writing large files straight into `userData` and
 * recommend an app-specific subdirectory; a PDF library is exactly that case.
 */

/** The filename IS the document id. A hostile title never becomes a path
 *  segment — the same construction the mobile app and the reader cache use. */
const SAFE_ID = /^[A-Za-z0-9]+$/;

/** Convex ids are lowercase alphanumeric; bound the length as defence in depth. */
export function isSafeDocumentId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && SAFE_ID.test(value);
}

/** A stable, PII-free directory name for an account, from its verified subject. */
export function accountKey(subject: string): string {
  return createHash('sha256').update(subject).digest('hex').slice(0, 32);
}

export interface LibraryPaths {
  root: string;
  documents: string;
  cache: string;
  tmp: string;
}

/** Resolves (and creates, `0o700`) the managed library tree for an account. */
export async function ensureLibraryPaths(subject: string): Promise<LibraryPaths> {
  const root = join(app.getPath('userData'), 'pidom-library', accountKey(subject));
  const paths: LibraryPaths = {
    root,
    documents: join(root, 'documents'),
    cache: join(root, 'cache'),
    tmp: join(root, 'tmp'),
  };
  await mkdir(paths.documents, { recursive: true, mode: 0o700 });
  await mkdir(paths.cache, { recursive: true, mode: 0o700 });
  await mkdir(paths.tmp, { recursive: true, mode: 0o700 });
  return paths;
}

/**
 * The final path for a document's PDF, asserted to sit directly under
 * `documents/`. `isSafeDocumentId` has already refused anything but
 * `[A-Za-z0-9]`, so there is no separator or `..` to normalise away — this is
 * the second gate, matching the reader cache's `startsWith(dir + sep)` check.
 */
export function documentPath(paths: LibraryPaths, documentId: string): string {
  if (!isSafeDocumentId(documentId)) {
    throw new Error('storage rejected: bad document id');
  }
  const path = normalize(join(paths.documents, `${documentId}.pdf`));
  if (!path.startsWith(paths.documents + sep)) {
    throw new Error('storage rejected: path escapes the library root');
  }
  return path;
}
