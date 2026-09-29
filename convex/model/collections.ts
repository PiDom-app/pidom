import type { PaginationOptions, PaginationResult } from 'convex/server';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { assertOwner } from './auth';
import { toPublicDocument, type PublicDocument } from './library';
import { COLLECTION_NAME_MAX, cleanText, invalid } from './limits';
import { clientClock, collectionByOpId, isLocalId, isStale } from './sync';

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
 * Adds a bounded set of documents to one collection in a single transaction.
 *
 * The multi-select toolbar's "Add to collection" is one gesture over many
 * documents; looping `addDocument` client-side would be one round trip and one
 * `editCollection` token per document. This checks the collection once, then
 * each document's ownership and existing membership per id — the same guards
 * `addDocument` runs — and moves the denormalised count **once** at the end by
 * exactly the number of rows it actually inserted, so a re-add of documents
 * already in the collection leaves the count where it was.
 *
 * The array is bounded by `BULK_MAX` at the public boundary. A foreign id
 * anywhere in it fails `assertOwner`, rejecting the whole write.
 */
export async function addDocuments(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  collectionId: Id<'collections'>,
  documentIds: Id<'documents'>[],
): Promise<void> {
  const collection = await requireCollection(ctx, owner, collectionId);

  const now = Date.now();
  let added = 0;
  for (const documentId of documentIds) {
    const document = await ctx.db.get('documents', documentId);
    assertOwner(document, owner);

    const existing = await ctx.db
      .query('collectionDocuments')
      .withIndex('by_collection_and_document', (q) =>
        q.eq('collectionId', collection._id).eq('documentId', document._id),
      )
      .unique();
    if (existing !== null) {
      continue;
    }

    await ctx.db.insert('collectionDocuments', {
      ownerId: owner._id,
      collectionId: collection._id,
      documentId: document._id,
      addedAt: now,
    });
    added += 1;
  }

  if (added > 0) {
    await ctx.db.patch('collections', collection._id, {
      documentCount: collection.documentCount + added,
      updatedAt: now,
    });
  }
}

/**
 * Removes a bounded set of documents from one collection in a single write.
 *
 * The mirror of `addDocuments`: the collection is checked once, each membership
 * row is looked up and owner-checked per id (a row that names a different owner
 * is refused, exactly as `removeDocument` refuses it), and the count is moved
 * once by the number of rows actually deleted. Ids with no membership are
 * skipped rather than refused — removing what is not there is the outcome the
 * caller wanted.
 */
export async function removeDocuments(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  collectionId: Id<'collections'>,
  documentIds: Id<'documents'>[],
): Promise<void> {
  const collection = await requireCollection(ctx, owner, collectionId);

  const now = Date.now();
  let removed = 0;
  for (const documentId of documentIds) {
    const membership = await ctx.db
      .query('collectionDocuments')
      .withIndex('by_collection_and_document', (q) =>
        q.eq('collectionId', collection._id).eq('documentId', documentId),
      )
      .unique();
    if (membership === null) {
      continue;
    }
    if (membership.ownerId !== owner._id) {
      invalid('That document is not in this collection.');
    }
    await ctx.db.delete('collectionDocuments', membership._id);
    removed += 1;
  }

  if (removed > 0) {
    await ctx.db.patch('collections', collection._id, {
      documentCount: Math.max(0, collection.documentCount - removed),
      updatedAt: now,
    });
  }
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
  PaginationResult<{
    collectionId: Id<'collections'>;
    documentId: Id<'documents'>;
    addedAt: number;
  }>
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

/**
 * The documents in one collection, a page at a time, hydrated to the same wire
 * shape the library view reads — so the detail screen renders through the very
 * same grid and list.
 *
 * `by_collection` is `['collectionId', 'addedAt']`, so `.order('desc')` is
 * newest-added first. A membership row can briefly outlive its document: the
 * delete cascade in `Library.remove` clears them, but a page read that races
 * that delete may still see a row whose document is already gone, and those are
 * skipped rather than surfaced as holes. The `ownerId` re-check is defence in
 * depth — the collection is already owner-checked and a row only ever names a
 * document the same owner added, but a page that hydrated somebody else's
 * document would be a data leak, so it is not left to that invariant alone.
 */
export async function documentsPage(
  ctx: QueryCtx,
  owner: Doc<'users'>,
  collectionId: Id<'collections'>,
  paginationOpts: PaginationOptions,
): Promise<PaginationResult<PublicDocument>> {
  await requireCollection(ctx, owner, collectionId);

  const page = await ctx.db
    .query('collectionDocuments')
    .withIndex('by_collection', (q) => q.eq('collectionId', collectionId))
    .order('desc')
    .paginate(paginationOpts);

  const documents = await Promise.all(
    page.page.map((row) => ctx.db.get('documents', row.documentId)),
  );

  return {
    ...page,
    page: documents
      .filter((doc): doc is Doc<'documents'> => doc !== null && doc.ownerId === owner._id)
      .map(toPublicDocument),
  };
}

/**
 * The collections one document is in — the ticks in the add picker.
 *
 * Bounded to the same count the picker's list (`collectionSummaries`) takes to,
 * so the ticks cover exactly the collections the picker can show. The document
 * is owner-checked; the membership rows carry their own `ownerId` and are
 * filtered on it too.
 */
export async function collectionIdsFor(
  ctx: QueryCtx,
  owner: Doc<'users'>,
  documentId: Id<'documents'>,
  limit: number,
): Promise<Id<'collections'>[]> {
  const document = await ctx.db.get('documents', documentId);
  assertOwner(document, owner);

  const rows = await ctx.db
    .query('collectionDocuments')
    .withIndex('by_document', (q) => q.eq('documentId', documentId))
    .take(limit);

  return rows.filter((row) => row.ownerId === owner._id).map((row) => row.collectionId);
}
