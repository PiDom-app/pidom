import type { PaginationOptions, PaginationResult } from 'convex/server';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { assertOwner } from './auth';
import { COLLECTION_NAME_MAX, RAIL_LIMIT, cleanText, invalid } from './limits';
import { clientClock, collectionByOpId, isLocalId, isStale } from './sync';

/** How many collections the picker lists, and so how many ticks it can show. */
const PICKER_LIMIT = RAIL_LIMIT * 4;

/**
 * Collections, and the membership rows that make them.
 *
 * The rule that matters here: **both sides are checked.** Adding a document to
 * a collection is a write that names two ids, and either one could belong to
 * somebody else. Checking only the collection would let a caller pull another
 * reader's document into their own library by id; checking only the document
 * would let them write into somebody else's collection. So both go through
 * `assertOwner`, every time.
 */

/** The caller's collection, or `FORBIDDEN`. */
export async function requireCollection(
  ctx: QueryCtx | MutationCtx,
  owner: Doc<'users'>,
  collectionId: Id<'collections'>,
): Promise<Doc<'collections'>> {
  const collection = await ctx.db.get('collections', collectionId);
  assertOwner(collection, owner);
  return collection;
}

/**
 * A new collection.
 *
 * Idempotent on `clientOpId` for the reason `Annotations.add` is: two
 * collections may legitimately share a name, so there is no natural key, and a
 * queued create whose reply was lost would otherwise produce two folders called
 * Contracts with half the documents in each.
 */
export async function create(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  name: string,
  options: { clientOpId?: string; clientUpdatedAt?: number } = {},
): Promise<Id<'collections'>> {
  if (options.clientOpId !== undefined) {
    if (!isLocalId(options.clientOpId)) {
      invalid('That collection id is not one Pidom writes.');
    }
    const existing = await collectionByOpId(ctx, owner, options.clientOpId);
    if (existing !== null) {
      return existing._id;
    }
  }

  const now = Date.now();
  return await ctx.db.insert('collections', {
    ownerId: owner._id,
    name: cleanText(name, COLLECTION_NAME_MAX, 'Collection name'),
    documentCount: 0,
    ...(options.clientOpId === undefined ? {} : { clientOpId: options.clientOpId }),
    ...clientClock(options.clientUpdatedAt),
    createdAt: now,
    updatedAt: now,
  });
}

export async function rename(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  collectionId: Id<'collections'>,
  name: string,
  clientUpdatedAt: number | undefined,
): Promise<void> {
  const collection = await requireCollection(ctx, owner, collectionId);
  if (isStale(collection.clientUpdatedAt, clientUpdatedAt)) {
    return;
  }
  await ctx.db.patch('collections', collection._id, {
    name: cleanText(name, COLLECTION_NAME_MAX, 'Collection name'),
    ...clientClock(clientUpdatedAt),
    updatedAt: Date.now(),
  });
}

/**
 * Deletes a collection and its membership rows. **Documents are untouched** —
 * a collection is a relationship, and removing the relationship is not
 * removing the thing on both ends of it.
 */
export async function remove(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  collectionId: Id<'collections'>,
): Promise<void> {
  const collection = await requireCollection(ctx, owner, collectionId);

  // `.collect()`, and deliberately: leaving orphaned membership rows behind
  // would put deleted collections back into every document's "add to" sheet.
  // The bound is the size of one collection, which the reader chose.
  const members = await ctx.db
    .query('collectionDocuments')
    .withIndex('by_collection', (q) => q.eq('collectionId', collection._id))
    .collect();

  for (const member of members) {
    await ctx.db.delete('collectionDocuments', member._id);
  }
  await ctx.db.delete('collections', collection._id);
}

export async function addDocument(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  collectionId: Id<'collections'>,
  documentId: Id<'documents'>,
): Promise<void> {
  const collection = await requireCollection(ctx, owner, collectionId);

  const document = await ctx.db.get('documents', documentId);
  assertOwner(document, owner);

  const existing = await ctx.db
    .query('collectionDocuments')
    .withIndex('by_collection_and_document', (q) =>
      q.eq('collectionId', collection._id).eq('documentId', document._id),
    )
    .unique();

  // Idempotent. Tapping "Add to collection" twice on a slow connection should
  // not put the same document in twice, or move the count out of step with the
  // rows it is meant to count.
  if (existing !== null) {
    return;
  }

  await ctx.db.insert('collectionDocuments', {
    ownerId: owner._id,
    collectionId: collection._id,
    documentId: document._id,
    addedAt: Date.now(),
  });
  await ctx.db.patch('collections', collection._id, {
    documentCount: collection.documentCount + 1,
    updatedAt: Date.now(),
  });
}

export async function removeDocument(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  collectionId: Id<'collections'>,
  documentId: Id<'documents'>,
): Promise<void> {
  const collection = await requireCollection(ctx, owner, collectionId);

  const membership = await ctx.db
    .query('collectionDocuments')
    .withIndex('by_collection_and_document', (q) =>
      q.eq('collectionId', collection._id).eq('documentId', documentId),
    )
    .unique();

  if (membership === null) {
    return;
  }

  // The membership row carries `ownerId` of its own, so this is a real check
  // and not a formality — it is the one that would catch a row written before
  // some future bug, rather than trusting the collection alone.
  if (membership.ownerId !== owner._id) {
    invalid('That document is not in this collection.');
  }

  await ctx.db.delete('collectionDocuments', membership._id);
  await ctx.db.patch('collections', collection._id, {
    documentCount: Math.max(0, collection.documentCount - 1),
    updatedAt: Date.now(),
  });
}

/**
 * Every membership row the caller owns, a page at a time.
 *
 * Reads `by_owner`, which is the denormalised `ownerId` finally being used for
 * something other than an ownership check. Paginated because membership is the
 * one table here that grows with the product of two others.
 */
export async function membershipPage(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
  paginationOpts: PaginationOptions,
): Promise<
  PaginationResult<{ collectionId: Id<'collections'>; documentId: Id<'documents'>; addedAt: number }>
> {
  const page = await ctx.db
    .query('collectionDocuments')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .paginate(paginationOpts);

  return {
    ...page,
    page: page.page.map((row) => ({
      collectionId: row.collectionId,
      documentId: row.documentId,
      addedAt: row.addedAt,
    })),
  };
}
