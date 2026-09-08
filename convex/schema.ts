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

    /**
     * The name somebody can be found by, and the only one they choose.
     *
     * Sharing needs a way to name a person who is not yet a contact, and every
     * other candidate is worse: a display name is not unique and is not theirs
     * to be identified by, and an email address is the one piece of an account
     * that must never come back out of a search. A handle is opt-in, lowercase
     * `[a-z0-9_]{3,24}`, and unique — see `Discovery.claimHandle`.
     *
     * Optional, because an account that has never opened the sharing screens
     * has never been asked for one, and inventing `emmanuel_g_4471` on their
     * behalf would put a name they did not choose on a screen strangers read.
     */
    handle: v.optional(v.string()),
  })
    .index('by_subject', ['subject'])
    // Discovery, and nothing else. Both of these answer "is there an account
    // at exactly this string" — one row or none. There is deliberately no
    // search index over `name`: a prefix index across every account in the
    // deployment is an enumeration endpoint, and a Convex query cannot spend a
    // rate-limiter token, so there would be nothing to bound it with. Prefix
    // matching exists, in `Discovery.searchWithinGraph`, and reaches only
    // people the caller already shares a group with.
    .index('by_handle', ['handle'])
    .index('by_email', ['email']),

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
     * Written at import, off the same PDF load that produces the cover.
     *
     * Still optional, because that load can fail: a document whose probe came
     * back `failed` has no count and the tile shows its file size instead,
     * which is honest and true. The first open writes it too, so a document
     * imported before the probe existed picks one up the first time it is read.
     */
    pageCount: v.optional(v.number()),
    byteSize: v.number(),

    /**
     * What the one PDF load at import came back with.
     *
     * The row is written before the load runs, because the row's id is the
     * filename — so a document is in the library, and openable, while its cover
     * is still being rendered. This is the field that says so, and the reason
     * a cover that failed is no longer indistinguishable from a document that
     * never had one.
     */
    processing: v.optional(
      v.union(
        /** The probe is running. No cover yet, and the tile says as much. */
        v.literal('probing'),
        /** Page count and cover both landed. Where every document ends up. */
        v.literal('ready'),
        /** The count came back and the snapshot did not. The tint stands in. */
        v.literal('partial'),
        /** The viewer could not read the file at all. Reprocess is offered. */
        v.literal('failed'),
      ),
    ),

    /**
     * Whether the pages of this document can be searched.
     *
     * Absent for a document that is not synced, and that is the whole rule:
     * extraction reads the copy in R2, because the copy in R2 is the only one
     * the server can see. A local-only document has no text status because
     * nothing could have given it one.
     */
    textStatus: v.optional(
      v.union(
        v.literal('queued'),
        v.literal('extracting'),
        v.literal('ready'),
        /** Parsed, and it is a scan. There is no text layer to index. */
        v.literal('none'),
        v.literal('failed'),
      ),
    ),

    /**
     * Whether this document has a table of contents to open.
     *
     * Denormalised off `documentOutline`, and for the same reason
     * `collections.documentCount` is: every rail item's wire shape carries it,
     * so reading it from the outline table would be twelve index lookups per
     * rail per render to decide whether one menu item is shown. Maintained by
     * `Processing.setOutline`, which is the only writer.
     */
    hasOutline: v.optional(v.boolean()),

    /**
     * Why processing failed, as a code.
     *
     * Never a message. The client owns the sentence a reader reads, the same
     * way it does for every code in `convex/model/auth.ts` — a backend string
     * rendered straight into a screen is a backend string in a screenshot.
     */
    processingError: v.optional(v.string()),

    /**
     * What the file was called when it was picked.
     *
     * Presentation metadata and nothing else — the document id is the filename
     * on disk, and always was. It is here because renaming otherwise destroys
     * the only record of what the reader actually chose, which is the one thing
     * they can find the original by in their own downloads folder.
     *
     * Optional, because a document imported before this existed has no answer
     * and inventing one from the title would be a guess dressed as a fact.
     */
    originalFileName: v.optional(v.string()),

    /**
     * What the picker claimed the file was.
     *
     * Recorded, never trusted. Android file managers report
     * `application/octet-stream` for real PDFs often enough that this cannot
     * gate an import — the first five bytes do that, in
     * `src/features/library/local/validate.ts`. It is kept as a fact about how
     * the document arrived, for the one screen that answers "what is this".
     */
    mimeType: v.optional(v.string()),

    /**
     * Enough of the file to recognise it again, so the same PDF is not
     * imported twice as two rows, two files and two uploads.
     *
     * `<byteSize>-<sha256 of the first and last 64 KB>`, and deliberately not a
     * digest of the whole file: `expo-crypto` hashes a buffer, so a real
     * content hash means holding a 100 MB textbook in memory on a phone.
     * Size plus both ends is decisive for the case this exists for — the same
     * file picked twice — and honest about being nothing stronger.
     *
     * `contentHash` beside it is the real digest, read back from R2's own
     * metadata, and only a synced document has one.
     */
    fingerprint: v.optional(v.string()),

    /**
     * The importing device's own id for this document.
     *
     * The device mints an id before it copies the file, because the id is the
     * filename and a phone in aeroplane mode has no way to ask for one. This
     * column is what makes that safe to send: `importDocument` looks the id up
     * first and returns the existing row rather than inserting a second one, so
     * an outbox that delivers the same create twice — a reply lost on the way
     * back, an app killed between the write and the acknowledgement — produces
     * one document rather than two.
     *
     * It doubles as the mapping between the two vocabularies, which is why
     * there is no table for that. Optional because every document imported
     * before the device minted its own ids has none, and those are matched on
     * `_id` instead — the device adopted the Convex id as its local one, so for
     * them the two are the same string.
     */
    localId: v.optional(v.string()),

    /**
     * The device's clock when it last changed this row.
     *
     * Sent with every write that overwrites rather than accumulates, and
     * compared before the patch is applied. Without it an operation queued at
     * nine in the morning and delivered at five in the afternoon stamps the
     * server clock and silently wins against a position written from another
     * device an hour earlier — the reader loses a chapter to a phone that spent
     * the day in a bag.
     *
     * Optional, and a write that carries none is applied unconditionally: that
     * is what every mutation did before this existed, and an older client is
     * not wrong, only less careful.
     */
    clientUpdatedAt: v.optional(v.number()),

    /** 1-based, and clamped against `pageCount` server-side on every write. */
    currentPage: v.number(),
    /** 0..1. Stored rather than derived so a rail can sort and render on it. */
    progress: v.number(),
    isFinished: v.boolean(),
    isFavorite: v.boolean(),

    /**
     * How the reader last laid this document out.
     *
     * Optional because most documents have never been opened, and absent means
     * "whatever suits this screen" rather than a fourth mode — a phone opens
     * continuous, a tablet opens spread, and neither is a decision worth
     * writing down until somebody makes it.
     *
     * A preference rather than a position: it changes when a reader taps a menu,
     * not when they turn a page, so it belongs on the row beside the position
     * rather than in a table of its own. Zoom and scroll offset deliberately do
     * not join it — those change continuously, are meaningless on a screen of a
     * different size, and stay on the device that produced them.
     */
    readingMode: v.optional(
      v.union(
        /** One long scroll. What long-form reading on a phone is. */
        v.literal('continuous'),
        /** One page at a time, swiped horizontally. */
        v.literal('single'),
        /** Two pages side by side. Only reachable on a wide screen. */
        v.literal('spread'),
      ),
    ),

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
    // "Have I already got this one?", asked once per import against an index
    // rather than by scanning the library. Documents imported before
    // fingerprints existed sort first under a missing value and are never
    // looked up, because the query always names a fingerprint.
    .index('by_owner_and_fingerprint', ['ownerId', 'fingerprint'])
    // "Is this the document that phone already sent me?", asked once per queued
    // create. An index rather than a scan because a client that retries an
    // import is a client whose connection is already bad enough.
    .index('by_owner_and_local', ['ownerId', 'localId'])
    // The reconcile a device runs when it comes back: everything the account
    // owns, oldest change first, paged. There was no way to ask this before —
    // `by_owner` sorts on creation and a device wants to know what *moved*.
    .index('by_owner_and_updated', ['ownerId', 'updatedAt'])
    .index('by_owner_and_opened', ['ownerId', 'lastOpenedAt'])
    .index('by_owner_and_title', ['ownerId', 'title'])
    // `ownerId` as a filter field is what keeps one reader's search out of
    // another's library — a search index has no implicit scope.
    .searchIndex('search_title', {
      searchField: 'title',
      filterFields: ['ownerId'],
    }),

  /**
   * A document's table of contents, as one row rather than one row per entry.
   *
   * An outline is read whole or not at all — the Contents sheet opens with all
   * of it — so a row per entry would be one index scan and forty document reads
   * to draw one list. Flattened with `depth` instead of nested children: Convex
   * caps nesting at 16 levels, a recursive validator is not expressible in
   * `v`, and the sheet renders depth as indentation anyway.
   *
   * It comes off `react-native-pdf`'s `onLoadComplete`, which hands back
   * `tableContents` on the same load that produced the cover. The entries are
   * therefore **client-supplied**, and `Library.setOutline` bounds and clamps
   * every one of them the way `cleanText` bounds a title.
   */
  documentOutline: defineTable({
    ownerId: v.id('users'),
    documentId: v.id('documents'),
    entries: v.array(
      v.object({
        title: v.string(),
        /** 1-based and clamped against the document's `pageCount`. */
        page: v.number(),
        /** 0, 1 or 2. Deeper than that is four characters of title on a phone. */
        depth: v.number(),
      }),
    ),
    updatedAt: v.number(),
  }).index('by_document', ['documentId']),

  /**
   * One page's text, which is what makes searching inside a document possible.
   *
   * Only a synced document has these rows: extraction reads the copy in R2,
   * because that copy is the only one the server can see. Deleting the cloud
   * copy deletes them — see `Library.detachUpload`.
   *
   * A row per page rather than a row per document, and the search index is why:
   * a hit has to name a page for the reader to jump to, and a 600-page book's
   * text is far past Convex's 1 MiB document limit besides.
   */
  documentPages: defineTable({
    ownerId: v.id('users'),
    documentId: v.id('documents'),
    /** 1-based, matching what the reader sees at the bottom of the screen. */
    page: v.number(),
    text: v.string(),
  })
    // Reading a document's pages back in order, and deleting them all when its
    // cloud copy goes away.
    .index('by_document_and_page', ['documentId', 'page'])
    // `ownerId` as a filter field is what keeps one reader's search out of
    // another's documents — a search index has no implicit scope. `documentId`
    // beside it is what makes "search inside this one" one query rather than a
    // whole-library search filtered afterwards.
    .searchIndex('search_text', {
      searchField: 'text',
      filterFields: ['ownerId', 'documentId'],
    }),

  /**
   * Documents whose page text still needs clearing.
   *
   * `detachUpload` and `removeDocument` delete pages as they go, but a mutation
   * reads 16 MiB and a page holds up to `PAGE_TEXT_MAX` — so a long book cannot
   * be emptied inside one of them, and whatever is left has to be found again
   * later.
   *
   * Found by being *recorded*, not by being searched for. The previous version
   * scanned the head of `documentPages` looking for orphans, which reads the
   * oldest pages in the deployment — pages that almost always belong to a
   * document that is still perfectly synced. It swept nothing, every night, for
   * ever, while the reader's own document text sat further down the table.
   *
   * `documentId` is a `v.string()` rather than a `v.id('documents')` on purpose:
   * this row outlives the document it names, which is the entire point of it,
   * and a typed id would be a reference that is dangling by design.
   */
  pagePruneQueue: defineTable({
    documentId: v.string(),
    queuedAt: v.number(),
  })
    // Oldest first, so a backlog drains in the order it accumulated.
    .index('by_queued', ['queuedAt'])
    // "Is this one already queued?" — one lookup rather than a scan.
    .index('by_document', ['documentId']),

  /**
   * The state of one extraction, owner-scoped so a device can subscribe to it.
   *
   * The workflow component keeps its own status, and this is not a duplicate of
   * it: that status lives in the component's tables, which carry no `ownerId`
   * and which the client has no business reading. This row is the part of the
   * job a reader is allowed to see, and the only part the Details sheet needs.
   */
  documentJobs: defineTable({
    ownerId: v.id('users'),
    documentId: v.id('documents'),
    /** The component's handle, for `getStatus`, `cancel` and `cleanup`. */
    workflowId: v.string(),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('done'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    /** Pages written so far, so the sheet can say "218 of 499" rather than spin. */
    pagesDone: v.number(),
    pagesTotal: v.optional(v.number()),
    /** A code, for the same reason `processingError` is one. */
    error: v.optional(v.string()),
    startedAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_document', ['documentId'])
    // The nightly re-drive: everything still claiming to run, oldest first.
    .index('by_status', ['status', 'updatedAt']),

  /**
   * A page somebody marked, in a document they own.
   *
   * A table rather than an array on `documents`, for the reason the guidelines
   * give: an unbounded list inside a document grows into the 1 MB limit and
   * rewrites the whole row on every append. This one is also written far more
   * often than the row it belongs to.
   *
   * `ownerId` is denormalised, as on `collectionDocuments`, so a bookmark row
   * can be owner-checked without fetching the document behind it.
   */
  documentBookmarks: defineTable({
    ownerId: v.id('users'),
    documentId: v.id('documents'),
    /** 1-based, and clamped against `pageCount` server-side on every write. */
    page: v.number(),
    /** What the reader called it. Absent means the page number speaks for it. */
    label: v.optional(v.string()),
    createdAt: v.number(),
    /**
     * When the row last changed, which it had no way of saying.
     *
     * A bookmark was write-once apart from its label, so nothing needed this
     * until a device had to ask "what has moved since I was last online". It is
     * optional because every bookmark made before now has no answer, and those
     * fall back to `createdAt`.
     */
    updatedAt: v.optional(v.number()),
    /** See `documents.clientUpdatedAt`. Guards the rename against a stale one. */
    clientUpdatedAt: v.optional(v.number()),
  })
    // "Is this page already marked?" — one lookup rather than a scan, and the
    // toggle in the reader asks it on every page turn.
    .index('by_document_and_page', ['documentId', 'page'])
    // The list, in the order they were made.
    .index('by_document', ['documentId', 'createdAt'])
    // Every mark in the account, for a device rebuilding its own copy. The
    // denormalised `ownerId` was already here for the ownership check; this is
    // the index that makes it answerable in one query rather than one per
    // document.
    .index('by_owner', ['ownerId', 'createdAt']),

  /**
   * A passage kept out of a document, or a note written about a page of it.
   *
   * **There are no coordinates, and that is a fact about the renderer rather
   * than an omission.** `react-native-pdf` reports selected text and nothing
   * else: `onTextSelectionChange` hands back a string, and `onPageSingleTap`
   * hands back `MotionEvent.getX()` — where a finger touched the *view*, which
   * is a different space from the page and stops meaning anything the moment
   * somebody scrolls or zooms. There is no page-rect API and no overlay hook.
   * So a highlight cannot be painted where the words are, and this table does
   * not pretend it can: an annotation is a page, the words, and what the reader
   * made of them. `rect` is here, optional and unwritten, so the day a renderer
   * supplies one there is a column to put it in rather than a migration.
   *
   * A table rather than an array on `documents`, for the reason the guidelines
   * give and `documentBookmarks` cites: an unbounded list inside a document
   * grows into the 1 MB limit and rewrites the whole row on every append.
   *
   * `ownerId` is denormalised, as on `documentBookmarks`, so a row can be
   * owner-checked without fetching the document behind it.
   */
  documentAnnotations: defineTable({
    ownerId: v.id('users'),
    documentId: v.id('documents'),
    /** 1-based, and clamped against `pageCount` server-side on every write. */
    page: v.number(),

    /**
     * Which of the two it is.
     *
     * `passage` came off a selection and carries the document's words;
     * `note` was written against a page and carries only the reader's. The
     * distinction is worth storing rather than deriving from which field is
     * absent, because a passage the reader later annotates has both.
     */
    kind: v.union(v.literal('passage'), v.literal('note')),

    /** The document's words. Absent on a `note`, bounded by `ANNOTATION_TEXT_MAX`. */
    text: v.optional(v.string()),
    /** The reader's words. Absent until they write some. */
    note: v.optional(v.string()),

    /**
     * Where on the page, if anything ever knows.
     *
     * Never written today — see the note above. Kept optional and unread so
     * that adding a renderer which reports quads is a client change rather than
     * a schema migration over everybody's annotations.
     */
    rect: v.optional(
      v.object({
        x: v.number(),
        y: v.number(),
        width: v.number(),
        height: v.number(),
      }),
    ),

    /**
     * The id the device gave this note before the account had one.
     *
     * `Annotations.add` is the one create in this backend that was documented
     * as deliberately not idempotent, which was correct while every call came
     * from a person tapping a button. An outbox that can deliver the same
     * operation twice makes that a duplicated note, so the device's own id is
     * recorded and looked up first.
     */
    clientOpId: v.optional(v.string()),
    /** See `documents.clientUpdatedAt`. Guards an edit against a stale one. */
    clientUpdatedAt: v.optional(v.number()),

    /**
     * Who wrote it, which stopped being the same question as who owns it.
     *
     * `ownerId` still means the document's owner, and has to: it is what the
     * delete cascade walks, so an annotation written by a recipient on somebody
     * else's document has to be reachable from that document's owner or it
     * survives the document. `authorId` is the person whose words these are.
     *
     * Optional because every annotation written before sharing existed was
     * written by the owner, and `authorId ?? ownerId` is the correct reading of
     * a missing value rather than a guess at one.
     */
    authorId: v.optional(v.id('users')),

    /**
     * Whether anybody else on this document sees it.
     *
     * `private` is the default and the only value an unshared document ever
     * has. `shared` is what an annotator's note is, because a note nobody can
     * read is not collaboration — but it stays an explicit field rather than
     * being inferred from `authorId !== ownerId`, so that an owner can keep
     * their own reading notes to themselves on a document they have shared out.
     */
    visibility: v.optional(v.union(v.literal('private'), v.literal('shared'))),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // The list, which reads in page order because that is the order somebody
    // moving through a book wants to step through their own marks in.
    .index('by_document', ['documentId', 'page'])
    // One person's marks on one document — what an annotator's own list is, and
    // what has to be removed when their access is. Without it, revoking would
    // read every annotation on the document to find the handful that are theirs.
    .index('by_document_and_author', ['documentId', 'authorId'])
    // Everything one person wrote, anywhere. The reconcile walk for a recipient:
    // their notes on a shared document carry the *document owner's* `ownerId`,
    // so `by_owner` cannot see them and a device would sync its own writing
    // exactly once and then lose track of it.
    .index('by_author', ['authorId', 'createdAt'])
    // The count and the delete cascade, which do not care about page order.
    // Two orders need two indexes; the guidelines are explicit about it.
    .index('by_document_and_created', ['documentId', 'createdAt'])
    // "Have I already stored this one?" — the idempotency lookup, once per
    // queued create.
    .index('by_owner_and_op', ['ownerId', 'clientOpId'])
    // Every note in the account, for a device rebuilding its own copy.
    .index('by_owner', ['ownerId', 'createdAt']),

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
    /** The id the device gave it. See `documentAnnotations.clientOpId`. */
    clientOpId: v.optional(v.string()),
    /** See `documents.clientUpdatedAt`. Guards a rename against a stale one. */
    clientUpdatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_owner', ['ownerId'])
    .index('by_owner_and_op', ['ownerId', 'clientOpId']),

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
    .index('by_collection_and_document', ['collectionId', 'documentId'])
    // The whole relation, for a device rebuilding its copy of the library. The
    // denormalised `ownerId` was already here for the ownership check; this is
    // what makes it answerable in one paged query rather than one per folder.
    .index('by_owner', ['ownerId', 'addedAt']),

  /* ── sharing ───────────────────────────────────────────────────────
   *
   * Every table above answers "what does this account own". These answer
   * "who else may open it", which is a different question and deliberately
   * a different set of rows: `documents.ownerId` never changes when a
   * document is shared, and there is no second copy of anything.
   *
   * The decomposition is identity → membership → access. Collapsing it into
   * one "shared PDF" row is what turns a person leaving a group into a
   * hundred rows somebody has to remember to delete.
   * ------------------------------------------------------------------ */

  /**
   * A named set of people, so a document can be shared with all of them at once.
   *
   * It owns no documents. A group appears in `documentShares` exactly like a
   * person does, and membership is resolved at the moment access is asked for —
   * which is what makes leaving a group take its documents with it, with no
   * cascade to run and nothing to forget.
   */
  groups: defineTable({
    ownerId: v.id('users'),
    name: v.string(),

    /**
     * Denormalised, for the same reason `collections.documentCount` is: the
     * groups list renders a count per row, and `.collect().length` over
     * `groupMembers` would be one unbounded read per row per render. Convex has
     * no count operator; a maintained counter is the documented answer.
     *
     * `Groups.addMember` and `Groups.removeMember` are the only writers.
     */
    memberCount: v.number(),

    /** The id the device gave it. See `documentAnnotations.clientOpId`. */
    clientOpId: v.optional(v.string()),
    clientUpdatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_owner', ['ownerId'])
    .index('by_owner_and_op', ['ownerId', 'clientOpId']),

  /**
   * One person in one group.
   *
   * `userId` rather than an invitation by email: somebody has to have an
   * account before they can be added, because the whole point of the row is to
   * resolve to an identity Convex has verified. There is no pending-member
   * state — an invitation to a group is a `shareInvitations`-shaped problem
   * this schema deliberately does not have, and adding somebody who has not
   * agreed is prevented by their own `allowGroupInvites` instead.
   */
  groupMembers: defineTable({
    groupId: v.id('groups'),
    userId: v.id('users'),

    /**
     * `admin` can add and remove members and rename the group. `member` can
     * leave it. The group's `ownerId` is a third thing and is not stored here:
     * an owner who demoted themselves out of their own group would be a group
     * nobody can administer.
     */
    role: v.union(v.literal('admin'), v.literal('member')),

    /** Who did it. Kept so a member can see how they got here. */
    addedBy: v.id('users'),
    addedAt: v.number(),
  })
    // "Is this person in this group?" — asked on every access resolution that
    // goes through a group share, so it has to be one lookup rather than a scan.
    .index('by_group_and_user', ['groupId', 'userId'])
    // The member list, and the fan-out walk when a document is shared with the
    // group. Paged: a group can hold GROUP_MEMBER_MAX people.
    .index('by_group_and_added', ['groupId', 'addedAt'])
    // "Which groups am I in?" — the caller's own graph, which is what bounds
    // `Discovery.searchWithinGraph` and what the groups list reads.
    .index('by_user', ['userId', 'addedAt']),

  /**
   * Permission for one document, granted to one person or one group.
   *
   * This is the whole of sharing. It is resolved on every read rather than
   * cached into anything, so revoking is immediate everywhere the server is in
   * the loop — and reaches nothing that has already been downloaded, which the
   * UI says out loud rather than implying otherwise.
   */
  documentShares: defineTable({
    documentId: v.id('documents'),

    /**
     * The document's owner, denormalised.
     *
     * A recipient-scoped read needs to name who shared with them, and without
     * this every row in the inbox would be a second fetch of a document the
     * recipient may not even be allowed to read yet. It is written from the
     * document row at insert and never from an argument.
     */
    ownerId: v.id('users'),

    /**
     * Who performed this share, which is not always the owner.
     *
     * On a reshare it is the recipient who passed it on. Kept separately so
     * "shared by" can be honest, and so a reshare can be revoked by the person
     * who made it as well as by the owner.
     */
    createdBy: v.id('users'),

    /**
     * Exactly one of `recipientUserId` and `groupId` is set, and `subject` says
     * which. A discriminant rather than two nullable fields read in order,
     * because the two resolve through different indexes and a row that set
     * both would silently take whichever branch was written first.
     */
    subject: v.union(v.literal('user'), v.literal('group')),
    recipientUserId: v.optional(v.id('users')),
    groupId: v.optional(v.id('groups')),

    /**
     * What they may do with the document itself.
     *
     * Two values, not a ladder of five. `annotator` is `viewer` plus the right
     * to write annotations against the document; anything more — renaming it,
     * filing it, deleting it — belongs to the owner and is not expressible
     * here on purpose.
     */
    role: v.union(v.literal('viewer'), v.literal('annotator')),

    /**
     * Whether they may put the file on their own device.
     *
     * Separate from `role` because it is the one permission that survives being
     * taken away. Everything else here stops the moment the row changes; a
     * downloaded PDF is a file on a disk this deployment cannot reach. Default
     * false, asked for per share, and stated in the dialog rather than
     * discovered afterwards.
     */
    canDownload: v.boolean(),

    /**
     * Whether they may share it on.
     *
     * A reshare is capped at what the resharer holds — never a higher role,
     * never a wider `canDownload`, and never `canReshare` again. See
     * `Sharing.requireResharable`.
     */
    canReshare: v.boolean(),

    /**
     * `pending` until the recipient answers. `accepted` is the only state that
     * grants anything: an unanswered share is a notification and a title, and
     * nothing is downloaded under it.
     *
     * `expired` is written by the nightly sweep as well as being derived from
     * `expiresAt`, so a stale row reads correctly in a list without every
     * reader recomputing it.
     */
    status: v.union(
      v.literal('pending'),
      v.literal('accepted'),
      v.literal('declined'),
      v.literal('revoked'),
      v.literal('expired'),
    ),

    /** A line to the recipient. Bounded by `SHARE_MESSAGE_MAX`, cleaned like a title. */
    message: v.optional(v.string()),

    /** Absent means it does not expire. Checked on every resolution, not only on the sweep. */
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    respondedAt: v.optional(v.number()),

    /** See `documentAnnotations.clientOpId`. A share queued offline is delivered once. */
    clientOpId: v.optional(v.string()),
    clientUpdatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // Manage Access: everybody this document is shared with, newest last.
    .index('by_document', ['documentId', 'createdAt'])
    // "Does this person already have this document?" — the idempotency check on
    // a create, and the first branch of every access resolution.
    .index('by_document_and_recipient', ['documentId', 'recipientUserId'])
    // The inbox, split by state so Pending is not a filter over everything.
    .index('by_recipient_and_status', ['recipientUserId', 'status'])
    // The recipient's reconcile walk — the mirror of `documents.by_owner_and_updated`.
    // A device coming back online asks what moved, oldest change first, paged.
    .index('by_recipient_and_updated', ['recipientUserId', 'updatedAt'])
    // The second branch of access resolution, and the cascade when a group is
    // deleted. Ordered by document so one group's shares read as a list.
    .index('by_group', ['groupId', 'documentId'])
    // What the sender sees under "Sent", and their own reconcile walk.
    .index('by_owner_and_updated', ['ownerId', 'updatedAt'])
    // The idempotency lookup for a share the device queued while offline.
    .index('by_owner_and_op', ['ownerId', 'clientOpId'])
    // The expiry sweep. `status` first because it is the equality — only
    // `accepted` and `pending` rows can expire — and `expiresAt` orders within
    // it, so the sweep reads exactly the rows that are due and stops.
    //
    // Expiry is enforced by this transition rather than by comparing a clock on
    // every read: a Convex query is not re-run because time passed, so a query
    // that decided a share was live at subscribe time would go on saying so.
    // Flipping `status` is a write, and a write invalidates every subscription
    // that read the row. See `Sharing.expireDue`.
    .index('by_status_and_expiry', ['status', 'expiresAt']),

  /**
   * Something that happened, addressed to one person.
   *
   * The in-app inbox, and the record a push is sent against. It exists
   * separately from `documentShares` because a share produces several events
   * over its life — offered, accepted, revoked — and because an event that was
   * never delivered has to be re-sendable without touching the permission.
   *
   * It carries no title and no message text. Everything a screen renders is
   * fetched through an authenticated query at the moment it renders, so a row
   * here cannot become a copy of a document's contents that outlives access
   * to that document.
   */
  shareEvents: defineTable({
    userId: v.id('users'),
    kind: v.union(
      v.literal('shareOffered'),
      v.literal('shareAccepted'),
      v.literal('shareDeclined'),
      v.literal('accessRevoked'),
      v.literal('accessChanged'),
      v.literal('groupJoined'),
      v.literal('groupDocumentShared'),
      v.literal('annotationAdded'),
    ),
    shareId: v.optional(v.id('documentShares')),
    documentId: v.optional(v.id('documents')),
    groupId: v.optional(v.id('groups')),
    /** Who caused it. Rendered as an avatar and a name, through the same projection search uses. */
    actorId: v.optional(v.id('users')),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    // The list, newest first.
    .index('by_user_and_created', ['userId', 'createdAt'])
    // The unread count on the Shared row, without reading the whole history.
    // `readAt` first because it is the equality; `createdAt` orders within it.
    .index('by_user_and_read', ['userId', 'readAt', 'createdAt'])
    // The cascade when a share or a document goes.
    .index('by_share', ['shareId']),

  /**
   * One installation that can receive a push.
   *
   * A row per device rather than per account, because that is what Expo's push
   * service addresses and what has to be deleted when it answers
   * `DeviceNotRegistered`. The token is infrastructure data: it identifies a
   * device to a third party, it is cycled by the OS, and it is never returned
   * to any client — including the device that registered it.
   */
  deviceTokens: defineTable({
    userId: v.id('users'),
    /** An `ExpoPushToken[...]`. Never leaves the deployment except toward Expo. */
    token: v.string(),
    platform: v.union(v.literal('ios'), v.literal('android')),
    /** For the settings screen, so somebody can tell two phones apart. */
    deviceName: v.optional(v.string()),
    appVersion: v.optional(v.string()),
    /**
     * Turned off by the notification settings rather than deleted, so that
     * switching notifications back on does not require the OS permission
     * dance again. A delete here means the token is dead, not muted.
     */
    enabled: v.boolean(),
    lastSeenAt: v.number(),
    createdAt: v.number(),
    /** When Expo last told us this token is gone. The sweep deletes on it. */
    failedAt: v.optional(v.number()),
  })
    // Everything to send to, for one recipient.
    .index('by_user', ['userId'])
    // Registration is an upsert: the same device re-registering must not
    // insert a second row, and a token that moved to another account must
    // move rather than duplicate.
    .index('by_token', ['token']),

  /**
   * What one account wants to be told about.
   *
   * A row only exists once somebody has changed something. Defaults live in
   * `Notifications.defaults` rather than in the row, so a reader who has never
   * opened the screen is covered by code that can be corrected in one place
   * rather than by a backfill over every account.
   */
  notificationSettings: defineTable({
    userId: v.id('users'),
    /** The master switch. False means nothing is sent, whatever the rest say. */
    allow: v.boolean(),
    documentShares: v.boolean(),
    shareResponses: v.boolean(),
    groupActivity: v.boolean(),
    annotationActivity: v.boolean(),
    /**
     * Minutes past local midnight, or absent for no quiet hours.
     *
     * Minutes rather than a timestamp because the reader means "at night",
     * which is a time of day and not an instant. A window that wraps midnight
     * is the normal case, so `start > end` is valid and is what the check
     * handles first.
     */
    quietStartMinute: v.optional(v.number()),
    quietEndMinute: v.optional(v.number()),
    /** Minutes east of UTC, sent by the device. Only ever used to read the two above. */
    utcOffsetMinutes: v.optional(v.number()),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),

  /**
   * Who may reach this account, and what a share of theirs starts as.
   *
   * Same absent-row-means-defaults rule as `notificationSettings`. The two
   * defaults worth naming: `findableBy` is `anyone`, because a sharing system
   * nobody can be found in does not work and finding is an exact match rather
   * than a listing; `defaultCanDownload` and `defaultCanReshare` are false,
   * because those are the two that survive being taken away.
   *
   * There is no `autoAcceptFromGroups`, and its absence is deliberate. A group
   * share is one row resolved through `groupMembers` at read time — that is the
   * whole reason groups exist, and it means membership *is* the acceptance.
   * There is no per-member state for a setting to govern, and a switch nothing
   * enforces reads as covered when it is not.
   */
  sharingSettings: defineTable({
    userId: v.id('users'),
    findableBy: v.union(v.literal('anyone'), v.literal('groups'), v.literal('nobody')),
    shareableBy: v.union(v.literal('anyone'), v.literal('groups'), v.literal('nobody')),
    defaultRole: v.union(v.literal('viewer'), v.literal('annotator')),
    defaultCanDownload: v.boolean(),
    defaultCanReshare: v.boolean(),
    /** Whether a heartbeat is recorded at all — not whether a screen hides it. */
    showOnlineStatus: v.boolean(),
    showReadingActivity: v.boolean(),
    allowGroupInvites: v.boolean(),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),

  /**
   * One attempt to push one event to one device.
   *
   * Expo's send call returns a ticket, and whether the notification actually
   * arrived is only knowable from a receipt fetched later — so a send is two
   * steps separated by about fifteen minutes, and something has to hold the
   * ticket in between. This is also what stops one dead token swallowing a
   * group's notifications: a failure is recorded against the row rather than
   * thrown out of the batch.
   */
  pushDeliveries: defineTable({
    eventId: v.id('shareEvents'),
    userId: v.id('users'),
    tokenId: v.id('deviceTokens'),
    ticketId: v.optional(v.string()),
    status: v.union(
      v.literal('queued'),
      v.literal('sent'),
      v.literal('delivered'),
      v.literal('failed'),
    ),
    /** Expo's error code — `DeviceNotRegistered`, `MessageTooBig`, and so on. A code, never a message. */
    error: v.optional(v.string()),
    sentAt: v.number(),
    receiptAt: v.optional(v.number()),
  })
    // The receipt poll: everything sent and not yet resolved, oldest first.
    .index('by_status_and_sent', ['status', 'sentAt'])
    // The cascade when a token is deleted, and "did this event reach anybody?".
    .index('by_token', ['tokenId'])
    .index('by_event', ['eventId']),
});
