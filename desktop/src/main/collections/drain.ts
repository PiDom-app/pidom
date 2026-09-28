import PQueue from 'p-queue';
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';

import type { SessionManager } from '../auth/oauth';
import { getDb } from '../db';
import { collections, collectionItems, documentsCache, syncQueue, type SyncQueueRow } from '../db/schema';
import { StorageConvex } from '../storage/convex-client';
import { accountKey, isLocalCollectionId, isSafeCollectionId } from '../storage/paths';

/**
 * The organization outbox drainer — Phase D of the local-first layer.
 *
 * It is to `CollectionsService` what the import pipeline's network advance is to
 * staging: every offline organization write is recorded in `sync_queue` beside
 * the local-table change it represents, and this replays those rows against the
 * SAME owner-checked Convex functions the renderer used to call directly, then
 * pulls the account's truth back into the local mirror. Nothing here trusts the
 * renderer — it only ever reads rows this device itself wrote.
 *
 * Ordering guarantees the whole design rests on:
 *   - Replay is FIFO by `created_at`, so a collection's `create` always reaches
 *     Convex before the `addDocuments` that names it.
 *   - A `col_<hex>` placeholder id is reconciled to the returned Convex id across
 *     `collections`, `collection_items`, and every still-pending payload the
 *     instant its create syncs — exactly as the import drainer re-keys
 *     `localId → documentId`.
 *   - Replay runs BEFORE hydrate within one serialized pass, so a just-created
 *     collection is already local under its real id before the server snapshot
 *     that also carries it is merged in (no primary-key collision, no lost edit).
 *
 * Idempotency holds on both ends: the server dedups a replayed create on
 * `clientOpId` and settles rename/favorite/finished by `clientUpdatedAt`
 * (last-writer-wins), and the local `uniqueIndex` collapses a double membership.
 * So a replay retried after a dropped reply never duplicates anything.
 */

/** How many times a failing op is retried across reconnects before it is parked.
 *  A parked ('failed', attempts ≥ cap) op stops burning tokens until an explicit
 *  action re-queues it, bounding a poison op from looping forever. */
const MAX_ATTEMPTS = 8;

/** Membership/snapshot hydration page size. Bounded, like every read in the app. */
const PAGE = 200;

/** The parsed shape of an outbox payload. Ids were validated before enqueue; this
 *  only narrows types for the replay switch, it never re-authorizes. */
type Payload = Record<string, unknown>;

export class CollectionsDrainer {
  private readonly session: SessionManager;
  private readonly convex: StorageConvex;
  private readonly onChanged: () => void;
  /** Concurrency 1: one replay/hydrate pass at a time, so re-keys and the
   *  replay-before-hydrate ordering are never interleaved by a second drain. */
  private readonly queue = new PQueue({ concurrency: 1 });

  constructor(session: SessionManager, onChanged: () => void) {
    this.session = session;
    this.convex = new StorageConvex(session);
    this.onChanged = onChanged;
  }

  /** Replay the outbox only. Fire-and-forget after a local write, so an edit made
   *  while online reaches Convex promptly without re-pulling the whole account. */
  flush(): Promise<void> {
    return this.queue.add(() => this.replay()) as Promise<void>;
  }

  /** Replay the outbox, then pull the account's truth into the mirror. Run on boot
   *  and on every sign-in — the moments a device may have missed remote changes. */
  sync(): Promise<void> {
    return this.queue.add(async () => {
      await this.replay();
      await this.hydrate();
    }) as Promise<void>;
  }

  // ---- outbox replay -------------------------------------------------------

  private async replay(): Promise<void> {
    if (this.session.getState().status !== 'signed-in') return;
    const db = getDb();

    // Crash recovery: an 'inflight' row is from a killed pass; a 'failed' row under
    // the attempt cap gets a fresh chance on this reconnect. Both return to
    // 'pending' so the loop below reconsiders them in FIFO order.
    const now = Date.now();
    db.update(syncQueue).set({ state: 'pending', updatedAt: now }).where(eq(syncQueue.state, 'inflight')).run();
    db.update(syncQueue)
      .set({ state: 'pending', updatedAt: now })
      .where(and(eq(syncQueue.state, 'failed'), lt(syncQueue.attempts, MAX_ATTEMPTS)))
      .run();

    // Process oldest-first, re-reading each pass so a reconcile's payload re-key is
    // seen by the dependent op that follows. `skipped` holds ops whose create has
    // not synced yet, so the loop advances instead of spinning on them.
    const skipped = new Set<string>();
    for (;;) {
      if (this.session.getState().status !== 'signed-in') return;
      const op = db
        .select()
        .from(syncQueue)
        .where(eq(syncQueue.state, 'pending'))
        .orderBy(asc(syncQueue.createdAt))
        .all()
        .find((row) => !skipped.has(row.opId));
      if (!op) break;
      const held = await this.replayOne(op);
      if (held) skipped.add(op.opId);
    }
    this.onChanged();
  }

  /**
   * Replays one op. Returns true when the op must WAIT (its collection's create
   * has not synced, so its `col_<hex>` id is not yet a Convex id) — it is left
   * pending for a later pass. Marks the row `done` on success, `failed` (short
   * code + bumped attempt count) on a server/network error.
   */
  private async replayOne(op: SyncQueueRow): Promise<boolean> {
    const db = getDb();
    const payload = parsePayload(op.payload);
    if (!payload) {
      // A payload we cannot parse can never succeed; park it rather than loop.
      this.failOp(op.opId, 'bad-payload');
      return false;
    }

    const clock = op.clientUpdatedAt ?? Date.now();
    db.update(syncQueue).set({ state: 'inflight', updatedAt: Date.now() }).where(eq(syncQueue.opId, op.opId)).run();

    try {
      switch (op.kind) {
        case 'collection.create': {
          const localId = String(payload.localId ?? '');
          const name = String(payload.name ?? '');
          const remoteId = await this.convex.createCollection(name, op.opId, clock);
          if (!isSafeCollectionId(remoteId) || isLocalCollectionId(remoteId)) throw new Error('bad remote id');
          this.reconcile(localId, remoteId);
          break;
        }
        case 'collection.rename': {
          const collectionId = String(payload.collectionId ?? '');
          if (isLocalCollectionId(collectionId)) return this.hold(op.opId);
          await this.convex.renameCollection(collectionId, String(payload.name ?? ''), clock);
          break;
        }
        case 'collection.remove': {
          const collectionId = String(payload.collectionId ?? '');
          if (isLocalCollectionId(collectionId)) return this.hold(op.opId);
          await this.convex.removeCollection(collectionId);
          break;
        }
        case 'collection.addDocuments': {
          const collectionId = String(payload.collectionId ?? '');
          if (isLocalCollectionId(collectionId)) return this.hold(op.opId);
          await this.convex.addDocumentsToCollection(collectionId, asIds(payload.documentIds));
          break;
        }
        case 'collection.removeDocuments': {
          const collectionId = String(payload.collectionId ?? '');
          if (isLocalCollectionId(collectionId)) return this.hold(op.opId);
          await this.convex.removeDocumentsFromCollection(collectionId, asIds(payload.documentIds));
          break;
        }
        case 'library.setFavorite': {
          await this.convex.setFavoriteMany(asIds(payload.documentIds), Boolean(payload.isFavorite));
          break;
        }
        case 'library.setFinished': {
          await this.convex.setFinishedMany(asIds(payload.documentIds), Boolean(payload.isFinished));
          break;
        }
        default: {
          // An unknown kind cannot be replayed; park it.
          this.failOp(op.opId, 'unknown-kind');
          return false;
        }
      }
      db.update(syncQueue).set({ state: 'done', error: null, updatedAt: Date.now() }).where(eq(syncQueue.opId, op.opId)).run();
      return false;
    } catch (error) {
      this.failOp(op.opId, opErrorCode(error));
      return false;
    }
  }

  /** Return an op to 'pending' because a dependency has not synced yet, and tell
   *  the loop to skip it this pass (it retries next drain, after the create lands). */
  private hold(opId: string): boolean {
    getDb().update(syncQueue).set({ state: 'pending', updatedAt: Date.now() }).where(eq(syncQueue.opId, opId)).run();
    return true;
  }

  private failOp(opId: string, code: string): void {
    getDb()
      .update(syncQueue)
      .set({ state: 'failed', error: code, attempts: sql`${syncQueue.attempts} + 1`, updatedAt: Date.now() })
      .where(eq(syncQueue.opId, opId))
      .run();
  }

  /**
   * Re-keys a `col_<hex>` placeholder to the Convex id its create just minted,
   * across the collection row, its memberships, and every still-pending payload
   * that names it — after which dependent ops replay against the real id. Tolerant
   * of a partial prior run: a vanished `col_` row makes every step a no-op.
   */
  private reconcile(localId: string, remoteId: string): void {
    if (!localId || localId === remoteId) return;
    getDb().transaction((tx) => {
      tx.update(collections)
        .set({ id: remoteId, isSynced: true, clientOpId: null, updatedAt: Date.now() })
        .where(eq(collections.id, localId))
        .run();
      tx.update(collectionItems).set({ collectionId: remoteId }).where(eq(collectionItems.collectionId, localId)).run();
      const rows = tx.select().from(syncQueue).where(inArray(syncQueue.state, ['pending', 'inflight', 'failed'])).all();
      for (const row of rows) {
        const p = parsePayload(row.payload);
        if (p && p.collectionId === localId) {
          p.collectionId = remoteId;
          tx.update(syncQueue).set({ payload: JSON.stringify(p) }).where(eq(syncQueue.opId, row.opId)).run();
        }
      }
    });
  }

  // ---- hydration (pull the account's truth into the mirror) ----------------

  private async hydrate(): Promise<void> {
    const owner = this.owner();
    if (!owner) return;
    const db = getDb();

    const remote = await this.convex.listCollections();
    const stamp = Date.now();
    db.transaction((tx) => {
      for (const c of remote) {
        tx.insert(collections)
          .values({
            id: c.id,
            ownerId: owner,
            name: c.name,
            documentCount: c.documentCount,
            createdAt: c.createdAt,
            updatedAt: stamp,
            isSynced: true,
          })
          .onConflictDoUpdate({
            target: collections.id,
            set: { name: c.name, documentCount: c.documentCount, isSynced: true, updatedAt: stamp },
          })
          .run();
      }
    });

    // Membership is additive: `onConflictDoNothing` on the (collection, document)
    // unique index means a row we already hold — or added offline and have not yet
    // drained — is never disturbed by the server snapshot.
    let cursor: string | null = null;
    for (;;) {
      const { page, isDone, continueCursor } = await this.convex.membershipPage(cursor, PAGE);
      db.transaction((tx) => {
        for (const m of page) {
          tx.insert(collectionItems)
            .values({ collectionId: m.collectionId, documentId: m.documentId, ownerId: owner, addedAt: m.addedAt })
            .onConflictDoNothing()
            .run();
        }
      });
      if (isDone) break;
      cursor = continueCursor;
    }

    // Favorite/finished mirror. Replay ran first, so any pending toggle already
    // reached the server and this pulls back the settled truth.
    let docCursor: string | null = null;
    for (;;) {
      const { page, isDone, continueCursor } = await this.convex.snapshotPage(docCursor, PAGE);
      db.transaction((tx) => {
        for (const d of page) {
          const at = Date.now();
          tx.insert(documentsCache)
            .values({
              id: d.id,
              ownerId: owner,
              title: d.title,
              author: d.author,
              pageCount: d.pageCount,
              byteSize: d.byteSize,
              currentPage: d.currentPage,
              progress: d.progress,
              isFinished: d.isFinished,
              isFavorite: d.isFavorite,
              isSynced: d.isSynced,
              updatedAt: at,
            })
            .onConflictDoUpdate({
              target: documentsCache.id,
              set: {
                title: d.title,
                author: d.author,
                pageCount: d.pageCount,
                byteSize: d.byteSize,
                currentPage: d.currentPage,
                progress: d.progress,
                isFinished: d.isFinished,
                isFavorite: d.isFavorite,
                isSynced: d.isSynced,
                updatedAt: at,
              },
            })
            .run();
        }
      });
      if (isDone) break;
      docCursor = continueCursor;
    }

    this.onChanged();
  }

  private owner(): string | null {
    const subject = this.session.getState().profile?.subject ?? null;
    return subject ? accountKey(subject) : null;
  }
}

/** Parses an outbox payload, returning null for anything that is not a JSON
 *  object — a corrupt row is parked, never trusted as instructions. */
function parsePayload(raw: string): Payload | null {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? (value as Payload) : null;
  } catch {
    return null;
  }
}

/** Narrows a payload field to a string id array. Ids were validated at enqueue;
 *  this only re-narrows the JSON-parsed shape for the typed Convex call. */
function asIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Maps an error to a short, non-sensitive code. Never a server body, path, or
 *  URL — the outbox stores only what is safe to surface to the renderer. */
function opErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('signed in')) return 'signed-out';
  if (message.includes('FORBIDDEN')) return 'forbidden';
  if (/rate|RATE_LIMIT/.test(message)) return 'rate-limited';
  if (message.includes('bad remote id')) return 'bad-remote-id';
  return 'sync-failed';
}
