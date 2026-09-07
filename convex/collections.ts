import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
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
