import { Directory, File, Paths } from 'expo-file-system';

/**
 * Where a PDF lives on this device, and what it is called.
 *
 * ```
 * Documents/library/<profile id>/<document id>.pdf
 * Documents/library/<profile id>/covers/<document id>.jpg
 * ```
 *
 * **The filename is the Convex document id.** The name the reader picked the
 * file under never becomes a path segment, so a PDF called
 * `../../../shared_prefs/auth.xml` is a title and nothing else. That closes
 * traversal and collision by construction, rather than by sanitising a hostile
 * string and hoping the sanitiser is complete. The ordering that makes it work:
 * `library.importDocument` mints the id first, and only then is the file moved
 * into place — see `./import.ts`.
 *
 * **The directory is the profile id**, and that is not tidiness. Two accounts
 * sharing one folder is a data-loss bug: the home screen reconciles local files
 * against what the server says the caller owns, and one account cannot own
 * another's documents, so signing in as somebody else would delete the first
 * reader's library. A segment per profile makes that impossible rather than
 * careful. It also means signing out leaves nothing of one reader's library
 * where the next one can reach it.
 */

const ROOT = 'library';
const COVERS = 'covers';
const STAGING = 'pidom-import';

/**
 * Convex ids are lowercase alphanumerics. Checked rather than assumed, for both
 * segments, because "the id is safe" should be an assertion in the code and not
 * a belief about somebody else's id format.
 */
const SAFE_ID = /^[a-z0-9]+$/i;

export class UnsafeId extends Error {
  constructor(value: string) {
    super(`Refusing to use ${JSON.stringify(value)} as a path segment.`);
    this.name = 'UnsafeId';
  }
}

function checked(value: string): string {
  if (!SAFE_ID.test(value)) {
    throw new UnsafeId(value);
  }
  return value;
}

/** This account's directory. Nothing reads or writes outside it. */
export function libraryDirectory(profileId: string): Directory {
  return new Directory(Paths.document, ROOT, checked(profileId));
}

/** Creates it if this is the first import. Safe to call repeatedly. */
export function ensureLibraryDirectory(profileId: string): Directory {
  const directory = libraryDirectory(profileId);
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  return directory;
}

export function documentFile(profileId: string, documentId: string): File {
  return new File(libraryDirectory(profileId), `${checked(documentId)}.pdf`);
}

/**
 * The rendered first page, beside the PDF and under the same account rule.
 *
 * A subdirectory rather than a suffix, so `documentIdFromName` over the library
 * directory keeps seeing exactly the PDFs and a cover never counts as a
 * document the reader owns.
 */
export function coversDirectory(profileId: string): Directory {
  return new Directory(libraryDirectory(profileId), COVERS);
}

export function ensureCoversDirectory(profileId: string): Directory {
  const directory = coversDirectory(profileId);
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  return directory;
}

export function coverFile(profileId: string, documentId: string): File {
  return new File(coversDirectory(profileId), `${checked(documentId)}.jpg`);
}

/** The cover on disk, or `null`. What `DocumentCover` reads before the fallback. */
export function localCoverUri(profileId: string, documentId: string): string | null {
  try {
    const file = coverFile(profileId, documentId);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

/**
 * Where a picked file waits while the reader decides.
 *
 * The import screen renders a cover from the picked PDF and, if the reader
 * commits, moves that same PDF into the library. Doing both against the
 * picker's own cache copy is a race: the render takes a second or two, the Add
 * button is live immediately, and the move pulls the file out from under the
 * view that is reading it.
 *
 * So the picked file is moved here first, once, and everything downstream works
 * from a path this app controls. It also survives something the picker's copy
 * does not — the system is free to clear its cache directory while somebody is
 * still typing a title.
 *
 * Cache rather than documents: a staged file that never got committed is
 * rubbish, and the system clearing it is the correct outcome.
 */
export function stagingDirectory(): Directory {
  return new Directory(Paths.cache, STAGING);
}

export function ensureStagingDirectory(): Directory {
  const directory = stagingDirectory();
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  return directory;
}

/** The id a library filename belongs to, or `null` if it is not one of ours. */
export function documentIdFromName(name: string): string | null {
  if (!name.endsWith('.pdf')) {
    return null;
  }
  const id = name.slice(0, -'.pdf'.length);
  return SAFE_ID.test(id) ? id : null;
}
