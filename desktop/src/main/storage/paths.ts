import { app } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open as openFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

import { CLOUD_BYTE_MAX } from '@convex-model/limits';

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

/** Every PDF begins with this. A renamed `.txt` fails here, whatever its name. */
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

/** The 64 KB edge window the mobile fingerprint hashes at each end of the file. */
const FINGERPRINT_EDGE = 64 * 1024;

/** How far a folder import descends, and how many PDFs it will queue at once.
 *  Bounds keep a pathological tree (deep symlink loops, a home directory full of
 *  files) from turning one click into an unbounded walk on the main thread. */
const MAX_SCAN_DEPTH = 8;
const MAX_SCAN_FILES = 1000;

/**
 * A device-minted document id for a local-first import: 32 lowercase hex chars,
 * exactly the mobile app's `mintId`. It names the staged `<localId>.pdf` and is
 * the idempotency key on `importDocument`, so it must pass `isSafeDocumentId`
 * (it does — hex is a subset of `[A-Za-z0-9]`).
 */
export function mintLocalId(): string {
  return randomUUID().replace(/-/g, '');
}

export interface ValidatedSource {
  /** The canonical, symlink-resolved absolute path of the picked file. */
  canonical: string;
  /** Its size in bytes, already bounded against `CLOUD_BYTE_MAX`. */
  size: number;
}

/**
 * Validates a path the reader picked, dropped, or launched us with — all
 * untrusted input to main. The bytes decide what a file is, never its extension:
 * the path must resolve (symlinks followed) to a regular file within the cloud
 * size ceiling whose first bytes are the `%PDF-` magic. Returns the canonical
 * path and size; throws a short-coded error otherwise.
 */
export async function validateSourceFile(pickedPath: string): Promise<ValidatedSource> {
  if (typeof pickedPath !== 'string' || pickedPath.length === 0 || !isAbsolute(pickedPath)) {
    throw new Error('import rejected: not an absolute path');
  }

  let canonical: string;
  try {
    canonical = await realpath(pickedPath);
  } catch {
    throw new Error('import rejected: file does not exist');
  }

  const info = await stat(canonical).catch(() => null);
  if (!info || !info.isFile()) throw new Error('import rejected: not a regular file');
  if (info.size <= 0) throw new Error('import rejected: empty file');
  if (info.size > CLOUD_BYTE_MAX) throw new Error('import rejected: file exceeds the size ceiling');

  const head = Buffer.alloc(PDF_MAGIC.byteLength);
  const handle = await openFile(canonical, 'r');
  try {
    const { bytesRead } = await handle.read(head, 0, head.byteLength, 0);
    if (bytesRead < head.byteLength || !head.equals(PDF_MAGIC)) {
      throw new Error('import rejected: not a PDF');
    }
  } finally {
    await handle.close();
  }

  return { canonical, size: info.size };
}

/**
 * The mobile importer's fingerprint: `<size>-<sha256(head | "|size|" | tail)>`,
 * over the first and last 64 KB of the file. Two byte-identical PDFs produce the
 * same string wherever they were imported, which is what lets the server collapse
 * a re-import onto the document the account already holds. Reads only the edges,
 * so it is cheap even for a large file.
 */
export async function fingerprintOfFile(path: string, size: number): Promise<string> {
  const hash = createHash('sha256');
  const handle = await openFile(path, 'r');
  try {
    const headLen = Math.min(FINGERPRINT_EDGE, size);
    const head = Buffer.alloc(headLen);
    await handle.read(head, 0, headLen, 0);
    hash.update(head);
    hash.update(`|${size}|`);
    if (size > FINGERPRINT_EDGE) {
      const tailLen = Math.min(FINGERPRINT_EDGE, size);
      const tail = Buffer.alloc(tailLen);
      await handle.read(tail, 0, tailLen, size - tailLen);
      hash.update(tail);
    }
  } finally {
    await handle.close();
  }
  return `${size}-${hash.digest('hex')}`;
}

/**
 * A bounded, depth-first walk collecting `.pdf` files under a picked folder. The
 * folder itself is untrusted, so the walk resolves and canonicalises the root,
 * refuses to follow directory symlinks (a loop would never terminate), and caps
 * both depth and count. Extension is advisory here — every returned path is still
 * put through `validateSourceFile` before anything is staged.
 */
export async function scanPdfs(folder: string): Promise<string[]> {
  if (typeof folder !== 'string' || folder.length === 0 || !isAbsolute(folder)) {
    throw new Error('import rejected: not an absolute path');
  }
  let root: string;
  try {
    root = await realpath(folder);
  } catch {
    throw new Error('import rejected: folder does not exist');
  }
  const info = await stat(root).catch(() => null);
  if (!info || !info.isDirectory()) throw new Error('import rejected: not a directory');

  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_SCAN_DEPTH || found.length >= MAX_SCAN_FILES) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (found.length >= MAX_SCAN_FILES) return;
      // Never traverse a symlink — neither a directory loop nor a link that
      // points back out of the chosen folder.
      if (entry.isSymbolicLink()) continue;
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(child, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        found.push(child);
      }
    }
  };
  await walk(root, 0);
  return found;
}
