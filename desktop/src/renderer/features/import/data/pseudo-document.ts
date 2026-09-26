import type { Id } from '@convex/dataModel';
import type { ImportJobStatus } from '../../../../shared/ipc';
import type { LibraryDocument } from '@/features/library/data/types';

/**
 * A library grid/list row that may still be a local-only import.
 *
 * When `importJob` is set the row is not yet a real Convex document: it is a
 * file staged on this device (validated and readable offline) whose cloud
 * registration is still pending. It is shown in the library the moment it lands
 * so the reader sees it immediately, then drops out once the reconciled document
 * arrives through `snapshot` under its real id. Real documents carry no
 * `importJob`, so a plain `LibraryDocument` is a valid `LibraryEntry`.
 */
export type LibraryEntry = LibraryDocument & { importJob?: ImportJobStatus };

/**
 * Present a local-only import job as a `LibraryDocument` so the existing grid,
 * list, and tile render it with no special cases. The device-minted `localId`
 * stands in for the Convex id (it is a valid reader route param and resolves to
 * the staged copy in main); everything the reader has not learned yet is left
 * empty. `isSynced: false` gives it the "on this device" treatment, and
 * `processing` reflects whether the import is still working or has failed.
 */
export function pseudoDocument(job: ImportJobStatus): LibraryEntry {
  return {
    // The localId is a device-minted 32-hex string, not a real Convex id, but
    // it addresses the staged copy everywhere the renderer needs an id.
    id: job.localId as unknown as Id<'documents'>,
    title: job.title,
    author: null,
    pageCount: null,
    byteSize: job.byteSize,
    currentPage: 0,
    progress: 0,
    isFinished: false,
    isFavorite: false,
    readingMode: null,
    lastOpenedAt: null,
    createdAt: Date.now(),
    isSynced: false,
    hasCover: false,
    processing: job.state === 'failed' ? 'failed' : 'probing',
    textStatus: null,
    hasOutline: false,
    originalFileName: null,
    mimeType: 'application/pdf',
    fingerprint: null,
    importJob: job,
  };
}
