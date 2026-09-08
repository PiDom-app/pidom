/**
 * The rows, and the shapes the screens read.
 *
 * A row is what SQLite stores — flat, with booleans as `0` and `1`, because
 * that is what SQLite has. A `LibraryDocument` is what a tile renders. The two
 * are kept apart so a screen never has to know that `isFavorite` is an integer,
 * and so a column can be added without every consumer learning about it.
 */

/**
 * Where a document's file is, on this device.
 *
 * Derived from the filesystem and from verification, never from a field the
 * account set. A row on the server can say a document *can* be fetched; only
 * the phone can say whether it is here and whether it opens.
 */
export type FileState =
  /** Not here. Fetchable if the account has a copy. */
  | 'missing'
  /** Bytes are moving right now. */
  | 'downloading'
  /** Here, and verified. This is the only state the reader will open. */
  | 'available'
  /** Here, and wrong — the wrong size, or not a PDF. Offers to try again. */
  | 'corrupt'
  /** Being removed. Transient, and kept so a half-done delete can finish. */
  | 'deleting'
  /** Removed on purpose. Distinct from `missing`, which was never here. */
  | 'deleted';

/**
 * How far a row has got towards the account.
 *
 * `local` means it has never been sent and has no remote counterpart — a
 * document imported in aeroplane mode, until the queue drains. `pending` means
 * the account has it and this device has changed it since. `synced` means the
 * two agree as far as this device knows.
 */
export type SyncState = 'local' | 'pending' | 'synced';

export type ProcessingState = 'probing' | 'ready' | 'partial' | 'failed';
export type TextStatus = 'queued' | 'extracting' | 'ready' | 'none' | 'failed';
export type ReadingMode = 'continuous' | 'single' | 'spread';

/** What a tile, a rail and the reader all read. */
export type LibraryDocument = {
  /** This device's id. The filename on disk, and the key everywhere local. */
  id: string;
  /** The account's id for the same document, once it has one. */
  remoteId: string | null;
  title: string;
  author: string | null;
  pageCount: number | null;
  byteSize: number;
  currentPage: number;
  progress: number;
  isFinished: boolean;
  isFavorite: boolean;
  readingMode: ReadingMode | null;
  lastOpenedAt: number | null;
  createdAt: number;
  /** The account holds a copy of the file. Says nothing about this device. */
  isSynced: boolean;
  hasCover: boolean;
  processing: ProcessingState;
  textStatus: TextStatus | null;
  hasOutline: boolean;
  originalFileName: string | null;
  mimeType: string | null;
  /**
   * Enough of the file to recognise it again.
   *
   * Carried on the document rather than kept for the import screen, because a
   * download checks what arrived against it before the file is allowed to count
   * as available.
   */
  fingerprint: string | null;
  /** Whether the file is on this phone, and whether it opens. */
  fileState: FileState;
  syncState: SyncState;
  /**
   * When the reader last changed this document, by this device's clock.
   *
   * The ordering clock for last-write-wins, and the one thing here that must
   * not be re-read at send time. The outbox deliberately reads *values* off the
   * row when it finally sends — the account is told where somebody ended up,
   * not replayed through every page they passed — but stamping the operation
   * with the moment of sending would make a week-old edit look newer than
   * yesterday's edit on another phone, and `isStale()` on the server could
   * never fire. Sent verbatim, so the account orders two devices by when each
   * reader acted.
   */
  clientUpdatedAt: number;
  /**
   * Whether this is the reader's own document.
   *
   * False for one that arrived under a grant. It is what the actions sheet
   * branches on: renaming, deleting, syncing and filing are the owner's, and
   * offering them on somebody else's document would be offering four controls
   * the account refuses. Hiding them is a convenience — `requireDocument` on
   * the server is what enforces it.
   */
  ownedByMe: boolean;
  /** The grant it arrived under, for a document that is not the reader's own. */
  shareId: string | null;
};

export type LibraryCollection = {
  id: string;
  remoteId: string | null;
  name: string;
  documentCount: number;
  /** Up to four, newest first. The mosaic on the collection tile. */
  coverDocumentIds: string[];
  createdAt: number;
};

/* ── sharing ─────────────────────────────────────────────────────────── */

export type ShareRole = 'viewer' | 'annotator';
export type ShareStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';

/**
 * A grant, from this device's point of view.
 *
 * It carries a copy of the document's title, size and page count, and that is
 * the reason the inbox works offline: a share the reader has not accepted has
 * no local file and no `documents` row, so without these there would be
 * nothing to draw but a grey rectangle and a name.
 *
 * `documentId` is the account's id for the document rather than a local one,
 * because until the share is accepted and downloaded there is no local
 * document to have an id. Once there is, `documents.shareId` points back here.
 */
export type LibraryShare = {
  id: string;
  remoteId: string | null;
  /** The account's document id. Not a local id, and never a path. */
  documentId: string | null;
  direction: 'incoming' | 'outgoing';
  subject: 'user' | 'group';
  /** The other party — the sender on an incoming share, the recipient on an outgoing one. */
  counterpartId: string | null;
  counterpartName: string | null;
  counterpartHandle: string | null;
  counterpartPictureUrl: string | null;
  groupId: string | null;
  groupName: string | null;
  title: string | null;
  author: string | null;
  pageCount: number | null;
  byteSize: number;
  hasCover: boolean;
  role: ShareRole;
  canDownload: boolean;
  canReshare: boolean;
  status: ShareStatus;
  message: string | null;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
  clientUpdatedAt: number;
  syncState: SyncState;
};

export type LibraryGroup = {
  id: string;
  remoteId: string | null;
  name: string;
  memberCount: number;
  /** The reader's own standing. `null` for a group they can see but are not in. */
  role: 'owner' | 'admin' | 'member' | null;
  createdAt: number;
  updatedAt: number;
  syncState: SyncState;
};

export type LibraryGroupMember = {
  groupId: string;
  userId: string;
  name: string | null;
  handle: string | null;
  pictureUrl: string | null;
  role: 'admin' | 'member';
  isOwner: boolean;
  addedAt: number;
};

export type ShareEventKind =
  | 'shareOffered'
  | 'shareAccepted'
  | 'shareDeclined'
  | 'accessRevoked'
  | 'accessChanged'
  | 'groupJoined'
  | 'groupDocumentShared'
  | 'annotationAdded';

export type LibraryShareEvent = {
  id: string;
  kind: ShareEventKind;
  shareId: string | null;
  documentId: string | null;
  groupId: string | null;
  actorName: string | null;
  actorHandle: string | null;
  actorPicture: string | null;
  read: boolean;
  createdAt: number;
};

export type LibraryBookmark = {
  id: string;
  documentId: string;
  page: number;
  label: string | null;
  createdAt: number;
  /** When the reader last named the mark. The ordering clock for the label. */
  clientUpdatedAt: number;
};

export type LibraryAnnotation = {
  id: string;
  remoteId: string | null;
  documentId: string;
  page: number;
  kind: 'passage' | 'note';
  text: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
  /** When the reader last edited the note. The ordering clock, as on a document. */
  clientUpdatedAt: number;
  /**
   * The account id of whoever wrote it, or `null` for one written before
   * sharing existed — which is the same as saying it was written by whoever
   * owns the document.
   */
  authorId: string | null;
  /** Whether anybody else on the document sees it. */
  visibility: 'private' | 'shared';
};

/** The stored row, before it becomes any of the above. */
export type DocumentRow = {
  id: string;
  remoteId: string | null;
  title: string;
  author: string | null;
  pageCount: number | null;
  byteSize: number;
  fingerprint: string | null;
  contentHash: string | null;
  originalFileName: string | null;
  mimeType: string | null;
  processing: string | null;
  processingError: string | null;
  textStatus: string | null;
  hasOutline: number;
  isSynced: number;
  hasCover: number;
  syncIntent: string | null;
  isFavorite: number;
  isFinished: number;
  currentPage: number;
  progress: number;
  readingMode: string | null;
  lastOpenedAt: number | null;
  createdAt: number;
  updatedAt: number;
  clientUpdatedAt: number;
  syncState: string;
  deletedAt: number | null;
  ownedByMe: number;
  shareId: string | null;
  /** Joined from `documentFiles`, which may have no row yet. */
  fileState: string | null;
};

/** SQLite has no boolean. `1` is true and everything else is not. */
export function asBool(value: number | null): boolean {
  return value === 1;
}

export function asFlag(value: boolean): number {
  return value ? 1 : 0;
}

export function toLibraryDocument(row: DocumentRow): LibraryDocument {
  return {
    id: row.id,
    remoteId: row.remoteId,
    title: row.title,
    author: row.author,
    pageCount: row.pageCount,
    byteSize: row.byteSize,
    currentPage: row.currentPage,
    progress: row.progress,
    isFinished: asBool(row.isFinished),
    isFavorite: asBool(row.isFavorite),
    readingMode: (row.readingMode as ReadingMode | null) ?? null,
    lastOpenedAt: row.lastOpenedAt,
    createdAt: row.createdAt,
    isSynced: asBool(row.isSynced),
    hasCover: asBool(row.hasCover),
    // A row written before processing existed has already been through
    // whatever processing there was, so a missing value reads as `ready`
    // rather than leaving old documents in a state they can never leave.
    processing: (row.processing as ProcessingState | null) ?? 'ready',
    textStatus: (row.textStatus as TextStatus | null) ?? null,
    hasOutline: asBool(row.hasOutline),
    originalFileName: row.originalFileName,
    mimeType: row.mimeType,
    fingerprint: row.fingerprint,
    fileState: (row.fileState as FileState | null) ?? 'missing',
    syncState: (row.syncState as SyncState) ?? 'pending',
    clientUpdatedAt: row.clientUpdatedAt,
    // Defaults to 1, so every document imported before sharing existed answers
    // yes — which is correct: they were all imported by whoever is reading them.
    ownedByMe: (row.ownedByMe ?? 1) === 1,
    shareId: row.shareId ?? null,
  };
}

/** The columns every read of a document selects, joined to its file state. */
export const DOCUMENT_COLUMNS = `
  d.id, d.remoteId, d.title, d.author, d.pageCount, d.byteSize, d.fingerprint,
  d.contentHash, d.originalFileName, d.mimeType, d.processing, d.processingError,
  d.textStatus, d.hasOutline, d.isSynced, d.hasCover, d.syncIntent, d.isFavorite,
  d.isFinished, d.currentPage, d.progress, d.readingMode, d.lastOpenedAt,
  d.createdAt, d.updatedAt, d.clientUpdatedAt, d.syncState, d.deletedAt,
  d.ownedByMe, d.shareId,
  f.state AS fileState
`;

export const DOCUMENT_FROM = `
  FROM documents d LEFT JOIN documentFiles f ON f.documentId = d.id
`;
