import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Pidom's data model.
 *
 * Every owned table follows the shape `users` established: a row belongs to
 * exactly one `users` row through `ownerId`, and carries a `by_owner` index so
 * an owner-scoped read is an index lookup rather than a `.filter()` scan over
 * everyone's rows. Ownership is never an argument — it is resolved server-side
 * from the verified JWT. See `convex/model/auth.ts`.
 *
 * The line this schema draws: **Convex owns metadata and, when the reader asks
 * for it, a copy of the file. The device owns whether that copy is here.**
 *
 * `storageKey` says a document can be fetched. It does not say it has been, and
 * no field here does: a row cannot know what is on a given phone's disk, and a
 * stale flag would put a wrong badge on the one screen whose job is to say what
 * opens offline. There is no `file://` URI and no download state. Local
 * availability is answered by the filesystem — see `src/features/library/local/`.
 */
export default defineSchema({
  users: defineTable({
    /**
     * Google's `sub` claim. Stable for the lifetime of the Google account and
     * unique per (account, application), which makes it the ownership key.
     *
     * Email is deliberately not the key: Google accounts can change their
     * primary address, and an email is user-supplied data in any other context.
     */
    subject: v.string(),
    email: v.string(),
    emailVerified: v.boolean(),
    name: v.optional(v.string()),
    pictureUrl: v.optional(v.string()),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  }).index('by_subject', ['subject']),

  /**
   * One imported PDF.
   *
   * The reading position lives here rather than in a table of its own. It is
   * 1:1 with the document, the document is already owner-scoped, and
   * `lastOpenedAt` is the sort key for Continue Reading — the hottest query on
   * the home screen. A separate table would cost one extra read per rail item
   * to render it.
   */
  documents: defineTable({
    ownerId: v.id('users'),
    title: v.string(),
    author: v.optional(v.string()),

    /**
     * Absent until the reader opens the document once.
     *
     * Nothing in the import path can count pages: that needs a PDF renderer,
     * and the renderer is the reader's dependency, not the library's. Until
     * then the tile shows the file size instead, which is honest and true.
     */
    pageCount: v.optional(v.number()),
    byteSize: v.number(),

    /** 1-based, and clamped against `pageCount` server-side on every write. */
    currentPage: v.number(),
    /** 0..1. Stored rather than derived so a rail can sort and render on it. */
    progress: v.number(),
    isFinished: v.boolean(),
    isFavorite: v.boolean(),

    /** Absent until first opened, which is what keeps it out of Continue Reading. */
    lastOpenedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),

    /**
     * The cloud copy, when the reader asked for one.
     *
     * All four are optional because a local-only document is a first-class
     * state and not a half-finished one: it is what a document over the sync
     * limit is, and what every document is until somebody decides otherwise.
     *
     * These are Cloudflare R2 object keys rather than Convex storage ids —
     * Convex's own file storage cannot serve a 100 MB document, because an HTTP
     * action response is capped at 20 MiB. See `convex/convex.config.ts`.
     *
     * The keys are `<ownerId>/<documentId>.pdf` and `.cover.jpg`, minted
     * server-side from ids the caller cannot bend, and **they never cross the
     * wire**: `toPublicDocument` exposes only `isSynced` and `hasCover`. A key
     * is a guessable string in a way a Convex id is not.
     *
     * There is no `uploadState` beside them. Upload progress is transient
     * client state — it belongs in zustand next to the local-availability set,
     * not in a row every device subscribes to and re-renders on.
     */
    storageKey: v.optional(v.string()),
    /** The rendered first page, so a device can show a cover before the PDF. */
    coverStorageKey: v.optional(v.string()),
    uploadedAt: v.optional(v.number()),
    /** sha256, read back from R2's own metadata rather than taken from the client. */
    contentHash: v.optional(v.string()),
  })
    // Recently Added, and the all-library list. `_creationTime` is appended to
    // every index automatically, so this already sorts newest-first under
    // `.order('desc')` — a `by_owner_and_created` index would be redundant.
    .index('by_owner', ['ownerId'])
    // Two rails off one index: Continue Reading is `eq(isFinished, false)`
    // descending by `lastOpenedAt`, Finished is `eq(isFinished, true)`.
    // Documents never opened sort last under `desc`, which is where they belong.
    .index('by_owner_and_finished', ['ownerId', 'isFinished', 'lastOpenedAt'])
    .index('by_owner_and_favorite', ['ownerId', 'isFavorite', 'lastOpenedAt'])
    // The two orderings the all-library screen offers besides newest-first.
    // There is deliberately no `by_owner_and_author`: `author` is optional, and
    // an index sorts a missing value first, so sorting by author would open the
    // library with every document that has no author on it.
    .index('by_owner_and_opened', ['ownerId', 'lastOpenedAt'])
    .index('by_owner_and_title', ['ownerId', 'title'])
    // `ownerId` as a filter field is what keeps one reader's search out of
    // another's library — a search index has no implicit scope.
    .searchIndex('search_title', {
      searchField: 'title',
      filterFields: ['ownerId'],
    }),

  /**
   * A named group of documents. It owns no files and duplicates no document —
   * a PDF can sit in several collections and still be one row in `documents`.
   */
  collections: defineTable({
    ownerId: v.id('users'),
    name: v.string(),
    /**
     * Denormalised. The home screen shows every collection with its count, and
     * counting membership rows per collection would be one index scan each,
     * every render. Maintained by the two membership mutations, which are the
     * only writers.
     */
    documentCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_owner', ['ownerId']),

  /** Membership. The relationship, and nothing else. */
  collectionDocuments: defineTable({
    /** Denormalised so a membership row can be owner-checked without two fetches. */
    ownerId: v.id('users'),
    collectionId: v.id('collections'),
    documentId: v.id('documents'),
    addedAt: v.number(),
  })
    // Newest-first, for the four covers the collection tile shows.
    .index('by_collection', ['collectionId', 'addedAt'])
    // The cascade when a document is deleted.
    .index('by_document', ['documentId'])
    // "Is it already in?" — one lookup rather than a scan of the collection.
    .index('by_collection_and_document', ['collectionId', 'documentId']),
});
