import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { PaginationOptions, PaginationResult } from 'convex/server';

import { r2 } from '../r2';

import type { MutationCtx, QueryCtx } from '../_generated/server';
import * as Annotations from './annotations';
import * as Blobs from './blobs';
import * as Sharing from './sharing';
import { assertOwner } from './auth';
import * as Processing from './processing';
import * as Usage from './usage';
import { clientClock, documentByLocalId, isLocalId, isStale, localIdField } from './sync';
import { queueExtraction } from '../workflows/document';
import {
  AUTHOR_MAX,
  BOOKMARKS_PER_DOCUMENT,
  BOOKMARK_LABEL_MAX,
  BYTE_SIZE_MAX,
  CLOUD_BYTE_MAX,
  COVER_BYTE_MAX,
  MIME_TYPE_MAX,
  PAGE_DELETE_BUDGET,
  PAGE_DRAIN_PASSES,
  PAGE_COUNT_MAX,
  RAIL_LIMIT,
  TITLE_MAX,
  clamp,
  cleanOptionalText,
  cleanText,
  invalid,
} from './limits';

/**
 * The library's server logic. `convex/library.ts` is the argument contract and
 * nothing else.
 *
 * Two rules hold everywhere in this file:
 *
 *   1. Reads are `.take(n)`, never `.collect()`. A reader with four thousand
 *      documents should cost the same as one with four.
 *   2. Nothing trusts a number or a string from the client. Titles go through
 *      `cleanText`, positions through `clampPosition`, and both are re-checked
 *      on every write rather than only at import.
 */

/**
 * What the client is allowed to see about a document.
 *
 * Pinned like `toPublicProfile`, so adding a column to the schema cannot leak
 * it by accident.
 */
/**
 * How the reader lays a document out.
 *
 * Declared once and used four times — the schema, the wire type, the wire
 * validator and the mutation argument — because a fourth mode added in three of
 * those places and forgotten in the fourth is a runtime validator error, not a
 * build one.
 */
export const readingModeValidator = v.union(
  v.literal('continuous'),
  v.literal('single'),
  v.literal('spread'),
);

export type ReadingMode = 'continuous' | 'single' | 'spread';

export type PublicDocument = {
  id: Id<'documents'>;
  title: string;
  author: string | null;
  pageCount: number | null;
  byteSize: number;
  currentPage: number;
  progress: number;
  isFinished: boolean;
  isFavorite: boolean;
  /** Null until the reader has chosen one; the screen picks a default by width. */
  readingMode: ReadingMode | null;
  lastOpenedAt: number | null;
  createdAt: number;
  /** True when a copy exists in the account and any device can fetch it. */
  isSynced: boolean;
  /** True when a rendered first page exists to fetch. */
  hasCover: boolean;
  /** What the device probe got off the one PDF load at import. */
  processing: 'probing' | 'ready' | 'partial' | 'failed';
  /** Absent unless the document is synced — only then is there text to read. */
  textStatus: 'queued' | 'extracting' | 'ready' | 'none' | 'failed' | null;
  /** True when there is a Contents sheet to open. */
  hasOutline: boolean;
  /** What the file was called when it was picked, if that was recorded. */
  originalFileName: string | null;
  mimeType: string | null;
  /**
   * Enough of the file to recognise it again.
   *
   * On the wire now, where it used to be held back as "not a thing a rail
   * needs". A rail still does not need it — a *download* does. The device
   * checks what arrived against this before it will open it, because a
   * transfer that finished is not the same fact as a document that opens, and
   * without something to compare against the only alternative was to trust the
   * bytes. It is the reader's own fact about their own file.
   */
  fingerprint: string | null;
};

export function toPublicDocument(doc: Doc<'documents'>): PublicDocument {
  return {
    id: doc._id,
    title: doc.title,
    author: doc.author ?? null,
    pageCount: doc.pageCount ?? null,
    byteSize: doc.byteSize,
    currentPage: doc.currentPage,
    progress: doc.progress,
    isFinished: doc.isFinished,
    isFavorite: doc.isFavorite,
    readingMode: doc.readingMode ?? null,
    lastOpenedAt: doc.lastOpenedAt ?? null,
    createdAt: doc.createdAt,
    // The storage ids themselves never cross the wire. The client fetches by
    // document id through an authenticated route, so a storage id would be an
    // identifier it has no use for and one more thing that can leak.
    isSynced: doc.storageKey !== undefined,
    hasCover: doc.coverStorageKey !== undefined,
    // A row written before processing existed has already been through
    // whatever processing there was, so a missing value reads as `ready`
    // rather than leaving old documents in a state they can never leave.
    processing: doc.processing ?? 'ready',
    textStatus: doc.textStatus ?? null,
    hasOutline: doc.hasOutline ?? false,
    originalFileName: doc.originalFileName ?? null,
    mimeType: doc.mimeType ?? null,
    fingerprint: doc.fingerprint ?? null,
    // `processingError` is deliberately absent: it is a code the client already
    // has a sentence for, and a backend string rendered straight into a screen
    // is a backend string in a screenshot.
  };
}

/**
 * The wire shape, as a validator.
 *
 * It lives beside `toPublicDocument` rather than in `convex/library.ts` so the
 * type and the validator cannot drift: a field added to one is a type error in
 * the other on the next build.
 */
export const publicDocumentValidator = v.object({
  id: v.id('documents'),
  title: v.string(),
  author: v.union(v.string(), v.null()),
  pageCount: v.union(v.number(), v.null()),
  byteSize: v.number(),
  currentPage: v.number(),
  progress: v.number(),
  isFinished: v.boolean(),
  isFavorite: v.boolean(),
  readingMode: v.union(readingModeValidator, v.null()),
  lastOpenedAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  isSynced: v.boolean(),
  hasCover: v.boolean(),
  processing: v.union(
    v.literal('probing'),
    v.literal('ready'),
    v.literal('partial'),
    v.literal('failed'),
  ),
  textStatus: v.union(
    v.literal('queued'),
    v.literal('extracting'),
    v.literal('ready'),
    v.literal('none'),
    v.literal('failed'),
    v.null(),
  ),
  hasOutline: v.boolean(),
  originalFileName: v.union(v.string(), v.null()),
  mimeType: v.union(v.string(), v.null()),
  fingerprint: v.union(v.string(), v.null()),
});

export type PublicCollection = {
  id: Id<'collections'>;
  name: string;
  documentCount: number;
  /** Up to four, newest first. The mosaic on the collection tile. */
  coverDocumentIds: Id<'documents'>[];
  createdAt: number;
};

export const publicCollectionValidator = v.object({
  id: v.id('collections'),
  name: v.string(),
  documentCount: v.number(),
  coverDocumentIds: v.array(v.id('documents')),
  createdAt: v.number(),
});

/* ── reads ──────────────────────────────────────────────────────────── */

/**
 * Documents the reader has started and not finished, most recently opened
 * first.
 *
 * `by_owner_and_finished` sorts on `lastOpenedAt`, and a document that has
 * never been opened has none — under `.order('desc')` those sort last, so
 * taking the first `RAIL_LIMIT` and dropping the unopened ones costs one index
 * scan and no filter.
 */
export async function continueReading(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
): Promise<Doc<'documents'>[]> {
  const started = await ctx.db
    .query('documents')
    .withIndex('by_owner_and_finished', (q) => q.eq('ownerId', ownerId).eq('isFinished', false))
    .order('desc')
    .take(RAIL_LIMIT);

  return started.filter((doc) => doc.lastOpenedAt !== undefined);
}

/** Newest import first. `_creationTime` is the tiebreaker `by_owner` sorts on. */
export async function recentlyAdded(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
): Promise<Doc<'documents'>[]> {
  return await ctx.db
    .query('documents')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .order('desc')
    .take(RAIL_LIMIT);
}

export async function favorites(ctx: QueryCtx, ownerId: Id<'users'>): Promise<Doc<'documents'>[]> {
  return await ctx.db
    .query('documents')
    .withIndex('by_owner_and_favorite', (q) => q.eq('ownerId', ownerId).eq('isFavorite', true))
    .order('desc')
    .take(RAIL_LIMIT);
}

/** The other half of `by_owner_and_finished`. */
export async function finished(ctx: QueryCtx, ownerId: Id<'users'>): Promise<Doc<'documents'>[]> {
  return await ctx.db
    .query('documents')
    .withIndex('by_owner_and_finished', (q) => q.eq('ownerId', ownerId).eq('isFinished', true))
    .order('desc')
    .take(RAIL_LIMIT);
}

/**
 * Every collection, with the covers its tile draws.
 *
 * `COLLECTION_LIMIT` collections each read `COLLECTION_COVER_LIMIT` membership
 * rows, so the whole section is a bounded number of index lookups whatever the
 * library holds. The count is the denormalised field rather than a scan.
 */
export async function collectionSummaries(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
  limit: number,
  coverLimit: number,
): Promise<PublicCollection[]> {
  const rows = await ctx.db
    .query('collections')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .order('desc')
    .take(limit);

  return await Promise.all(
    rows.map(async (collection) => {
      const members = await ctx.db
        .query('collectionDocuments')
        .withIndex('by_collection', (q) => q.eq('collectionId', collection._id))
        .order('desc')
        .take(coverLimit);

      return {
        id: collection._id,
        name: collection.name,
        documentCount: collection.documentCount,
        coverDocumentIds: members.map((member) => member.documentId),
        createdAt: collection.createdAt,
      };
    }),
  );
}

/* ── writes ─────────────────────────────────────────────────────────── */

export type ImportInput = {
  title: string;
  author?: string;
  byteSize: number;
  /** The picker's filename. Presentation metadata; the id is the path. */
  originalFileName?: string;
  /** What the picker claimed. Recorded, not trusted. */
  mimeType?: string;
  /**
   * From the probe, which runs while the reader is still typing a title. A
   * document arrives in the library already knowing how long it is; only a
   * probe that failed leaves this out.
   */
  pageCount?: number;
  /** `<byteSize>-<sha256 of both ends>`. See the field's note in the schema. */
  fingerprint?: string;
  /**
   * The id the importing device already gave this document.
   *
   * Present from any client that mints its own — which is every client that can
   * import with no connection, because the id is the filename. See
   * `documents.localId`.
   */
  localId?: string;
  /** The device's clock at the import. See `model/sync.ts`. */
  clientUpdatedAt?: number;
};

/**
 * Records an imported PDF and returns the row.
 *
 * **Idempotent on `localId`, and that is what makes it safe to queue.** The
 * device writes the document to its own database and puts a create in its
 * outbox; if the reply to that create is lost after this mutation committed —
 * a socket that dropped between the write and the acknowledgement, an app the
 * system killed — the operation is delivered again. Without the lookup below
 * that is a second row, a second copy in the account, and a library with the
 * same book in it twice.
 *
 * Returning the existing id rather than refusing is deliberate: the client
 * asked for this document to exist and it does, which is the outcome it wanted.
 * A refusal would leave the operation stuck in a queue that can never drain.
 */
export async function importDocument(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  input: ImportInput,
): Promise<Id<'documents'>> {
  if (input.localId !== undefined) {
    if (!isLocalId(input.localId)) {
      invalid('That document id is not one Pidom writes.');
    }
    const existing = await documentByLocalId(ctx, owner, input.localId);
    if (existing !== null) {
      return existing._id;
    }
  }

  const title = cleanText(input.title, TITLE_MAX, 'Title');
  const author = cleanOptionalText(input.author, AUTHOR_MAX, 'Author');
  // Through the same normaliser as a title, because it arrives from the same
  // place and is rendered in the same kind of row. It is never a path — the
  // document id is — so this is about legibility rather than safety.
  const originalFileName = cleanOptionalText(input.originalFileName, TITLE_MAX, 'File name');
  const mimeType = cleanOptionalText(input.mimeType, MIME_TYPE_MAX, 'File type');

  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    invalid('A document must have a size.');
  }
  if (input.byteSize > BYTE_SIZE_MAX) {
    invalid(`Documents are limited to ${Math.round(BYTE_SIZE_MAX / 1024 / 1024)} MB.`);
  }

  const now = Date.now();
  const pageCount =
    input.pageCount === undefined
      ? undefined
      : Math.round(clamp(input.pageCount, 1, PAGE_COUNT_MAX));

  const fingerprint =
    input.fingerprint === undefined ? undefined : cleanFingerprint(input.fingerprint);

  /**
   * The same file, already in this reader's own account.
   *
   * `by_owner_and_fingerprint` has been declared since fingerprints existed and
   * nothing has ever queried it. This is what it was for: the reader who
   * imported a textbook on their phone, reinstalled, and imported it again from
   * the same downloads folder now gets the cloud copy they already paid for
   * rather than a second upload and a second full run of pdf.js.
   *
   * **Scoped to `ownerId` in the index, which is the whole of its safety.** A
   * fingerprint covers 64 KB from each end of a file and is trivially forged;
   * what it can reach is bounded by whose rows it is allowed to match, and here
   * that is the caller's own. Telling readers about their own library leaks
   * nothing. Sharing across accounts is a different mechanism entirely — it is
   * keyed on a digest R2 computed, and it never answers a question a client
   * asked. See `model/blobs.ts`.
   */
  const twin =
    fingerprint === undefined
      ? null
      : await ctx.db
          .query('documents')
          .withIndex('by_owner_and_fingerprint', (q) =>
            q.eq('ownerId', owner._id).eq('fingerprint', fingerprint),
          )
          .filter((q) => q.neq(q.field('storageKey'), undefined))
          .first();

  const shared = twin === null ? {} : await adoptContentOf(ctx, twin);

  const documentId = await ctx.db.insert('documents', {
    ownerId: owner._id,
    title,
    // Spread rather than assigned: Convex reads an explicit `undefined` in a
    // patch as "delete this field", and keeping one shape for insert and patch
    // means the same habit everywhere.
    ...(author === undefined ? {} : { author }),
    ...(originalFileName === undefined ? {} : { originalFileName }),
    ...(mimeType === undefined ? {} : { mimeType }),
    ...(pageCount === undefined ? {} : { pageCount }),
    ...(fingerprint === undefined ? {} : { fingerprint }),
    ...localIdField(input.localId),
    ...clientClock(input.clientUpdatedAt),
    byteSize: Math.round(input.byteSize),
    // A page count means the probe finished before the reader committed, which
    // is the usual case — the cover renders while they are reading the title.
    // Without one the document is in the library and its cover is still coming.
    processing: pageCount === undefined ? 'probing' : 'ready',
    hasOutline: false,
    currentPage: 1,
    progress: 0,
    isFinished: false,
    isFavorite: false,
    createdAt: now,
    updatedAt: now,
    // Last, so the cloud copy the twin already has cannot be overwritten by a
    // default above it. Empty when there was no twin, which is the ordinary
    // case and the one every document took before this existed.
    ...shared,
  });

  await Usage.added(ctx, {
    ownerId: owner._id,
    byteSize: Math.round(input.byteSize),
    storageKey: shared.storageKey,
    textStatus: shared.textStatus,
  });
  return documentId;
}

/**
 * The cloud copy of a document this account already holds, ready to be shared.
 *
 * Nothing is uploaded and nothing is parsed. The new row points at the same
 * object, the same text object and the same blob as the one it matched, and the
 * blob's count goes up by one — so deleting either of them leaves the other
 * working, and deleting both releases the object exactly once.
 */
async function adoptContentOf(
  ctx: MutationCtx,
  twin: Doc<'documents'>,
): Promise<Partial<Doc<'documents'>>> {
  if (twin.storageKey === undefined) {
    return {};
  }

  const blobId = twin.blobId ?? (await promoteToBlob(ctx, twin));
  if (blobId !== undefined) {
    await Blobs.retain(ctx, blobId);
  }

  return {
    storageKey: twin.storageKey,
    ...(twin.coverStorageKey === undefined ? {} : { coverStorageKey: twin.coverStorageKey }),
    ...(twin.contentHash === undefined ? {} : { contentHash: twin.contentHash }),
    ...(twin.textStorageKey === undefined ? {} : { textStorageKey: twin.textStorageKey }),
    ...(twin.textBytes === undefined ? {} : { textBytes: twin.textBytes }),
    ...(twin.textStatus === undefined ? {} : { textStatus: twin.textStatus }),
    ...(blobId === undefined ? {} : { blobId }),
    uploadedAt: Date.now(),
  };
}

/**
 * Starts counting a document that owns its bytes outright, with itself as the
 * first reference.
 *
 * Every document uploaded before content sharing existed is in that state, and
 * so is every one R2 gave no digest for. The moment a second document wants the
 * same object, something has to be counting — two rows sharing a key with
 * nothing tracking the sharing is the one arrangement that loses somebody's
 * library when the other one is deleted.
 *
 * Returns `undefined` when there is no digest to key on, which leaves the
 * document exactly as it was: its own object, deleted with it.
 */
async function promoteToBlob(
  ctx: MutationCtx,
  doc: Doc<'documents'>,
): Promise<Id<'contentBlobs'> | undefined> {
  if (doc.storageKey === undefined || doc.contentHash === undefined) {
    return undefined;
  }

  const existing = await Blobs.byHash(ctx, doc.contentHash);
  if (existing !== null) {
    await Blobs.retain(ctx, existing._id);
    await ctx.db.patch('documents', doc._id, { blobId: existing._id });
    return existing._id;
  }

  // `create` opens at one, which is this document.
  const blobId = await Blobs.create(ctx, {
    contentHash: doc.contentHash,
    storageKey: doc.storageKey,
    byteSize: doc.byteSize,
    ...(doc.pageCount === undefined ? {} : { pageCount: doc.pageCount }),
  });
  await ctx.db.patch('documents', doc._id, { blobId });

  // Whatever this document has already been through, so the next account to
  // arrive at the same bytes inherits it rather than re-parsing them.
  if (doc.textStatus !== undefined) {
    await Blobs.setText(ctx, blobId, {
      ...(doc.textStorageKey === undefined ? {} : { textStorageKey: doc.textStorageKey }),
      ...(doc.textBytes === undefined ? {} : { textBytes: doc.textBytes }),
      textStatus: doc.textStatus,
    });
  }
  return blobId;
}

/**
 * A fingerprint, or a refusal.
 *
 * It is only ever compared for equality and never parsed, so the check is that
 * it is the shape this app writes rather than an attempt to validate a hash.
 * The point is that a client cannot store an arbitrary string in an indexed
 * field — `<digits>-<64 hex characters>` and nothing else.
 */
function cleanFingerprint(value: string): string {
  if (!/^[0-9]{1,20}-[0-9a-f]{64}$/.test(value)) {
    invalid('That file fingerprint is not one Pidom writes.');
  }
  return value;
}

/**
 * Records how the device probe ended.
 *
 * Called after the import screen has closed, because the probe can outlive it —
 * a large document renders its first page while the reader is already back on
 * home. `processingError` is a code; the client owns the sentence.
 */
export async function setProcessing(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  input: {
    documentId: Id<'documents'>;
    processing: 'probing' | 'ready' | 'partial' | 'failed';
    pageCount?: number;
    error?: string;
  },
): Promise<void> {
  const doc = await requireDocument(ctx, owner, input.documentId);

  const pageCount =
    input.pageCount === undefined
      ? doc.pageCount
      : Math.round(clamp(input.pageCount, 1, PAGE_COUNT_MAX));

  await ctx.db.patch('documents', doc._id, {
    processing: input.processing,
    ...(pageCount === undefined ? {} : { pageCount }),
    // Cleared on any outcome that is not a failure, so a document that was
    // reprocessed successfully stops carrying the reason it failed last time.
    processingError: input.processing === 'failed' ? (input.error ?? 'UNREADABLE') : undefined,
    updatedAt: Date.now(),
  });
}

/** The caller's document, or `FORBIDDEN`. The guard for every write below. */
export async function requireDocument(
  ctx: QueryCtx | MutationCtx,
  owner: Doc<'users'>,
  documentId: Id<'documents'>,
): Promise<Doc<'documents'>> {
  const doc = await ctx.db.get('documents', documentId);
  assertOwner(doc, owner);
  return doc;
}

/**
 * Forces a reported reading position into a position that can exist.
 *
 * The client sends where it thinks the reader is. This decides what is stored,
 * because `progress` drives a bar's width and `currentPage` is printed under
 * every tile — a negative page or 340% would render, not throw.
 */
export function clampPosition(
  currentPage: number,
  pageCount: number | undefined,
): { currentPage: number; progress: number } {
  const lastPage = pageCount === undefined ? PAGE_COUNT_MAX : Math.max(1, pageCount);
  const page = Math.round(clamp(currentPage, 1, lastPage));

  // Derived rather than taken from the client: two numbers that can disagree
  // are two numbers that eventually will.
  const progress = pageCount === undefined ? 0 : clamp(page / lastPage, 0, 1);

  return { currentPage: page, progress };
}

export type ProgressInput = {
  documentId: Id<'documents'>;
  currentPage: number;
  /** Sent the first time the reader opens the file, once a renderer can count. */
  pageCount?: number;
  isFinished?: boolean;
  /**
   * Sent only when the reader changed it, not on every position write. Absent
   * leaves whatever is stored alone, which is what an ordinary page turn means.
   */
  readingMode?: ReadingMode;
  /**
   * The device's clock when the reader was on this page.
   *
   * Position is the write most likely to arrive late — it is the one a reader
   * makes hundreds of times, often with no connection, and the one a queue
   * therefore delivers in a burst hours afterwards. Without this the phone that
   * spent the day in a bag wins, because it arrives last.
   */
  clientUpdatedAt?: number;
};

export async function recordProgress(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  input: ProgressInput,
): Promise<void> {
  const doc = await requireDocument(ctx, owner, input.documentId);

  // Dropped rather than refused. The client asked for a position that has since
  // been overtaken; there is nothing for it to retry and nothing gone wrong.
  if (isStale(doc.clientUpdatedAt, input.clientUpdatedAt)) {
    return;
  }

  const pageCount =
    input.pageCount === undefined
      ? doc.pageCount
      : Math.round(clamp(input.pageCount, 1, PAGE_COUNT_MAX));

  const { currentPage, progress } = clampPosition(input.currentPage, pageCount);

  await ctx.db.patch('documents', doc._id, {
    ...(pageCount === undefined ? {} : { pageCount }),
    currentPage,
    progress,
    isFinished: input.isFinished ?? doc.isFinished,
    // Spread rather than assigned: an explicit `undefined` in a patch deletes
    // the field, and a page turn must not clear a mode the reader chose.
    ...(input.readingMode === undefined ? {} : { readingMode: input.readingMode }),
    ...clientClock(input.clientUpdatedAt),
    lastOpenedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

/* ── the reconcile ──────────────────────────────────────────────────── */

/**
 * Everything the account owns, a page at a time, oldest change first.
 *
 * This is what a device reads when it comes back from being offline, and it
 * exists because none of the reads beside it can answer the question. `home`
 * returns six rails of twelve, `list` is ordered for a screen rather than for a
 * diff, and `byIds` caps at two hundred ids the caller has to already know. A
 * device rebuilding its own copy of a library needs all of it, in an order it
 * can resume from.
 *
 * Ordered by `updatedAt` rather than by creation, because a reconcile that is
 * interrupted halfway has to be able to continue — and because the client stores
 * the cursor and pages the rest of it later.
 *
 * **Deletions are found by their absence.** There are no tombstones in this
 * schema, deliberately: a device holds the ids it knows about, pages this, and
 * treats anything it holds that the account did not return as deleted
 * elsewhere. That costs a full read per reconcile and needs no second table
 * whose rows have to be expired by a cron. It is the right trade for a personal
 * library and the wrong one for a shared one, which is a line worth knowing
 * before this ever becomes the latter.
 */
export async function snapshot(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
  paginationOpts: PaginationOptions,
): Promise<PaginationResult<PublicDocument>> {
  const page = await ctx.db
    .query('documents')
    .withIndex('by_owner_and_updated', (q) => q.eq('ownerId', ownerId))
    .paginate(paginationOpts);

  return { ...page, page: page.page.map(toPublicDocument) };
}

/** Every mark in the account. The bookmark half of the same reconcile. */
export const ownedBookmarkValidator = v.object({
  documentId: v.id('documents'),
  page: v.number(),
  label: v.union(v.string(), v.null()),
  createdAt: v.number(),
});

export type OwnedBookmark = {
  documentId: Id<'documents'>;
  page: number;
  label: string | null;
  createdAt: number;
};

export async function allBookmarks(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
  paginationOpts: PaginationOptions,
): Promise<PaginationResult<OwnedBookmark>> {
  const page = await ctx.db
    .query('documentBookmarks')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .paginate(paginationOpts);

  return {
    ...page,
    page: page.page.map((row) => ({
      documentId: row.documentId,
      page: row.page,
      label: row.label ?? null,
      createdAt: row.createdAt,
    })),
  };
}

/* ── bookmarks ──────────────────────────────────────────────────────── */

/** The wire shape a document's bookmarks are returned in. */
export const bookmarkValidator = v.object({
  id: v.id('documentBookmarks'),
  page: v.number(),
  label: v.union(v.string(), v.null()),
  createdAt: v.number(),
});

export type PublicBookmark = {
  id: Id<'documentBookmarks'>;
  page: number;
  label: string | null;
  createdAt: number;
};

/**
 * Marks a page, or does nothing if it is already marked.
 *
 * Idempotent on purpose. The reader's control is a toggle over a page it may
 * arrive at twice, and the alternative — a second row for the same page — is a
 * list with duplicates in it.
 */
export async function addBookmark(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  input: { documentId: Id<'documents'>; page: number; label?: string },
): Promise<void> {
  const doc = await requireDocument(ctx, owner, input.documentId);

  // Clamped against the document, like every other page number that crosses
  // this boundary. A bookmark on page 99999 of a 499-page book is a row that
  // renders and can never be reached.
  const lastPage = doc.pageCount === undefined ? PAGE_COUNT_MAX : Math.max(1, doc.pageCount);
  const page = Math.round(clamp(input.page, 1, lastPage));
  const label = cleanOptionalText(input.label, BOOKMARK_LABEL_MAX, 'A bookmark name');

  const existing = await ctx.db
    .query('documentBookmarks')
    .withIndex('by_document_and_page', (q) => q.eq('documentId', doc._id).eq('page', page))
    .unique();
  if (existing !== null) {
    // Re-marking a marked page renames it rather than duplicating it.
    if (label !== undefined) {
      await ctx.db.patch('documentBookmarks', existing._id, { label });
    }
    return;
  }

  const count = (
    await ctx.db
      .query('documentBookmarks')
      .withIndex('by_document', (q) => q.eq('documentId', doc._id))
      .take(BOOKMARKS_PER_DOCUMENT)
  ).length;
  if (count >= BOOKMARKS_PER_DOCUMENT) {
    invalid(`A document can hold ${BOOKMARKS_PER_DOCUMENT} bookmarks.`);
  }

  await ctx.db.insert('documentBookmarks', {
    ownerId: owner._id,
    documentId: doc._id,
    page,
    ...(label === undefined ? {} : { label }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

/** Unmarks a page. Silent when it was not marked — the toggle asked, not told. */
export async function removeBookmark(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  documentId: Id<'documents'>,
  page: number,
): Promise<void> {
  const doc = await requireDocument(ctx, owner, documentId);
  const existing = await ctx.db
    .query('documentBookmarks')
    .withIndex('by_document_and_page', (q) =>
      q.eq('documentId', doc._id).eq('page', Math.round(page)),
    )
    .unique();
  if (existing !== null) {
    await ctx.db.delete('documentBookmarks', existing._id);
  }
}

/**
 * Names a bookmark, or takes its name away.
 *
 * `label` has been in the schema and honoured by `addBookmark` since bookmarks
 * landed, and nothing ever sent one — the reader's only control is a toggle,
 * which has no name to give — so every row rendered as `Page 142` however
 * deliberately somebody had stopped there. This is what the list's long press
 * calls.
 *
 * An empty name clears the field rather than storing a blank one, which is what
 * a reader clearing the box and saving means. It never *creates* a bookmark —
 * naming one that does not exist would be a second, quieter way of making one.
 *
 * **Silent when the page is not marked, rather than refused.** It used to throw
 * `INVALID`, which was right when the only caller was somebody holding a row in
 * a list. It is wrong now that a rename can be queued: a reader who names a
 * bookmark and then removes it before the phone finds a signal would leave a
 * terminal failure in their outbox for an intention they had already changed
 * their mind about.
 */
export async function renameBookmark(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  documentId: Id<'documents'>,
  page: number,
  label: string,
  clientUpdatedAt: number | undefined,
): Promise<void> {
  const doc = await requireDocument(ctx, owner, documentId);
  const existing = await ctx.db
    .query('documentBookmarks')
    .withIndex('by_document_and_page', (q) =>
      q.eq('documentId', doc._id).eq('page', Math.round(page)),
    )
    .unique();
  if (existing === null || isStale(existing.clientUpdatedAt, clientUpdatedAt)) {
    return;
  }
  await ctx.db.patch('documentBookmarks', existing._id, {
    // Explicit `undefined` deletes the field, which is the intent here and one
    // of the few places in this file that is true.
    label: cleanOptionalText(label, BOOKMARK_LABEL_MAX, 'A bookmark name'),
    ...clientClock(clientUpdatedAt),
    updatedAt: Date.now(),
  });
}

/** The cascade, called from `removeDocument`. */
async function deleteBookmarks(ctx: MutationCtx, documentId: Id<'documents'>): Promise<void> {
  const rows = await ctx.db
    .query('documentBookmarks')
    .withIndex('by_document', (q) => q.eq('documentId', documentId))
    .take(BOOKMARKS_PER_DOCUMENT);
  for (const row of rows) {
    await ctx.db.delete('documentBookmarks', row._id);
  }
}

export async function setFavorite(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  documentId: Id<'documents'>,
  isFavorite: boolean,
  clientUpdatedAt: number | undefined,
): Promise<void> {
  const doc = await requireDocument(ctx, owner, documentId);
  if (isStale(doc.clientUpdatedAt, clientUpdatedAt)) {
    return;
  }
  await ctx.db.patch('documents', doc._id, {
    isFavorite,
    ...clientClock(clientUpdatedAt),
    updatedAt: Date.now(),
  });
}

export async function rename(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  documentId: Id<'documents'>,
  title: string,
  author: string | undefined,
  clientUpdatedAt: number | undefined,
): Promise<void> {
  const doc = await requireDocument(ctx, owner, documentId);
  if (isStale(doc.clientUpdatedAt, clientUpdatedAt)) {
    return;
  }
  await ctx.db.patch('documents', doc._id, {
    title: cleanText(title, TITLE_MAX, 'Title'),
    // `null` from the client means "clear it"; Convex spells that `undefined`
    // in a patch, which is the one place an explicit `undefined` is wanted.
    author: cleanOptionalText(author, AUTHOR_MAX, 'Author'),
    ...clientClock(clientUpdatedAt),
    updatedAt: Date.now(),
  });
}

/* ── cloud copy ─────────────────────────────────────────────────────── */

/**
 * Links an uploaded blob to a document, after checking what actually arrived.
 *
 * This is the security boundary of the upload flow, and the reason it is three
 * requests rather than one. `generateUploadUrl` hands the client a URL, the
 * client POSTs straight to storage, and **nothing in that POST is under our
 * control** — not the size, not the content type, not whether it is a PDF at
 * all. A caller could upload a gigabyte of anything and hand back the id.
 *
 * So the key is recomputed from ids the server holds, the object's own size,
 * type and digest are read back out of R2's metadata, and both are checked
 * here. Anything that fails is deleted rather than orphaned: a rejected upload
 * that stays in the bucket is billed storage the reader cannot see or remove.
 */
/** The object keys for a document. Derived server-side, never an argument. */
export function pdfKey(ownerId: Id<'users'>, documentId: Id<'documents'>): string {
  return `${ownerId}/${documentId}.pdf`;
}

export function coverKey(ownerId: Id<'users'>, documentId: Id<'documents'>): string {
  return `${ownerId}/${documentId}.cover.jpg`;
}

/**
 * Where a document's extracted text sits.
 *
 * The third key shape, and the one that replaced a table. `.json` rather than
 * `.json.gz`: the payload compresses to about a quarter of its size, but every
 * available way of writing it compressed puts the object somewhere the sweep
 * cannot see it — `r2.store` takes no content-encoding, and going round it to
 * the raw S3 client writes an object the component's metadata table has never
 * heard of. An object nothing can enumerate is an object nothing can collect,
 * which is a worse bill than an uncompressed one. Ten gigabytes free still
 * holds something like eight thousand books.
 */
export function textKey(ownerId: Id<'users'>, documentId: Id<'documents'>): string {
  return `${ownerId}/${documentId}.text.json`;
}

/**
 * The prefix for content shared between accounts.
 *
 * Deliberately not `<ownerId>/…`: a shared object has no one owner, and giving
 * it a name that says otherwise would make the sweep's owner check meaningless.
 * `keyParts` returns `null` for these, which is the safe default — the sweep
 * asks `contentBlobs` about them by key instead.
 */
export const BLOB_PREFIX = 'blobs/';

/** Whether a key names shared content rather than one document's own object. */
export function isBlobKey(key: string): boolean {
  return key.startsWith(BLOB_PREFIX);
}

/**
 * The document id a key claims to belong to, or `null`.
 *
 * A hint and never an answer. Both key shapes are `<ownerId>/<documentId>` plus
 * a suffix, so the id is recovered by taking the shape apart — and then whatever
 * comes out is put back through `pdfKey`/`coverKey` and compared for exact
 * equality. Every caller does that; none of them trusts this on its own.
 *
 * It lives beside the two functions that mint the keys, because a parser that
 * drifts from its printer is a parser that eventually disagrees with it.
 */
export function keyParts(key: string): { ownerId: string; documentId: string } | null {
  const slash = key.indexOf('/');
  if (slash <= 0) {
    return null;
  }
  const ownerId = key.slice(0, slash);
  const rest = key.slice(slash + 1);
  // `.text.json` is tested first on purpose. It has no overlap with the other
  // two today, but the chain is an ordered list of endings and the habit of
  // putting the longest first is what stops the next suffix from being eaten by
  // a shorter one that happens to be its tail.
  const suffix = rest.endsWith('.text.json')
    ? '.text.json'
    : rest.endsWith('.cover.jpg')
      ? '.cover.jpg'
      : rest.endsWith('.pdf')
        ? '.pdf'
        : null;
  if (suffix === null) {
    return null;
  }
  const documentId = rest.slice(0, -suffix.length);
  return documentId.length === 0 ? null : { ownerId, documentId };
}

/** Just the document half, for the callers that only bind against that. */
export function documentIdOf(key: string): string | null {
  return keyParts(key)?.documentId ?? null;
}

export async function attachUpload(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  input: {
    documentId: Id<'documents'>;
    storageKey: string;
    coverStorageKey?: string;
    pageCount?: number;
  },
): Promise<void> {
  // The keys are recomputed rather than trusted. A caller who sent somebody
  // else's key would otherwise attach their object to their own row.
  const expectedPdf = pdfKey(owner._id, input.documentId);
  const expectedCover = coverKey(owner._id, input.documentId);

  if (input.storageKey !== expectedPdf) {
    invalid('That upload does not belong to this document.');
  }
  if (input.coverStorageKey !== undefined && input.coverStorageKey !== expectedCover) {
    invalid('That cover does not belong to this document.');
  }

  let doc: Doc<'documents'>;
  try {
    doc = await requireDocument(ctx, owner, input.documentId);
  } catch (error) {
    // The document went away between the upload starting and finishing. The
    // object has nothing to belong to, so it does not get to stay.
    await discard(ctx, input.storageKey, input.coverStorageKey);
    throw error;
  }

  const pdf = await r2.getMetadata(ctx, input.storageKey);
  if (pdf === null) {
    invalid('That upload is no longer available.');
  }
  if (pdf.size !== undefined && pdf.size > CLOUD_BYTE_MAX) {
    await discard(ctx, input.storageKey, input.coverStorageKey);
    invalid(`Documents over ${Math.round(CLOUD_BYTE_MAX / 1024 / 1024)} MB cannot be synced.`);
  }
  if (pdf.contentType !== 'application/pdf') {
    await discard(ctx, input.storageKey, input.coverStorageKey);
    invalid('That upload is not a PDF.');
  }

  let coverStorageKey = input.coverStorageKey;
  if (coverStorageKey !== undefined) {
    const cover = await r2.getMetadata(ctx, coverStorageKey);
    // A bad cover is not worth failing the document over — it is decoration,
    // and the tinted fallback already handles its absence. Drop it and keep
    // the PDF.
    if (
      cover === null ||
      (cover.size !== undefined && cover.size > COVER_BYTE_MAX) ||
      cover.contentType?.startsWith('image/') !== true
    ) {
      if (cover !== null) {
        await r2.deleteObject(ctx, coverStorageKey);
      }
      coverStorageKey = undefined;
    }
  }

  const pageCount =
    input.pageCount === undefined
      ? undefined
      : Math.round(clamp(input.pageCount, 1, PAGE_COUNT_MAX));

  /**
   * Whether anyone has already stored these exact bytes.
   *
   * Asked **after** the upload, never before it, and asked on a digest R2
   * computed rather than anything the caller said. That ordering is the whole
   * of the privacy argument: there is no request in this system that answers
   * "does someone have this file", because by the time the question is asked
   * the client has already done everything it was going to do. R2 charges
   * nothing for ingress or egress, so the duplicate upload that buys that
   * silence costs money nowhere.
   *
   * On a hit the document points at the object that is already there and the
   * one just uploaded is dropped; the count goes up, and — the expensive part —
   * a text object somebody has already extracted is inherited whole, so pdf.js
   * never runs over those pages a second time.
   */
  const twin = pdf.sha256 === undefined ? null : await Blobs.byHash(ctx, pdf.sha256);

  // Whatever this document was pointing at before is let go first. A reader
  // replacing a synced file arrives here with a row that already has a blob on
  // it, and counting the new reference without releasing the old one would
  // leave the previous content pinned in the bucket for good.
  if (doc.blobId !== undefined && doc.blobId !== twin?._id) {
    await Blobs.release(ctx, doc.blobId);
  }

  let storageKey = input.storageKey;
  let blobId: Id<'contentBlobs'> | undefined;
  let inherited: Partial<Doc<'documents'>> = {};
  let needsExtraction = true;

  if (twin !== null) {
    const { patch: fromBlob, needsExtraction: again } = Blobs.inherit(twin);
    // Not retained when the document was already this blob's reference — a
    // re-upload of bytes it already had must not count itself twice.
    if (doc.blobId !== twin._id) {
      await Blobs.retain(ctx, twin._id);
    }
    storageKey = twin.storageKey;
    blobId = twin._id;
    inherited = fromBlob;
    needsExtraction = again;

    // The copy this caller just uploaded, now that nothing points at it. Best
    // effort: if it fails the nightly sweep collects it, because a key of the
    // shape `<owner>/<doc>.pdf` whose document no longer names it is exactly
    // what that sweep is looking for.
    if (input.storageKey !== storageKey) {
      await r2.deleteObject(ctx, input.storageKey).catch(() => undefined);
    }
  } else if (pdf.sha256 !== undefined) {
    // Nobody has these bytes yet, so this upload becomes the one everybody
    // else will point at. The object stays exactly where the client put it —
    // copying it to a canonical name would mean an S3 call from inside a
    // mutation, and what an object is called matters far less than how many
    // documents need it.
    blobId = await Blobs.create(ctx, {
      contentHash: pdf.sha256,
      storageKey: input.storageKey,
      byteSize: pdf.size ?? doc.byteSize,
      ...(pageCount === undefined ? {} : { pageCount }),
    });
  }

  const patch = {
    // What the blob already knows, first — so the device's own page count wins
    // over it below, the same way it wins over the extractor's in `finalize`.
    ...inherited,
    storageKey,
    ...(coverStorageKey === undefined ? {} : { coverStorageKey }),
    uploadedAt: Date.now(),
    // R2's own digest of the object it holds. Taking one from the client would
    // be recording a claim, not a checksum.
    ...(pdf.sha256 === undefined ? {} : { contentHash: pdf.sha256 }),
    ...(pageCount === undefined ? {} : { pageCount }),
    // The stored size is now a measured fact rather than what the picker said.
    ...(pdf.size === undefined ? {} : { byteSize: pdf.size }),
    ...(blobId === undefined ? {} : { blobId }),
    updatedAt: Date.now(),
  };

  // Before the patch, so the counters see the row as it was. This is the
  // transition from local-only to synced, which moves two of the four numbers.
  await Usage.changed(ctx, doc, patch);
  await ctx.db.patch('documents', doc._id, patch);

  // The first moment the server can see this file, so it is the moment its text
  // becomes extractable — unless somebody has already extracted these exact
  // bytes, in which case the answer was inherited above and a second run of
  // pdf.js would spend a Node action's compute to reach it again. Never awaited
  // for its result and never able to fail the upload — see `queueExtraction`.
  if (needsExtraction) {
    await queueExtraction(ctx, doc._id, owner._id);
  }
}

/** Deletes objects that were rejected, so a refusal does not become storage. */
async function discard(
  ctx: MutationCtx,
  storageKey: string,
  coverStorageKey: string | undefined,
): Promise<void> {
  await r2.deleteObject(ctx, storageKey).catch(() => undefined);
  if (coverStorageKey !== undefined) {
    await r2.deleteObject(ctx, coverStorageKey).catch(() => undefined);
  }
}

/**
 * Drops the cloud copy. The local file is untouched — the reader asked to stop
 * syncing it, not to lose it.
 */
export async function detachUpload(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  documentId: Id<'documents'>,
): Promise<void> {
  const doc = await requireDocument(ctx, owner, documentId);

  await releaseContent(ctx, doc);
  await Processing.deleteJob(ctx, doc._id);
  // Whatever page rows this document has left from before its text became an
  // object. Almost always none, and drained in seconds rather than over nights
  // when there are some — see `dropPageText`.
  await dropPageText(ctx, doc._id);

  const patch = {
    storageKey: undefined,
    coverStorageKey: undefined,
    uploadedAt: undefined,
    contentHash: undefined,
    textStatus: undefined,
    textStorageKey: undefined,
    textBytes: undefined,
    blobId: undefined,
    updatedAt: Date.now(),
  };
  // Synced to local-only: two of the four numbers move, in opposite directions.
  await Usage.changed(ctx, doc, patch);
  await ctx.db.patch('documents', doc._id, patch);
}

/**
 * Lets go of everything a document's cloud copy consists of.
 *
 * The one rule that matters: **an object is deleted only when nothing else
 * needs it.** A document pointing at shared content releases its reference and
 * leaves the bytes alone — the nightly pass deletes them once the count reaches
 * zero, which is also why the delete does not happen here. An R2 call that
 * failed inside this transaction would roll back a delete the reader has
 * already watched succeed, and a reader whose document came back is a reader
 * who no longer trusts the button.
 *
 * A document that owns its bytes outright — everything uploaded before sharing
 * existed, and anything R2 gave no digest for — deletes them directly, exactly
 * as it always did.
 */
async function releaseContent(ctx: MutationCtx, doc: Doc<'documents'>): Promise<void> {
  if (doc.blobId !== undefined) {
    await Blobs.release(ctx, doc.blobId);
  } else {
    if (doc.storageKey !== undefined) {
      await r2.deleteObject(ctx, doc.storageKey);
    }
    // The extracted text goes with the copy it was read from. Keeping it would
    // leave the reader's document content in an account that has just asked to
    // stop holding it, answering for a file nothing could re-derive it from.
    if (doc.textStorageKey !== undefined) {
      await r2.deleteObject(ctx, doc.textStorageKey).catch(() => undefined);
    }
  }

  // The cover is this document's own either way. It is a rendering of a page
  // rather than the page, it is a few hundred kilobytes, and sharing one would
  // buy almost nothing for a second thing to count.
  if (doc.coverStorageKey !== undefined) {
    await r2.deleteObject(ctx, doc.coverStorageKey).catch(() => undefined);
  }
}

/**
 * Clears a document's legacy page rows, and keeps clearing them.
 *
 * **This is what "deleting a PDF removes all of its pages" means now.** A
 * document extracted since page text became an R2 object has no rows at all, so
 * the first pass finds nothing and this costs one bounded index read. What is
 * left is everything extracted before, and deleting a shelf of long books used
 * to leave their text in the account for *days* — 400 pages inline and the rest
 * to a queue that drained four documents a night.
 *
 * So the rest is chained rather than queued: up to `PAGE_DRAIN_PASSES` scheduled
 * follow-ups, a second apart, which is 4,800 pages and past the page ceiling
 * twice over. The queue row is still written, because a chain that is
 * interrupted — a deploy, a failure inside a pass — has to be finishable by
 * something, and by then there is no document row left to recognise the
 * leftovers by.
 */
async function dropPageText(ctx: MutationCtx, documentId: Id<'documents'>): Promise<void> {
  if ((await Processing.deletePages(ctx, documentId, PAGE_DELETE_BUDGET)) < PAGE_DELETE_BUDGET) {
    return;
  }
  await Processing.queuePagePrune(ctx, documentId);
  await ctx.scheduler.runAfter(1_000, internal.maintenance.drainDocumentPages, {
    documentId,
    passesLeft: PAGE_DRAIN_PASSES,
  });
}

/**
 * Deletes a document and every row that pointed at it.
 *
 * Membership rows outlive their document otherwise, and each one would keep a
 * collection's count one too high forever. The local file is the client's to
 * remove — the server has no way to reach it.
 */
export async function removeDocument(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  documentId: Id<'documents'>,
): Promise<void> {
  const doc = await requireDocument(ctx, owner, documentId);

  const memberships = await ctx.db
    .query('collectionDocuments')
    .withIndex('by_document', (q) => q.eq('documentId', doc._id))
    .collect();

  // `.collect()` rather than `.take()`, and this is the exception the rule
  // allows: the bound is how many collections the reader has, and a mutation
  // that deletes only some of the rows would corrupt the counts it is here to
  // keep correct.
  for (const membership of memberships) {
    const collection = await ctx.db.get('collections', membership.collectionId);
    if (collection !== null && collection.ownerId === owner._id) {
      await ctx.db.patch('collections', collection._id, {
        documentCount: Math.max(0, collection.documentCount - 1),
        updatedAt: Date.now(),
      });
    }
    await ctx.db.delete('collectionDocuments', membership._id);
  }

  // The outline, the job and the page text all point at this document and
  // nothing else. Left behind they would be rows no screen can reach and no
  // query would ever name — page text especially, which is the reader's own
  // document content.
  await Processing.deleteOutline(ctx, doc._id);
  await Processing.deleteJob(ctx, doc._id);
  // Both bounded by the same constants that bound how many can exist, so one
  // pass is always enough. `Annotations.deleteAll` walks `by_document`, so it
  // takes an annotator's notes with it as well as the owner's — which is why
  // `documentAnnotations.ownerId` is still the *document's* owner even now that
  // a second person can write one.
  await deleteBookmarks(ctx, doc._id);
  await Annotations.deleteAll(ctx, doc._id);
  // Every grant on this document, and the events that named them. Deleted
  // rather than revoked: revoking describes a document that still exists, and
  // in a moment this one will not — a revoked row would sit in each recipient's
  // inbox forever naming nothing.
  await Sharing.removeForDocument(ctx, doc._id);
  // Bounded and chained, and this is the case where the queue earns its keep:
  // in a moment there will be no document row at all, so anything left behind
  // could never be recognised as belonging to a document that used to exist.
  await dropPageText(ctx, doc._id);

  // The objects go with the row, unless somebody else is using them. A deleted
  // document that keeps its storage is billed storage nothing points at and
  // nobody can find; a delete that takes shared bytes with it is somebody
  // else's library gone.
  await releaseContent(ctx, doc);

  await Usage.removed(ctx, doc);
  await ctx.db.delete('documents', doc._id);
}
