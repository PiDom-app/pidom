import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import { requireUser } from './model/auth';
import * as Library from './model/library';
import * as Processing from './model/processing';
import { limit } from './model/rateLimits';
import { queueExtraction } from './workflows/document';
import {
  COLLECTION_COVER_LIMIT,
  COLLECTION_LIMIT,
  DOWNLOAD_URL_SECONDS,
  OUTLINE_ENTRY_MAX,
  PAGE_MIRROR_BATCH,
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
 * This used to be the only function here without a `returns` validator, because
 * `PaginationResult` carries optional cursor-splitting fields that let the
 * platform change how it pages, and writing them out by hand would have pinned
 * the function to one version of that shape. `paginationResultValidator` is the
 * answer to exactly that: it derives the wrapper from the item validator, so the
 * split fields stay the platform's business and the `page` array is still
 * checked element by element.
 */
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    sort: Library.sortValidator,
    filter: Library.filterValidator,
  },
  returns: paginationResultValidator(Library.publicDocumentValidator),
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
  returns: v.object({
    syncedCount: v.number(),
    syncedBytes: v.number(),
    /** Documents nowhere but the phone that imported them. */
    localOnlyCount: v.number(),
    /** Synced, parsed, and carrying no text layer. Scans. */
    scanCount: v.number(),
  }),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const docs = await ctx.db
      .query('documents')
      .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
      .take(SWEEP_LIMIT);

    let syncedCount = 0;
    let syncedBytes = 0;
    let localOnlyCount = 0;
    let scanCount = 0;

    // The last two ride along on the scan the first two already do. They are
    // the two reasons a document can be missing from a search result, and the
    // search screen says both — a reader whose book is absent deserves the
    // reason rather than an empty list.
    for (const doc of docs) {
      if (doc.storageKey === undefined) {
        localOnlyCount += 1;
        continue;
      }
      syncedCount += 1;
      syncedBytes += doc.byteSize;
      if (doc.textStatus === 'none') {
        scanCount += 1;
      }
    }
    return { syncedCount, syncedBytes, localOnlyCount, scanCount };
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

/**
 * A document the caller already has with this fingerprint.
 *
 * Asked once per import, before anything is written, so the reader is told
 * before they commit rather than after they have two copies. `null` is the
 * ordinary answer and not an error.
 *
 * A query rather than part of `importDocument`, because the decision is the
 * reader's: they may genuinely want a second copy — a marked-up version of the
 * same paper is a different document to a person.
 */
export const findByFingerprint = query({
  args: { fingerprint: v.string() },
  returns: v.union(v.null(), Library.publicDocumentValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const doc = await Library.findByFingerprint(ctx, user._id, args.fingerprint);
    return doc === null ? null : Library.toPublicDocument(doc);
  },
});

/** A document's table of contents, flattened. Empty when it has none. */
export const outline = query({
  args: { documentId: v.id('documents') },
  returns: v.array(Processing.outlineEntryValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await Processing.outlineFor(ctx, user, args.documentId);
  },
});

/**
 * Pages matching a term, across the library or inside one document.
 *
 * Only synced documents can answer: the text was read from the copy in R2,
 * because that copy is the only one the server can see. A local-only document
 * is absent from these results, and the screen says so rather than leaving the
 * reader to wonder why their book is missing.
 */
export const searchInside = query({
  args: {
    term: v.string(),
    documentId: v.optional(v.id('documents')),
  },
  returns: v.array(Processing.searchHitValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await Processing.searchInside(ctx, user, args.term, args.documentId);
  },
});

/**
 * A page of a document's extracted text, for the device to mirror.
 *
 * The one query in this file that hands the client document *content* rather
 * than metadata, and it exists so the reader can search inside a book with no
 * connection — the copy in the account is the only place the text is, and a
 * phone in aeroplane mode cannot reach it.
 *
 * Paginated because a 600-page book is far past a function's 16 MiB return
 * limit. The device pulls a document once and then never asks again; see
 * `src/features/library/local/text-index.ts`.
 */
export const pagesOf = query({
  args: {
    documentId: v.id('documents'),
    /** Exclusive. The device pages by asking for what comes after the last. */
    after: v.number(),
  },
  returns: v.object({
    pages: v.array(v.object({ page: v.number(), text: v.string() })),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    // Ownership on the document rather than on the page rows: it is the thing
    // being asked about, and a caller probing ids gets `FORBIDDEN` before a
    // single page is read.
    await Library.requireDocument(ctx, user, args.documentId);

    const pages = await ctx.db
      .query('documentPages')
      .withIndex('by_document_and_page', (q) =>
        q.eq('documentId', args.documentId).gt('page', args.after),
      )
      .take(PAGE_MIRROR_BATCH);

    return {
      pages: pages.map((row) => ({ page: row.page, text: row.text })),
      // Short of a full batch means the end. One fewer round trip than a count.
      isDone: pages.length < PAGE_MIRROR_BATCH,
    };
  },
});

/** How far the text extraction has got, for the Details sheet. */
export const processingStatus = query({
  args: { documentId: v.id('documents') },
  returns: v.union(v.null(), Processing.jobValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const job = await Processing.jobFor(ctx, user, args.documentId);
    return job === null ? null : Processing.toPublicJob(job);
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
    /** The picker's filename. Presentation metadata; the id is the path. */
    originalFileName: v.optional(v.string()),
    /** What the picker claimed. Recorded, not trusted — the bytes decided. */
    mimeType: v.optional(v.string()),
    /** From the probe, when it finished before the reader committed. */
    pageCount: v.optional(v.number()),
    /** `<byteSize>-<sha256 of both ends>`, checked for shape server-side. */
    fingerprint: v.optional(v.string()),
  },
  returns: v.id('documents'),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'import');
    return await Library.importDocument(ctx, user, args);
  },
});

/**
 * Records how the device probe ended, and its table of contents.
 *
 * One mutation for both because they come off one PDF load and land together —
 * two would be two writes, two subscriptions waking, and a window in which a
 * document is `ready` with an outline that has not arrived.
 *
 * The entries are client-supplied: `react-native-pdf` hands back whatever the
 * PDF declares, and a PDF is a file somebody else wrote. `Processing.setOutline`
 * bounds the count, the depth and every title, and clamps every page number
 * against the document's own `pageCount`.
 */
export const setProcessed = mutation({
  args: {
    documentId: v.id('documents'),
    processing: v.union(
      v.literal('probing'),
      v.literal('ready'),
      v.literal('partial'),
      v.literal('failed'),
    ),
    pageCount: v.optional(v.number()),
    error: v.optional(v.string()),
    outline: v.optional(v.array(Processing.outlineEntryValidator)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'setProcessed');

    if (args.outline !== undefined && args.outline.length > OUTLINE_ENTRY_MAX) {
      // Refused at the number `setOutline` actually keeps. Accepting four times
      // that and then trimming was validating 400 KB in order to throw most of
      // it away — and it made the limit in `limits.ts` a lie about what gets in.
      throw new ConvexError({
        code: 'INVALID',
        message: `A table of contents is limited to ${OUTLINE_ENTRY_MAX} entries.`,
      });
    }

    await Library.setProcessing(ctx, user, {
      documentId: args.documentId,
      processing: args.processing,
      ...(args.pageCount === undefined ? {} : { pageCount: args.pageCount }),
      ...(args.error === undefined ? {} : { error: args.error }),
    });

    // `setProcessing` ran first, so the page clamp in `setOutline` is against
    // the count this same call just wrote rather than the previous one.
    if (args.outline !== undefined) {
      await Processing.setOutline(ctx, user, args.documentId, args.outline);
    }
    return null;
  },
});

/**
 * Runs the pipeline again for one document.
 *
 * The device half is the client's to redo — it holds the file — so this is only
 * the cloud half, and it needs a cloud copy to work on. A document that is not
 * synced has nothing here to reprocess and says so.
 *
 * Rate-limited hardest of the four, because each call is a Node action that
 * pulls a file out of R2 and runs pdf.js over it, and it is the only expensive
 * thing a reader can ask for repeatedly by tapping.
 */
export const reprocess = mutation({
  args: { documentId: v.id('documents') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'reprocess');

    const doc = await Library.requireDocument(ctx, user, args.documentId);
    if (doc.storageKey === undefined) {
      throw new ConvexError({
        code: 'INVALID',
        message: 'That document is not in your account, so there is nothing here to read.',
      });
    }

    await queueExtraction(ctx, doc._id, user._id);
    return null;
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
    readingMode: v.optional(Library.readingModeValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    // Rate limited now that the reader debounces instead of writing only on the
    // way out. The bucket is sized so reading cannot reach it; see
    // `model/rateLimits.ts`.
    await limit(ctx, user, 'recordProgress');
    await Library.recordProgress(ctx, user, args);
    return null;
  },
});

/* ── bookmarks ──────────────────────────────────────────────────────── */

/**
 * Every page marked in one document.
 *
 * Owner-checked on the document before a bookmark row is read, so an id the
 * caller does not own answers `FORBIDDEN` rather than an empty list — an empty
 * list would say the document exists.
 */
export const bookmarks = query({
  args: { documentId: v.id('documents') },
  returns: v.array(Library.bookmarkValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await Library.bookmarksFor(ctx, user, args.documentId);
  },
});

export const addBookmark = mutation({
  args: {
    documentId: v.id('documents'),
    currentPage: v.number(),
    label: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'bookmark');
    await Library.addBookmark(ctx, user, {
      documentId: args.documentId,
      page: args.currentPage,
      ...(args.label === undefined ? {} : { label: args.label }),
    });
    return null;
  },
});

export const removeBookmark = mutation({
  args: { documentId: v.id('documents'), currentPage: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'bookmark');
    await Library.removeBookmark(ctx, user, args.documentId, args.currentPage);
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
    await limit(ctx, user, 'uploadUrl');
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
    await limit(ctx, user, 'downloadUrl');
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
    await limit(ctx, user, 'attachUpload');
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
    await limit(ctx, user, 'removeDocument');
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

    let deleted = 0;
    for (const object of objects.page) {
      const modified = Date.parse(object.lastModified);
      if (!Number.isFinite(modified) || modified >= cutoff) {
        continue;
      }
      if (await isReferenced(ctx, object.key)) {
        continue;
      }
      await r2.deleteObject(ctx, object.key);
      deleted += 1;
    }
    return deleted;
  },
});

/**
 * Whether a row still points at this object.
 *
 * **Asked one object at a time, and that is the whole point.** This used to
 * build a set of every referenced key from `ctx.db.query('documents').take(
 * SWEEP_LIMIT)` and delete any object missing from it. That query has no index,
 * so it returns the oldest two thousand rows *in the deployment* — and the set
 * it produced was therefore not "everything referenced", it was "everything
 * referenced by the oldest two thousand rows". Every object belonging to any
 * newer row was, by construction, an orphan.
 *
 * The comment that justified it — a library past the limit gets swept over
 * several nights — was true of the object list and false of the reference set.
 * A list of candidates can be paged. An allowlist cannot: one with holes in it
 * is a delete list.
 *
 * The exploit needed no attacker. Two thousand local-only imports across the
 * whole user base is enough, and the schema calls local-only the normal state.
 * With an attacker it is faster: `importDocument` writes a row and needs no
 * file, so filling the oldest-two-thousand window with rows that have no
 * `storageKey` empties the allowlist completely and the next night deletes
 * every synced file in the bucket, for every account.
 *
 * A key carries the ids that produced it, so the honest question is answerable
 * with one point lookup: recover the document, then require that the row still
 * names this exact key. Correct whatever the deployment holds, and cheaper than
 * the scan it replaces.
 */
async function isReferenced(ctx: MutationCtx, key: string): Promise<boolean> {
  const claimed = Library.documentIdOf(key);
  if (claimed === null) {
    // Not a shape this backend mints. Left alone rather than deleted: an object
    // nothing here can account for is not the sweep's to remove.
    return true;
  }
  const documentId = ctx.db.normalizeId('documents', claimed);
  if (documentId === null) {
    return true;
  }
  const doc = await ctx.db.get('documents', documentId);
  if (doc === null) {
    return false;
  }
  // The row has to name *this* key, not merely exist. A document that was
  // unsynced still has its id in the key of the object it used to own.
  return doc.storageKey === key || doc.coverStorageKey === key;
}

/** Deletes the row, its memberships and its blobs. The local file is the client's. */
export const remove = mutation({
  args: { documentId: v.id('documents') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'removeDocument');
    await Library.removeDocument(ctx, user, args.documentId);
    return null;
  },
});
