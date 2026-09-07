import type { LibraryDocument } from '../local/repository/types';

/**
 * The client's names for the shapes the screens read.
 *
 * They used to be re-exports of the server's wire types, which was right while
 * the server was what a screen read. It is not any more: a tile is drawn from a
 * row in the device's own database, whose id this device may well have minted
 * itself, and whose file state no backend can know. So the vocabulary is the
 * local one, and `src/features/library/sync/` is the single place the two meet.
 */
export type { LibraryCollection, LibraryDocument } from '../local/repository/types';

/** Bytes as a reader reads them. `2411724` becomes `2.3 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
  }
  // Gigabytes exist here for the device rather than for a document: a single
  // PDF is capped well below one, but free space and a whole library are
  // routinely measured in them, and "8203 MB free" is a number nobody reads.
  const gb = mb / 1024;
  return gb < 10 ? `${gb.toFixed(1)} GB` : `${Math.round(gb)} GB`;
}

/** Where a document is, which is two independent facts rather than one. */
export type Placement =
  /** On this phone, and it opens. With or without a connection. */
  | 'here'
  /** In the account, not fetched here yet. A tap gets it. */
  | 'fetchable'
  /** Moving right now. */
  | 'transferring'
  /** On this phone and nowhere else — over the sync limit, or not asked for. */
  | 'local-only'
  /**
   * Here, and not readable.
   *
   * The bytes arrived and were not the document: the wrong size, not a PDF, or
   * a different file than the one the account recorded. Its own state because
   * "not here" and "here and broken" want different things offered.
   */
  | 'unreadable';

export function placementOf(
  document: LibraryDocument,
  { transferring }: { transferring: boolean },
): Placement {
  if (transferring || document.fileState === 'downloading') {
    return 'transferring';
  }
  if (document.fileState === 'corrupt') {
    return 'unreadable';
  }
  if (document.fileState === 'available') {
    return document.isSynced ? 'here' : 'local-only';
  }
  return 'fetchable';
}

/** Whether the reader can open this one right now. */
export function isOpenable(document: LibraryDocument): boolean {
  return document.fileState === 'available';
}

/**
 * The line under a tile's title.
 *
 * The order matters: what the reader cannot do comes before anything else, then
 * how far they are, then what the thing is.
 */
export function metaLineFor(
  document: LibraryDocument,
  {
    showProgress,
    transfer = null,
  }: {
    showProgress: boolean;
    transfer?: { sent: number; total: number } | null;
  },
): string {
  const here = document.fileState === 'available';

  // Ahead of everything, because a document still being read has no page count
  // to report and no useful placement to describe. It is deliberately not part
  // of `Placement`: where a document *is* and what state it is *in* are two
  // questions, and merging them would put a processing state in the sync badge.
  if (document.processing === 'probing' && here) {
    return 'Preparing…';
  }
  if (document.processing === 'failed') {
    return "Couldn't read this one";
  }
  if (transfer !== null) {
    return transfer.total > 0
      ? `${formatBytes(transfer.sent)} of ${formatBytes(transfer.total)}`
      : 'Starting…';
  }
  // Before "not on this device", because it *is* on this device — it is the one
  // state where the file is here and tapping it would open nothing.
  if (document.fileState === 'corrupt') {
    return 'Try again';
  }
  if (!here) {
    // The account has it and this phone does not. That is an invitation, not a
    // refusal — which is what it was before anything could be uploaded.
    return document.isSynced
      ? `In your account · ${formatBytes(document.byteSize)}`
      : 'Not on this device';
  }
  if (document.isFinished && document.pageCount !== null) {
    return `Finished · ${document.pageCount} pages`;
  }
  if (showProgress && document.pageCount !== null) {
    const percent = Math.round(document.progress * 100);
    return `${percent}% · page ${document.currentPage} of ${document.pageCount}`;
  }
  if (document.pageCount === null) {
    // Import reads the count off the same load that renders the first page, so
    // this is the exception: a document imported before the probe existed, and
    // never opened since.
    return `PDF · ${formatBytes(document.byteSize)}`;
  }
  // A document that is only here is worth saying so about — it is the one state
  // where losing the phone loses the document.
  return document.isSynced
    ? `PDF · ${document.pageCount} pages`
    : `On this phone only · ${document.pageCount} pages`;
}
