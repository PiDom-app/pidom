import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { PaginationOptions, PaginationResult } from 'convex/server';

import { r2 } from '../r2';

import type { MutationCtx, QueryCtx } from '../_generated/server';
import { assertOwner } from './auth';
import {
  AUTHOR_MAX,
  BYTE_SIZE_MAX,
  CLOUD_BYTE_MAX,
  COVER_BYTE_MAX,
  IDS_MAX,
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
  lastOpenedAt: number | null;
  createdAt: number;
  /** True when a copy exists in the account and any device can fetch it. */
  isSynced: boolean;
  /** True when a rendered first page exists to fetch. */
  hasCover: boolean;
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
    lastOpenedAt: doc.lastOpenedAt ?? null,
    createdAt: doc.createdAt,
    // The storage ids themselves never cross the wire. The client fetches by
    // document id through an authenticated route, so a storage id would be an
    // identifier it has no use for and one more thing that can leak.
    isSynced: doc.storageKey !== undefined,
    hasCover: doc.coverStorageKey !== undefined,
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
  lastOpenedAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  isSynced: v.boolean(),
  hasCover: v.boolean(),
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

  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    invalid('A document must have a size.');
  }
  if (input.byteSize > BYTE_SIZE_MAX) {
    invalid(`Documents are limited to ${Math.round(BYTE_SIZE_MAX / 1024 / 1024)} MB.`);
  }

  const now = Date.now();
  return await ctx.db.insert('documents', {
    ownerId: owner._id,
    title,
    // Spread rather than assigned: Convex reads an explicit `undefined` in a
    // patch as "delete this field", and keeping one shape for insert and patch
    // means the same habit everywhere.
    ...(author === undefined ? {} : { author }),
    byteSize: Math.round(input.byteSize),
    currentPage: 1,
    progress: 0,
    isFinished: false,
    isFavorite: false,
    createdAt: now,
    updatedAt: now,
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
    lastOpenedAt: Date.now(),
    updatedAt: Date.now(),
  });
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

  await ctx.db.patch('documents', doc._id, {
    storageKey: undefined,
    coverStorageKey: undefined,
    uploadedAt: undefined,
    contentHash: undefined,
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
