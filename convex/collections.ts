import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireUser } from './model/auth';
import * as Collections from './model/collections';
import * as Library from './model/library';
import { limit } from './model/rateLimits';
import { COLLECTION_COVER_LIMIT, RAIL_LIMIT } from './model/limits';

/**
 * The collections API.
 *
 * Thin, like `convex/library.ts`. The checks that matter are in
 * `convex/model/collections.ts`, and the one worth knowing from here: every
 * membership write names two ids and verifies ownership of both.
 */

/** The documents in one collection. Backs the collection screen. */
export const documents = query({
  args: {
    collectionId: v.id('collections'),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    name: v.string(),
    documentCount: v.number(),
    documents: v.array(Library.publicDocumentValidator),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    // `requireCollection` first, so a caller probing ids gets `FORBIDDEN`
    // before any document is read rather than an empty list they could read
    // something into.
    const collection = await Collections.requireCollection(ctx, user, args.collectionId);

    // The caller may ask for fewer, never more. An unbounded `limit` argument
    // is an unbounded read with extra steps.
    const limit = Math.min(args.limit ?? 60, 200);
    const docs = await Library.documentsInCollection(ctx, user._id, collection._id, limit);

    return {
      name: collection.name,
      documentCount: collection.documentCount,
      documents: docs.map(Library.toPublicDocument),
    };
  },
});

/**
 * Which collections hold a given document.
 *
 * The action sheet needs it to show ticks rather than making the reader
 * remember where they already filed something.
 */
export const forDocument = query({
  args: { documentId: v.id('documents') },
  returns: v.array(v.id('collections')),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await Collections.collectionIdsFor(ctx, user, args.documentId);
  },
});

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

export const create = mutation({
  args: { name: v.string() },
  returns: v.id('collections'),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'createCollection');
    return await Collections.create(ctx, user, args.name);
  },
});

export const rename = mutation({
  args: { collectionId: v.id('collections'), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await Collections.rename(ctx, user, args.collectionId, args.name);
    return null;
  },
});

/** Deletes the collection and its memberships. The documents survive. */
export const remove = mutation({
  args: { collectionId: v.id('collections') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await Collections.remove(ctx, user, args.collectionId);
    return null;
  },
});

export const addDocument = mutation({
  args: { collectionId: v.id('collections'), documentId: v.id('documents') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await Collections.addDocument(ctx, user, args.collectionId, args.documentId);
    return null;
  },
});

export const removeDocument = mutation({
  args: { collectionId: v.id('collections'), documentId: v.id('documents') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await Collections.removeDocument(ctx, user, args.collectionId, args.documentId);
    return null;
  },
});
