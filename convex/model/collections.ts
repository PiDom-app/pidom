import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { assertOwner } from './auth';
import { COLLECTION_NAME_MAX, RAIL_LIMIT, cleanText, invalid } from './limits';

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

export async function create(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  name: string,
): Promise<Id<'collections'>> {
  const now = Date.now();
  return await ctx.db.insert('collections', {
    ownerId: owner._id,
    name: cleanText(name, COLLECTION_NAME_MAX, 'Collection name'),
    documentCount: 0,
    createdAt: now,
    updatedAt: now,
  });
}

export async function rename(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  collectionId: Id<'collections'>,
  name: string,
): Promise<void> {
  const collection = await requireCollection(ctx, owner, collectionId);
  await ctx.db.patch('collections', collection._id, {
    name: cleanText(name, COLLECTION_NAME_MAX, 'Collection name'),
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
 * Which of the caller's collections a document is in. Backs the action sheet.
 *
 * Capped at the number of collections the picker can list, because a tick on a
 * collection the sheet does not render is a tick nobody sees. This is a read
 * path rather than a cascade, so it takes rather than collects.
 */
export async function collectionIdsFor(
  ctx: QueryCtx,
  owner: Doc<'users'>,
  documentId: Id<'documents'>,
): Promise<Id<'collections'>[]> {
  const memberships = await ctx.db
    .query('collectionDocuments')
    .withIndex('by_document', (q) => q.eq('documentId', documentId))
    .take(PICKER_LIMIT);

  return memberships
    .filter((membership) => membership.ownerId === owner._id)
    .map((membership) => membership.collectionId);
}
