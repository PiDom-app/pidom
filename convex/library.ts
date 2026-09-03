import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { internalMutation, mutation, query } from './_generated/server';
import { requireUser } from './model/auth';
import * as Library from './model/library';
import {
  COLLECTION_COVER_LIMIT,
  COLLECTION_LIMIT,
  DOWNLOAD_URL_SECONDS,
  SWEEP_LIMIT,
} from './model/limits';
import { r2 } from './r2';

/**
 * The library API.
 *
 * Every function here is the argument contract and one call into
 * `convex/model/library.ts`. Keeping it thin is what makes it auditable in one
 * read, which matters because anything exported from a non-`internal` file can
 * be called by anyone holding the deployment URL.
 *
 * **No function takes an owner id.** There is no argument a caller can set to
 * read or write somebody else's library — `requireUser` resolves the owner from
 * the JWT Convex has already verified against Google's JWKS.
 */

/* ── reads ──────────────────────────────────────────────────────────── */

/**
 * Everything the home screen renders, in one query.
 *
 * Five rails as five queries would be five websocket subscriptions, five
 * re-renders on every write, and five chances for the screen to show two
 * different moments at once. One query is one consistent snapshot.
 *
 * The "on this device" rail is deliberately absent: the server cannot know what
 * is on a phone's disk. The device scans its own library directory and asks
 * `byIds` for the metadata.
 */
export const home = query({
  args: {},
  returns: v.object({
    continueReading: v.array(Library.publicDocumentValidator),
    recentlyAdded: v.array(Library.publicDocumentValidator),
    favorites: v.array(Library.publicDocumentValidator),
    finished: v.array(Library.publicDocumentValidator),
    collections: v.array(Library.publicCollectionValidator),
  }),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const ownerId = user._id;

    const [continueReading, recentlyAdded, favorites, finished, collections] = await Promise.all([
      Library.continueReading(ctx, ownerId),
      Library.recentlyAdded(ctx, ownerId),
      Library.favorites(ctx, ownerId),
      Library.finished(ctx, ownerId),
      Library.collectionSummaries(ctx, ownerId, COLLECTION_LIMIT, COLLECTION_COVER_LIMIT),
    ]);

    return {
      continueReading: continueReading.map(Library.toPublicDocument),
      recentlyAdded: recentlyAdded.map(Library.toPublicDocument),
      favorites: favorites.map(Library.toPublicDocument),
      finished: finished.map(Library.toPublicDocument),
      collections,
    };
  },
});

/**
 * Metadata for documents the device holds on disk.
 *
 * The ids come from a filesystem scan, so they are the one place a client
 * supplies identifiers it did not receive from a previous query. Ids the caller
 * does not own come back missing rather than as an error — see the note on
 * `Library.byIds`.
 */
export const byIds = query({
  args: { ids: v.array(v.id('documents')) },
  returns: v.array(Library.publicDocumentValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const docs = await Library.byIds(ctx, user._id, args.ids);
    return docs.map(Library.toPublicDocument);
  },
});

/**
 * One page of the all-library screen.
 *
 * The only function here without a `returns` validator. Convex's
 * `PaginationResult` carries optional cursor-splitting fields that exist to let
 * the platform change how it pages; spelling them out here would pin this
 * function to one version of that shape and break on an upgrade for no safety
 * gained. The `page` array is what crosses to the client, and every element of
 * it went through `toPublicDocument`.
 */
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    sort: Library.sortValidator,
    filter: Library.filterValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const page = await Library.listPage(
      ctx,
      user._id,
      args.paginationOpts,
      args.sort,
      args.filter,
    );
    return { ...page, page: page.page.map(Library.toPublicDocument) };
  },
});

/**
 * How much of the account's storage the reader is using.
 *
 * At 100 MB a document, R2's 10 GB free tier is around a hundred documents —
 * close enough that somebody deciding whether to sync a textbook deserves to
 * know where they stand. Summed from rows the screen already has rather than
 * asked of Cloudflare, so it costs one index scan and no egress.
 */
export const usage = query({
  args: {},
  returns: v.object({ syncedCount: v.number(), syncedBytes: v.number() }),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const docs = await ctx.db
      .query('documents')
      .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
      .take(SWEEP_LIMIT);

    let syncedCount = 0;
    let syncedBytes = 0;
    for (const doc of docs) {
      if (doc.storageKey !== undefined) {
        syncedCount += 1;
        syncedBytes += doc.byteSize;
      }
    }
    return { syncedCount, syncedBytes };
  },
});

export const search = query({
  args: { term: v.string() },
  returns: v.array(Library.publicDocumentValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const docs = await Library.searchTitles(ctx, user._id, args.term);
    return docs.map(Library.toPublicDocument);
  },
});

/* ── writes ─────────────────────────────────────────────────────────── */

/**
 * Records an imported PDF.
 *
 * Returns the id, which the client uses as the local filename. That ordering is
 * the point: the picked file's own name never becomes a path segment, so a PDF
 * called `../../../shared_prefs/auth.xml` is a title and nothing more.
 */
export const importDocument = mutation({
  args: {
    title: v.string(),
    author: v.optional(v.string()),
    byteSize: v.number(),
  },
  returns: v.id('documents'),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await Library.importDocument(ctx, user, args);
  },
});

export const setFavorite = mutation({
  args: { documentId: v.id('documents'), isFavorite: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await Library.setFavorite(ctx, user, args.documentId, args.isFavorite);
    return null;
  },
});

export const rename = mutation({
  args: {
    documentId: v.id('documents'),
    title: v.string(),
    // An absent or empty author clears the field rather than leaving it as it
    // was. The rename sheet always sends both, so there is one path here
    // instead of a partial-update path beside it.
    author: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await Library.rename(ctx, user, args.documentId, args.title, args.author);
    return null;
  },
});

/**
 * Reading position, written when the reader leaves a document.
 *
 * `pageCount` rides along because the import path cannot know it — counting
 * pages needs a PDF renderer, which is the reader's dependency. The first open
 * is when the number becomes available, and this is where it lands.
 */
export const recordProgress = mutation({
  args: {
    documentId: v.id('documents'),
    currentPage: v.number(),
    pageCount: v.optional(v.number()),
    isFinished: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await Library.recordProgress(ctx, user, args);
    return null;
  },
});

/* ── cloud copy ─────────────────────────────────────────────────────── */

/**
 * A signed URL the client can PUT one of this document's two objects to.
 *
 * The component's own `generateUploadUrl` deliberately refuses a custom key —
 * its docs say you do not want the client naming your objects, which is right.
 * Pidom's keys carry ownership, so this mints them instead, from a document id
 * that has already been through `assertOwner` and an owner id the caller never
 * supplied.
 *
 * `requireUser` first, and not as a formality: a signed PUT URL is a write
 * capability against the bucket, and storage is billed.
 */
export const uploadUrl = mutation({
  args: {
    documentId: v.id('documents'),
    what: v.union(v.literal('document'), v.literal('cover')),
  },
  returns: v.object({ key: v.string(), url: v.string() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const doc = await Library.requireDocument(ctx, user, args.documentId);

    const key =
      args.what === 'cover'
        ? Library.coverKey(user._id, doc._id)
        : Library.pdfKey(user._id, doc._id);

    // The component fails on a key that already exists, so a re-sync clears the
    // old object first. Without this, syncing a document twice is an error the
    // reader cannot act on.
    const existing = args.what === 'cover' ? doc.coverStorageKey : doc.storageKey;
    if (existing !== undefined) {
      await r2.deleteObject(ctx, existing).catch(() => undefined);
    }

    return await r2.generateUploadUrl(key);
  },
});

/**
 * A signed URL to fetch a document, valid for five minutes.
 *
 * A mutation rather than a query, and deliberately: a query result is cached
 * and reactive, and a cached URL outliving its signature is a download that
 * fails for no visible reason. This is fetched at the moment of use.
 *
 * The ownership check runs here, when the URL is minted, rather than on the
 * request that moves the bytes — that is the trade R2 buys. Five minutes rather
 * than the component's default of fifteen: a download starts immediately, and
 * the window has no reason to be wider than the act.
 */
export const downloadUrl = mutation({
  args: {
    documentId: v.id('documents'),
    what: v.union(v.literal('document'), v.literal('cover')),
  },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const doc = await Library.requireDocument(ctx, user, args.documentId);

    const key = args.what === 'cover' ? doc.coverStorageKey : doc.storageKey;
    if (key === undefined) {
      return null;
    }
    return await r2.getUrl(key, { expiresIn: DOWNLOAD_URL_SECONDS });
  },
});

/**
 * Links an upload to a document.
 *
 * The key is recomputed, and the size, content type and hash are read back from
 * R2's metadata rather than trusted from the caller — see `Library.attachUpload`
 * for why that is the whole point of a three-request flow.
 */
export const attachUpload = mutation({
  args: {
    documentId: v.id('documents'),
    storageKey: v.string(),
    coverStorageKey: v.optional(v.string()),
    pageCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await Library.attachUpload(ctx, user, args);
    return null;
  },
});

/** Stops syncing a document. The copy on this device stays. */
export const detachUpload = mutation({
  args: { documentId: v.id('documents') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await Library.detachUpload(ctx, user, args.documentId);
    return null;
  },
});

/**
 * Deletes R2 objects that no document points at.
 *
 * The upload flow is three requests, and the app can die between the second and
 * the third: the PUT lands, `attachUpload` never runs, and the object is left
 * referenced by nothing. Neither R2 nor Convex collects those, and nothing in
 * the app can show them, so without this every killed import becomes storage the
 * reader pays for and cannot find.
 *
 * Older than a day, because an object uploaded in the last few seconds may be
 * one `attachUpload` is about to claim.
 *
 * `internalMutation`, so only the cron can run it — this deletes files, and a
 * public function that deletes files on a schedule is a public function that
 * deletes files.
 */
export const sweepOrphanedObjects = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    const objects = await r2.listMetadata(ctx, SWEEP_LIMIT);
    const referenced = new Set<string>();

    // Every document, not an index: the question is "is this object referenced
    // by anything at all", which no owner-scoped index can answer. Bounded by
    // `SWEEP_LIMIT` so one sweep cannot outgrow a mutation's time budget; a
    // library past that gets swept over several nights.
    for (const doc of await ctx.db.query('documents').take(SWEEP_LIMIT)) {
      if (doc.storageKey !== undefined) {
        referenced.add(doc.storageKey);
      }
      if (doc.coverStorageKey !== undefined) {
        referenced.add(doc.coverStorageKey);
      }
    }

    let deleted = 0;
    for (const object of objects.page) {
      const modified = Date.parse(object.lastModified);
      if (Number.isFinite(modified) && modified < cutoff && !referenced.has(object.key)) {
        await r2.deleteObject(ctx, object.key);
        deleted += 1;
      }
    }
    return deleted;
  },
});

/** Deletes the row, its memberships and its blobs. The local file is the client's. */
export const remove = mutation({
  args: { documentId: v.id('documents') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await Library.removeDocument(ctx, user, args.documentId);
    return null;
  },
});
