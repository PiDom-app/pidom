import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Local cache schema. This mirrors a subset of the cloud document model
 * (convex/schema.ts `documents`) so the desktop app can list a library offline,
 * and tracks the physical local copy of each document this computer holds.
 *
 * It is a CACHE, not a source of truth — Convex owns the logical document and
 * every metadata field here is filled from an owner-checked query. What Convex
 * does NOT own is the physical file: its absolute path, its verified hash, and
 * whether the bytes are actually present on THIS machine. A path is useless to
 * another device, so it never leaves here, and `documents.storageKey`-style R2
 * keys never arrive here — the split the whole feature rests on.
 *
 * The DB holds only non-secret metadata (titles, sizes, hashes, states). The
 * PDFs live on disk under the managed library root with `0o600` perms, per
 * account. See src/main/storage/paths.ts and service.ts.
 */

/** The lifecycle of a physical local copy. Mirrors the mobile app's
 *  `documentFiles.state` so the two clients describe availability the same way.
 *  Never synced to the backend — the server cannot know a device's disk. */
export type LocalFileState =
  | 'queued' // wanted, not started
  | 'downloading' // bytes arriving
  | 'verifying' // downloaded, hashing / checking magic
  | 'available' // present and verified; opens with no network
  | 'paused' // interrupted, resumable
  | 'failed' // last attempt errored
  | 'outdated' // present but the cloud version moved on
  | 'missing'; // row exists, file is gone from disk

/** The lifecycle of a download job. One row per document being fetched. */
export type DownloadJobState = 'queued' | 'running' | 'paused' | 'failed' | 'done';

/**
 * The lifecycle of a desktop-initiated import. One row per file the reader adds
 * from this computer (file picker, folder scan, drag-drop, "Open With").
 *
 * The pipeline mirrors the mobile importer, but every step is durable here so a
 * killed run resumes: the file is staged and readable OFFLINE the moment it is
 * `staged`; the network steps (`registering`→`uploaded`) run when auth returns.
 *
 *   - staging     — bytes being copied + hashed into the library
 *   - staged      — on disk, verified, readable offline; not yet on the account
 *   - registering — calling `importDocument` to mint the Convex id
 *   - registered  — has a Convex id; the local copy re-keyed to it
 *   - uploading    — PUTting bytes to R2
 *   - uploaded    — bytes attached to the account document
 *   - done        — fully synced; the doc now flows through `snapshot`
 *   - failed      — last attempt errored (short code in `error`); retryable
 *   - duplicate   — collapsed onto a document this account already holds
 */
export type ImportJobState =
  | 'staging'
  | 'staged'
  | 'registering'
  | 'registered'
  | 'uploading'
  | 'uploaded'
  | 'done'
  | 'failed'
  | 'duplicate';

/**
 * The offline metadata mirror — a subset of the cloud `documents` row, enough to
 * render the library with no connection. Filled from `library.snapshot` /
 * `library.document`, both owner-checked.
 */
export const documentsCache = sqliteTable('documents_cache', {
  id: text('id').primaryKey(), // Convex document id
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  author: text('author'),
  pageCount: integer('page_count'),
  byteSize: integer('byte_size'),
  currentPage: integer('current_page').notNull().default(1),
  progress: real('progress').notNull().default(0),
  isFinished: integer('is_finished', { mode: 'boolean' }).notNull().default(false),
  isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
  /** Whether the account holds a cloud copy — i.e. this document can be downloaded. */
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
  updatedAt: integer('updated_at').notNull().default(0),
});

export type DocumentCacheRow = typeof documentsCache.$inferSelect;

/**
 * One physical local copy. The row exists once a download is wanted; `state`
 * says whether the bytes are actually here. `path` is this machine's absolute
 * path and never crosses IPC — the renderer addresses a document by its Convex
 * id, exactly as the reader already does.
 */
export const localFiles = sqliteTable(
  'local_files',
  {
    /** Convex document id. Also the key into documents_cache. */
    documentId: text('document_id').primaryKey(),
    /** Absolute path under the managed library root. Main-process only. */
    path: text('path'),
    /** sha256 of the bytes on disk, computed while streaming. */
    hash: text('hash'),
    /** Bytes actually written. */
    bytes: integer('bytes'),
    /** The cloud content hash observed when this copy was made, to detect drift. */
    version: text('version'),
    state: text('state').$type<LocalFileState>().notNull().default('queued'),
    updatedAt: integer('updated_at').notNull().default(0),
  },
  (t) => ({ byState: index('local_files_by_state').on(t.state) }),
);

export type LocalFileRow = typeof localFiles.$inferSelect;

/**
 * Download progress for a document being fetched. Separate from `local_files`
 * so a job's transient counters (received/total, attempts) do not churn the
 * durable file record, and so a killed run leaves an obvious resumable trace.
 * `error` is a short code, never a server message.
 */
export const downloadJobs = sqliteTable(
  'download_jobs',
  {
    documentId: text('document_id').primaryKey(),
    state: text('state').$type<DownloadJobState>().notNull().default('queued'),
    receivedBytes: integer('received_bytes').notNull().default(0),
    totalBytes: integer('total_bytes'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    updatedAt: integer('updated_at').notNull().default(0),
  },
  (t) => ({ byState: index('download_jobs_by_state').on(t.state) }),
);

export type DownloadJobRow = typeof downloadJobs.$inferSelect;

/**
 * One desktop-initiated import. Keyed by the device-minted `localId` so a killed
 * run resumes against the same row and the staged `<localId>.pdf` it names — the
 * exact idempotency the mobile importer relies on. `documentId` is null until the
 * `importDocument` call mints the Convex id; the physical copy lives in
 * `local_files` (keyed by `localId`, then re-keyed to `documentId` at reconcile).
 *
 * `fingerprint` mirrors the mobile edge/size fingerprint for the server's dedup;
 * `contentHash` is the full sha256 kept for our own exact-duplicate check before
 * we ever re-stage the same bytes. `error` is a short non-sensitive code.
 */
export const importJobs = sqliteTable(
  'import_jobs',
  {
    /** Device-minted 32-hex id; names the staged file and survives resume. */
    localId: text('local_id').primaryKey(),
    /** Sanitized picked filename, for presentation only. */
    title: text('title').notNull(),
    originalName: text('original_name'),
    byteSize: integer('byte_size').notNull(),
    /** Mobile `<size>-<sha256(head|"|size|"|tail)>` fingerprint, for server dedup. */
    fingerprint: text('fingerprint'),
    /** Full sha256 of the bytes on disk, for local exact-duplicate detection. */
    contentHash: text('content_hash'),
    pageCount: integer('page_count'),
    state: text('state').$type<ImportJobState>().notNull().default('staging'),
    /** Convex id once registered; null before. */
    documentId: text('document_id'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    updatedAt: integer('updated_at').notNull().default(0),
  },
  (t) => ({ byState: index('import_jobs_by_state').on(t.state) }),
);

export type ImportJobRow = typeof importJobs.$inferSelect;

/**
 * A tiny per-account key/value store for main-process settings that are about
 * *this machine* rather than the account — chiefly the chosen library root when
 * the reader moves it off the default location. Not secrets (those go through
 * `safeStorage`), just local paths and flags. Keyed by `accountKey`+`key` so two
 * accounts on one computer never read each other's location.
 */
export const localSettings = sqliteTable('local_settings', {
  /** `${accountKey}:${key}` — the account-scoped setting name. */
  id: text('id').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().default(0),
});

export type LocalSettingRow = typeof localSettings.$inferSelect;

/**
 * The local mirror of a collection — the offline source of truth for the
 * organization UI. Mirrors a subset of the cloud `collections` row
 * (convex/schema.ts) plus the fields the outbox needs to sync it.
 *
 * `id` is either a Convex collection id (once the create has synced) or a
 * client-minted `col_<32hex>` id worn while the collection exists only on this
 * device. `clientOpId` is the 32-hex idempotency key of the create op that will
 * mint it on the server — sent as `clientOpId` so a lost create reply cannot
 * produce two folders (see convex/model/sync.ts `collectionByOpId`). Once the
 * create drains, the drainer re-keys `col_<hex>` → the returned Convex id across
 * this table, `collection_items`, and any still-pending `sync_queue` payloads,
 * exactly as the import pipeline re-keys `localId` → `documentId`.
 *
 * `document_count` is denormalised to match the cloud model so the list renders
 * a count with no membership scan; it is kept in step with `collection_items`
 * by the service inside the same transaction that writes them.
 */
export const collections = sqliteTable(
  'collections',
  {
    /** Convex collection id, or a client-minted `col_<32hex>` while unsynced. */
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    name: text('name').notNull(),
    documentCount: integer('document_count').notNull().default(0),
    /** 32-hex idempotency key of the create op; sent to the server as clientOpId. */
    clientOpId: text('client_op_id'),
    /** The device clock for last-writer-wins on rename (server honors it via isStale). */
    clientUpdatedAt: integer('client_updated_at'),
    createdAt: integer('created_at').notNull().default(0),
    updatedAt: integer('updated_at').notNull().default(0),
    /** False while the id is still a `col_<hex>` placeholder awaiting reconcile. */
    isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => ({ byOwner: index('collections_by_owner').on(t.ownerId) }),
);

export type CollectionRow = typeof collections.$inferSelect;

/**
 * A local membership row: one document in one collection. The uniqueness the
 * brief calls for is enforced by the database, not just app code — a
 * `uniqueIndex` on (`collection_id`, `document_id`) makes a double-add a no-op at
 * the storage layer (upsert `onConflictDoNothing`), mirroring the server's
 * idempotent `by_collection_and_document` check. `by_document` backs "which
 * collections is this document in".
 */
export const collectionItems = sqliteTable(
  'collection_items',
  {
    collectionId: text('collection_id').notNull(),
    documentId: text('document_id').notNull(),
    ownerId: text('owner_id').notNull(),
    addedAt: integer('added_at').notNull().default(0),
  },
  (t) => ({
    unique: uniqueIndex('collection_items_unique').on(t.collectionId, t.documentId),
    byDocument: index('collection_items_by_document').on(t.documentId),
  }),
);

export type CollectionItemRow = typeof collectionItems.$inferSelect;

/**
 * The kinds of organization write the outbox replays. Each maps to an existing
 * owner-checked Convex mutation; the drainer knows how to send each one. The
 * `col_<hex>`-bearing kinds (`create` and anything naming a collection) have
 * their ids reconciled before or during replay.
 */
export type SyncOpKind =
  | 'collection.create'
  | 'collection.rename'
  | 'collection.remove'
  | 'collection.addDocuments'
  | 'collection.removeDocuments'
  | 'library.setFavorite'
  | 'library.setFinished';

/** The lifecycle of an outbox row. Mirrors the import job states' spirit:
 *  durable, resumable, and drained on boot + reconnect. */
export type SyncOpState = 'pending' | 'inflight' | 'done' | 'failed';

/**
 * The offline outbox. Every organization write is recorded here in one
 * transaction with the local-table change it represents, then replayed against
 * Convex when a connection is available — so a change made with no network is
 * never lost. `op_id` is a device-minted 32-hex idempotency key: for a
 * `collection.create` it becomes the server `clientOpId`, and the server dedups
 * a replayed create on it. `payload` is a JSON string of the op's arguments
 * (validated ids only — never a SQL string or path). Processed FIFO by
 * `created_at`, so a collection's create always replays before the adds that
 * name it.
 */
export const syncQueue = sqliteTable(
  'sync_queue',
  {
    /** Device-minted 32-hex idempotency key. */
    opId: text('op_id').primaryKey(),
    kind: text('kind').$type<SyncOpKind>().notNull(),
    /** JSON string of the op arguments; ids are validated before enqueue. */
    payload: text('payload').notNull(),
    /** Device clock for last-writer-wins ops (rename/favorite/finished). */
    clientUpdatedAt: integer('client_updated_at'),
    state: text('state').$type<SyncOpState>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** Short non-sensitive error code from the last failed replay. */
    error: text('error'),
    createdAt: integer('created_at').notNull().default(0),
    updatedAt: integer('updated_at').notNull().default(0),
  },
  (t) => ({ byState: index('sync_queue_by_state').on(t.state) }),
);

export type SyncQueueRow = typeof syncQueue.$inferSelect;
