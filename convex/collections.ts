import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireUser } from './model/auth';
import * as Collections from './model/collections';
import * as Library from './model/library';
import { limit } from './model/rateLimits';
import { COLLECTION_COVER_LIMIT, RAIL_LIMIT, BULK_MAX, invalid } from './model/limits';

/**
 * The collections API.
 *
 * Thin, like `convex/library.ts`. The checks that matter are in
 * `convex/model/collections.ts`, and the one worth knowing from here: every
 * membership write names two ids and verifies ownership of both.
 */

/**
 * Every collection, with the covers its tile draws.
 *
 * `RAIL_LIMIT * 4` is the same bound `collectionIdsFor` takes to, so the ticks
 * in the picker cover exactly the collections the picker lists.
 */
export const list = query({
  args: {},
  returns: v.array(Library.publicCollectionValidator),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return await Library.collectionSummaries(ctx, user._id, RAIL_LIMIT * 4, COLLECTION_COVER_LIMIT);
  },
});

/**
 * Every membership in the account, for the reconcile.
 *
 * A device rebuilding its own copy needs the whole relation, and asking
 * `documents` once per collection is one query per folder for a screen that
 * does not exist yet. Paginated because membership is the one table here that
 * grows with the product of two others.
 *
 * Scoped by the denormalised `ownerId`, which is what that column has always
 * been for — see the note on it in `convex/schema.ts`.
 */
export const membership = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      collectionId: v.id('collections'),
      documentId: v.id('documents'),
      addedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const page = await Collections.membershipPage(ctx, user._id, args.paginationOpts);
    return page;
  },
});

/**
 * The documents inside one collection, a page at a time.
 *
 * Hydrated to the same wire shape the library view reads, so the collection
 * detail screen renders through the very same grid and list. A read, so no rate
 * limit; owner-checked on the collection, and again on each document as it is
 * hydrated.
 */
export const documents = query({
  args: { collectionId: v.id('collections'), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(Library.publicDocumentValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await Collections.documentsPage(ctx, user, args.collectionId, args.paginationOpts);
  },
});

/**
 * The collections a document belongs to — the checkmark state for the add
 * picker. A read, so no rate limit; owner-checked on the document.
 */
export const forDocument = query({
  args: { documentId: v.id('documents') },
  returns: v.array(v.id('collections')),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await Collections.collectionIdsFor(ctx, user, args.documentId, RAIL_LIMIT * 4);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    /** The id the device already filed it under. See `model/sync.ts`. */
    clientOpId: v.optional(v.string()),
    clientUpdatedAt: v.optional(v.number()),
  },
  returns: v.id('collections'),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'createCollection');
    return await Collections.create(ctx, user, args.name, {
      ...(args.clientOpId === undefined ? {} : { clientOpId: args.clientOpId }),
      ...(args.clientUpdatedAt === undefined ? {} : { clientUpdatedAt: args.clientUpdatedAt }),
    });
  },
});

export const rename = mutation({
  args: {
    collectionId: v.id('collections'),
    name: v.string(),
    clientUpdatedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'editCollection');
    await Collections.rename(ctx, user, args.collectionId, args.name, args.clientUpdatedAt);
    return null;
  },
});

/** Deletes the collection and its memberships. The documents survive. */
export const remove = mutation({
  args: { collectionId: v.id('collections') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'editCollection');
    await Collections.remove(ctx, user, args.collectionId);
    return null;
  },
});

export const addDocument = mutation({
  args: { collectionId: v.id('collections'), documentId: v.id('documents') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'editCollection');
    await Collections.addDocument(ctx, user, args.collectionId, args.documentId);
    return null;
  },
});

export const removeDocument = mutation({
  args: { collectionId: v.id('collections'), documentId: v.id('documents') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'editCollection');
    await Collections.removeDocument(ctx, user, args.collectionId, args.documentId);
    return null;
  },
});

/**
 * Adds a selection of documents to a collection in one call — the multi-select
 * toolbar's "Add to collection".
 *
 * One `editCollection` token for the whole gesture, not one per document. The
 * array is capped at `BULK_MAX`; a longer selection is the client's to chunk
 * into sequential calls, which keeps each transaction inside a mutation's
 * budget. Ownership of the collection and of every document is checked in
 * `Collections.addDocuments`.
 */
export const addDocuments = mutation({
  args: {
    collectionId: v.id('collections'),
    documentIds: v.array(v.id('documents')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.documentIds.length > BULK_MAX) {
      invalid(`A single change is limited to ${BULK_MAX} documents.`);
    }
    await limit(ctx, user, 'editCollection');
    await Collections.addDocuments(ctx, user, args.collectionId, args.documentIds);
    return null;
  },
});

export const removeDocuments = mutation({
  args: {
    collectionId: v.id('collections'),
    documentIds: v.array(v.id('documents')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.documentIds.length > BULK_MAX) {
      invalid(`A single change is limited to ${BULK_MAX} documents.`);
    }
    await limit(ctx, user, 'editCollection');
    await Collections.removeDocuments(ctx, user, args.collectionId, args.documentIds);
    return null;
  },
});
