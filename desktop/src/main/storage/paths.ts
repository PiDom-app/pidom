import { app } from 'electron';
import { createHash } from 'node:crypto';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

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

/** The subdirectory name under any base root that holds the managed tree. */
export const LIBRARY_DIR = 'pidom-library';

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

/** The default base directory when the reader has not chosen a custom location. */
export function defaultBase(): string {
  return app.getPath('userData');
}

/** Derives the account tree layout under a base directory, without creating it.
 *  The `<base>/pidom-library/<accountKey>/` shape is identical wherever base is,
 *  so a migration only changes the base — the per-account separation is kept. */
export function libraryPathsFor(base: string, subject: string): LibraryPaths {
  const root = join(base, LIBRARY_DIR, accountKey(subject));
  return {
    root,
    documents: join(root, 'documents'),
    cache: join(root, 'cache'),
    tmp: join(root, 'tmp'),
  };
}

/** Resolves (and creates, `0o700`) the managed library tree for an account under
 *  `base` (the default userData dir unless a custom location was chosen). */
export async function ensureLibraryPaths(subject: string, base?: string): Promise<LibraryPaths> {
  const paths = libraryPathsFor(base ?? defaultBase(), subject);
  await mkdir(paths.documents, { recursive: true, mode: 0o700 });
  await mkdir(paths.cache, { recursive: true, mode: 0o700 });
  await mkdir(paths.tmp, { recursive: true, mode: 0o700 });
  return paths;
}

/**
 * Validates a reader-chosen destination base directory for a library migration.
 *
 * The renderer only ever passes a path the OS folder picker returned, but this
 * is main and treats it as untrusted anyway. The destination must be an absolute
 * path to a real, writable directory that is not inside any Pidom-managed area
 * (the current library, or a `pidom-library` tree) and not the app's own
 * userData root. Symlinks are resolved first (`realpath`) so a link cannot point
 * the canonical check somewhere it would otherwise reject. Returns the
 * canonical base on success; throws a short-coded error otherwise.
 */
export async function validateDestinationBase(
  destination: string,
  currentRoot: string,
): Promise<string> {
  if (typeof destination !== 'string' || destination.length === 0 || !isAbsolute(destination)) {
    throw new Error('migration rejected: not an absolute path');
  }
  const requested = normalize(resolve(destination));

  // Resolve symlinks to compare the true location, not a link that could alias
  // a protected directory. A non-existent path cannot be a destination here.
  let canonical: string;
  try {
    canonical = await realpath(requested);
  } catch {
    throw new Error('migration rejected: folder does not exist');
  }

  const info = await stat(canonical).catch(() => null);
  if (!info || !info.isDirectory()) {
    throw new Error('migration rejected: not a directory');
  }

  // Never let the library land on top of protected app data, nor inside an
  // existing managed tree (which would nest a library inside a library).
  const under = (parent: string) => canonical === parent || canonical.startsWith(parent + sep);
  const userData = normalize(app.getPath('userData'));
  if (under(userData)) throw new Error('migration rejected: inside app data');
  if (canonical.split(sep).includes(LIBRARY_DIR)) {
    throw new Error('migration rejected: inside a Pidom library');
  }
  const currentBase = normalize(currentRoot);
  if (under(currentBase) || currentBase.startsWith(canonical + sep) || canonical === currentBase) {
    throw new Error('migration rejected: same as current location');
  }

  return canonical;
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
