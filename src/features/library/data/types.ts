import type { PublicCollection, PublicDocument } from '@convex/model/library';

/**
 * The client's names for the server's wire shapes.
 *
 * Re-exported rather than redeclared: a field added to `PublicDocument` in
 * `convex/model/library.ts` should reach the components without a second
 * definition to keep in step.
 */
export type LibraryDocument = PublicDocument;
export type LibraryCollection = PublicCollection;

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
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/** Where a document is, which is two independent facts rather than one. */
export type Placement =
  /** On this phone. Opens with or without a connection. */
  | 'here'
  /** In the account, not fetched here yet. A tap gets it. */
  | 'fetchable'
  /** Moving right now. */
  | 'transferring'
  /** On this phone and nowhere else — over the sync limit, or not asked for. */
  | 'local-only';

export function placementOf(
  document: LibraryDocument,
  { onThisDevice, transferring }: { onThisDevice: boolean; transferring: boolean },
): Placement {
  if (transferring) {
    return 'transferring';
  }
  if (onThisDevice) {
    return document.isSynced ? 'here' : 'local-only';
  }
  return 'fetchable';
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
    onThisDevice,
    showProgress,
    transfer = null,
  }: {
    onThisDevice: boolean;
    showProgress: boolean;
    transfer?: { sent: number; total: number } | null;
  },
): string {
  // Ahead of everything, because a document still being read has no page count
  // to report and no useful placement to describe. It is deliberately not part
  // of `Placement`: where a document *is* and what state it is *in* are two
  // questions, and merging them would put a processing state in the sync badge.
  if (document.processing === 'probing' && onThisDevice) {
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
  if (!onThisDevice) {
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
