import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { PaginationOptions, PaginationResult } from 'convex/server';

import { r2 } from '../r2';

import type { MutationCtx, QueryCtx } from '../_generated/server';
import { assertOwner } from './auth';
import * as Processing from './processing';
import { queueExtraction } from '../workflows/document';
import {
  AUTHOR_MAX,
  BOOKMARKS_PER_DOCUMENT,
  BOOKMARK_LABEL_MAX,
  BYTE_SIZE_MAX,
  CLOUD_BYTE_MAX,
  COVER_BYTE_MAX,
  IDS_MAX,
  MIME_TYPE_MAX,
  PAGE_DELETE_BUDGET,
  PAGE_COUNT_MAX,
  RAIL_LIMIT,
  SEARCH_LIMIT,
  SEARCH_TERM_MAX,
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
    // `fingerprint` and `processingError` are deliberately absent. The first is
    // a fact about a file on somebody's phone and the second is a code the
    // client already has a sentence for; neither is a thing a rail needs.
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

/** The orderings the all-library screen offers, each backed by its own index. */
export const sortValidator = v.union(
  v.literal('recent'),
  v.literal('opened'),
  v.literal('title'),
);
export type LibrarySort = 'recent' | 'opened' | 'title';

/**
 * The filters, each of which picks the index the page is read from.
 *
 * A filter and a sort cannot both choose the index, so a filter other than
 * `all` fixes the order to most-recently-opened and the sort control is hidden
 * — see `src/features/library/all/`. The alternative is a `.filter()` over a
 * sorted index, which returns pages of wildly uneven size and reads the whole
 * table to fill them.
 *
 * `on this device` is not here. It is answered by the filesystem, and the
 * client intersects it with what these return.
 */
export const filterValidator = v.union(
  v.literal('all'),
  v.literal('favorites'),
  v.literal('finished'),
);
export type LibraryFilter = 'all' | 'favorites' | 'finished';

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

export async function favorites(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
): Promise<Doc<'documents'>[]> {
  return await ctx.db
    .query('documents')
    .withIndex('by_owner_and_favorite', (q) => q.eq('ownerId', ownerId).eq('isFavorite', true))
    .order('desc')
    .take(RAIL_LIMIT);
}

/** The other half of `by_owner_and_finished`. */
export async function finished(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
): Promise<Doc<'documents'>[]> {
  return await ctx.db
    .query('documents')
    .withIndex('by_owner_and_finished', (q) => q.eq('ownerId', ownerId).eq('isFinished', true))
    .order('desc')
    .take(RAIL_LIMIT);
}

/**
 * Metadata for a set of ids the device found on its own disk.
 *
 * Ids the caller does not own are dropped silently rather than thrown on. The
 * reasoning is `assertOwner`'s: a caller who gets `FORBIDDEN` for one id and
 * `null` for another has learned which ids exist. Returning the same thing for
 * both teaches nothing.
 *
 * Order follows the caller's array, because the device already knows which of
 * its files it touched most recently and the server does not.
 */
export async function byIds(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
  ids: Id<'documents'>[],
): Promise<Doc<'documents'>[]> {
  if (ids.length > IDS_MAX) {
    invalid(`Cannot look up more than ${IDS_MAX} documents at once.`);
  }

  // De-duplicated so a repeated id cannot multiply the read cost.
  const unique = [...new Set(ids)];
  const found = await Promise.all(unique.map((id) => ctx.db.get('documents', id)));

  return found.filter((doc): doc is Doc<'documents'> => doc !== null && doc.ownerId === ownerId);
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

/** Documents in one collection, newest membership first. */
export async function documentsInCollection(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
  collectionId: Id<'collections'>,
  limit: number,
): Promise<Doc<'documents'>[]> {
  const members = await ctx.db
    .query('collectionDocuments')
    .withIndex('by_collection', (q) => q.eq('collectionId', collectionId))
    .order('desc')
    .take(limit);

  const docs = await Promise.all(members.map((m) => ctx.db.get('documents', m.documentId)));

  // The ownership check is on the documents rather than the membership rows:
  // both carry `ownerId`, and the document is the thing being returned.
  return docs.filter((doc): doc is Doc<'documents'> => doc !== null && doc.ownerId === ownerId);
}

/**
 * Title search.
 *
 * `ownerId` as a filter on the search index is load-bearing — a search index
 * has no implicit scope, so without it one reader's query would range over
 * every library in the deployment.
 */
export async function searchTitles(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
  term: string,
): Promise<Doc<'documents'>[]> {
  const trimmed = term.trim();
  if (trimmed === '') {
    return [];
  }
  if (trimmed.length > SEARCH_TERM_MAX) {
    invalid(`Search terms are limited to ${SEARCH_TERM_MAX} characters.`);
  }

  return await ctx.db
    .query('documents')
    .withSearchIndex('search_title', (q) => q.search('title', trimmed).eq('ownerId', ownerId))
    .take(SEARCH_LIMIT);
}

/**
 * One page of the all-library screen.
 *
 * The filter picks the index; the sort only applies when there is no filter,
 * for the reason on `filterValidator`. Every branch is an index scan — nothing
 * here reads a row it does not return.
 */
export async function listPage(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
  paginationOpts: PaginationOptions,
  sort: LibrarySort,
  filter: LibraryFilter,
): Promise<PaginationResult<Doc<'documents'>>> {
  if (filter === 'favorites') {
    return await ctx.db
      .query('documents')
      .withIndex('by_owner_and_favorite', (q) => q.eq('ownerId', ownerId).eq('isFavorite', true))
      .order('desc')
      .paginate(paginationOpts);
  }

  if (filter === 'finished') {
    return await ctx.db
      .query('documents')
      .withIndex('by_owner_and_finished', (q) => q.eq('ownerId', ownerId).eq('isFinished', true))
      .order('desc')
      .paginate(paginationOpts);
  }

  if (sort === 'opened') {
    return await ctx.db
      .query('documents')
      .withIndex('by_owner_and_opened', (q) => q.eq('ownerId', ownerId))
      .order('desc')
      .paginate(paginationOpts);
  }

  if (sort === 'title') {
    // Ascending, because A-Z is what "sort by title" means to a reader.
    return await ctx.db
      .query('documents')
      .withIndex('by_owner_and_title', (q) => q.eq('ownerId', ownerId))
      .order('asc')
      .paginate(paginationOpts);
  }

  return await ctx.db
    .query('documents')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .order('desc')
    .paginate(paginationOpts);
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
};

/**
 * Records an imported PDF and returns the row.
 *
 * The id this mints becomes the local filename, so the row exists before the
 * file does. `src/features/library/local/import.ts` deletes it again if the
 * copy into the library directory fails — a row with no file would otherwise
 * read as permanently "not on this device".
 */
export async function importDocument(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  input: ImportInput,
): Promise<Id<'documents'>> {
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

  return await ctx.db.insert('documents', {
    ownerId: owner._id,
    title,
    // Spread rather than assigned: Convex reads an explicit `undefined` in a
    // patch as "delete this field", and keeping one shape for insert and patch
    // means the same habit everywhere.
    ...(author === undefined ? {} : { author }),
    ...(originalFileName === undefined ? {} : { originalFileName }),
    ...(mimeType === undefined ? {} : { mimeType }),
    ...(pageCount === undefined ? {} : { pageCount }),
    ...(input.fingerprint === undefined ? {} : { fingerprint: cleanFingerprint(input.fingerprint) }),
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
  });
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
 * The caller's document with this fingerprint, if they already have one.
 *
 * Asked once per import, against an index rather than by scanning the library.
 * The answer is a whole document rather than a boolean because the import
 * screen offers to open it, which needs its title and its id.
 */
export async function findByFingerprint(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
  fingerprint: string,
): Promise<Doc<'documents'> | null> {
  return await ctx.db
    .query('documents')
    .withIndex('by_owner_and_fingerprint', (q) =>
      q.eq('ownerId', ownerId).eq('fingerprint', fingerprint),
    )
    .first();
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
};

export async function recordProgress(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  input: ProgressInput,
): Promise<void> {
  const doc = await requireDocument(ctx, owner, input.documentId);

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
    lastOpenedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

/* ── bookmarks ──────────────────────────────────────────────────────── */

/** The wire shape, beside the function that produces it, as everywhere else. */
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

function toPublicBookmark(row: Doc<'documentBookmarks'>): PublicBookmark {
  return {
    id: row._id,
    page: row.page,
    label: row.label ?? null,
    createdAt: row.createdAt,
    // `ownerId` and `documentId` are deliberately absent: the caller asked for
    // one document's bookmarks and already knows both.
  };
}

/**
 * Every page marked in one document, oldest first.
 *
 * Ownership is checked on the *document*, not on the bookmark rows, so a caller
 * probing ids gets `FORBIDDEN` before a single row is read — the same rule the
 * outline and the page text follow.
 */
export async function bookmarksFor(
  ctx: QueryCtx | MutationCtx,
  owner: Doc<'users'>,
  documentId: Id<'documents'>,
): Promise<PublicBookmark[]> {
  await requireDocument(ctx, owner, documentId);
  const rows = await ctx.db
    .query('documentBookmarks')
    .withIndex('by_document', (q) => q.eq('documentId', documentId))
    .take(BOOKMARKS_PER_DOCUMENT);
  return rows.map(toPublicBookmark);
}

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
): Promise<void> {
  const doc = await requireDocument(ctx, owner, documentId);
  await ctx.db.patch('documents', doc._id, { isFavorite, updatedAt: Date.now() });
}

export async function rename(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  documentId: Id<'documents'>,
  title: string,
  author: string | undefined,
): Promise<void> {
  const doc = await requireDocument(ctx, owner, documentId);
  await ctx.db.patch('documents', doc._id, {
    title: cleanText(title, TITLE_MAX, 'Title'),
    // `null` from the client means "clear it"; Convex spells that `undefined`
    // in a patch, which is the one place an explicit `undefined` is wanted.
    author: cleanOptionalText(author, AUTHOR_MAX, 'Author'),
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
export function documentIdOf(key: string): string | null {
  const slash = key.indexOf('/');
  if (slash === -1) {
    return null;
  }
  const rest = key.slice(slash + 1);
  const suffix = rest.endsWith('.cover.jpg') ? '.cover.jpg' : rest.endsWith('.pdf') ? '.pdf' : null;
  if (suffix === null) {
    return null;
  }
  const id = rest.slice(0, -suffix.length);
  return id.length === 0 ? null : id;
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
      ? doc.pageCount
      : Math.round(clamp(input.pageCount, 1, PAGE_COUNT_MAX));

  await ctx.db.patch('documents', doc._id, {
    storageKey: input.storageKey,
    ...(coverStorageKey === undefined ? {} : { coverStorageKey }),
    uploadedAt: Date.now(),
    // R2's own digest of the object it holds. Taking one from the client would
    // be recording a claim, not a checksum.
    ...(pdf.sha256 === undefined ? {} : { contentHash: pdf.sha256 }),
    ...(pageCount === undefined ? {} : { pageCount }),
    // The stored size is now a measured fact rather than what the picker said.
    ...(pdf.size === undefined ? {} : { byteSize: pdf.size }),
    updatedAt: Date.now(),
  });

  // The first moment the server can see this file, so it is the moment its text
  // becomes extractable. Never awaited for its result and never able to fail
  // the upload — see `queueExtraction`.
  await queueExtraction(ctx, doc._id, owner._id);
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

  if (doc.storageKey !== undefined) {
    await r2.deleteObject(ctx, doc.storageKey);
  }
  if (doc.coverStorageKey !== undefined) {
    await r2.deleteObject(ctx, doc.coverStorageKey);
  }

  // The extracted text goes with the copy it was read from. Keeping it would
  // leave the reader's document content searchable in an account they just
  // asked to stop holding it — and it would be answering for a file nothing
  // could re-derive it from. Bounded, so a very long book is finished by the
  // nightly prune rather than blowing this mutation's read budget — deleting a
  // page reads its text first, and a page holds up to `PAGE_TEXT_MAX`.
  //
  // Hitting the budget means there is more, and the queue is how the nightly
  // job learns that. Nothing else can tell it: an orphaned page is
  // indistinguishable from a live one without the document row to check
  // against, and by then that row may be gone.
  if ((await Processing.deletePages(ctx, doc._id, PAGE_DELETE_BUDGET)) === PAGE_DELETE_BUDGET) {
    await Processing.queuePagePrune(ctx, doc._id);
  }
  await Processing.deleteJob(ctx, doc._id);

  await ctx.db.patch('documents', doc._id, {
    storageKey: undefined,
    coverStorageKey: undefined,
    uploadedAt: undefined,
    contentHash: undefined,
    textStatus: undefined,
    updatedAt: Date.now(),
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
  // Bounded by the same constant that bounds how many can exist, so one pass
  // is always enough.
  await deleteBookmarks(ctx, doc._id);
  // Bounded like the one in `detachUpload`, and queued for the same reason.
  // This is the case where the queue earns its keep: in a moment there will be
  // no document row at all, so anything left behind could never be recognised
  // as belonging to a document that used to exist.
  if ((await Processing.deletePages(ctx, doc._id, PAGE_DELETE_BUDGET)) === PAGE_DELETE_BUDGET) {
    await Processing.queuePagePrune(ctx, doc._id);
  }

  // The objects go with the row. A deleted document that keeps its storage is
  // billed storage nothing points at and nobody can find.
  if (doc.storageKey !== undefined) {
    await r2.deleteObject(ctx, doc.storageKey);
  }
  if (doc.coverStorageKey !== undefined) {
    await r2.deleteObject(ctx, doc.coverStorageKey);
  }

  await ctx.db.delete('documents', doc._id);
}
