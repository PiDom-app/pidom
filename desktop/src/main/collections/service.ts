import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';

import { BULK_MAX, COLLECTION_NAME_MAX } from '@convex-model/limits';
import type { CollectionSummary, CollectionsSnapshot } from '../../shared/ipc';
import type { SessionManager } from '../auth/oauth';
import { getDb } from '../db';
import { collections, collectionItems, documentsCache, syncQueue, type SyncOpKind } from '../db/schema';
import {
  accountKey,
  isLocalCollectionId,
  isSafeCollectionId,
  isSafeDocumentId,
  mintCollectionId,
  mintLocalId,
} from '../storage/paths';
import { CollectionsDrainer } from './drain';

/** The Drizzle handle and its transaction scope, derived from the factory so no
 *  driver-specific type import is needed (`node:sqlite` stays main-process only). */
type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * The offline-first organization service — Phase D's local source of truth.
 *
 * It is to collections/favorites/finished what `ImportService` is to files: every
 * write lands in the local SQLite mirror AND an outbox row in one transaction, so
 * the change is instant and survives with no network; a `CollectionsDrainer`
 * replays the outbox to the SAME owner-checked Convex functions on reconnect and
 * pulls the account's truth back. The renderer reaches this only through the
 * narrow `collections` IPC namespace — one typed method per op, never raw SQL.
 *
 * Owner scoping is local defence in depth: every row carries `accountKey(subject)`
 * and every read/write is filtered by it, so two accounts on one computer never
 * see each other's organization. Real authorization is still server-side — the
 * drainer's replays are owner-checked by Convex exactly as the renderer's direct
 * calls were. Writes throw when signed out (there is no account to organize);
 * reads return empty rather than throw, so the UI renders cleanly before sign-in.
 *
 * All local writes use Drizzle's parameterized builder — a name such as
 * `Research' OR 1=1 --` is stored and compared as a literal, never SQL.
 */
export class CollectionsService {
  private readonly session: SessionManager;
  private readonly drainer: CollectionsDrainer;
  private readonly listeners = new Set<() => void>();
  /** A per-device monotonic clock: strictly increasing even within one millisecond,
   *  so the outbox FIFO (`created_at`) is stable and last-writer-wins
   *  (`clientUpdatedAt`) never ties two edits this device made back-to-back. */
  private lastStamp = 0;

  constructor(session: SessionManager) {
    this.session = session;
    this.drainer = new CollectionsDrainer(session, () => this.notify());
    // The moment auth returns, replay anything queued offline and pull the
    // account's truth into the mirror — the collections analogue of the import
    // service's sign-in drain.
    this.session.onChange((state) => {
      if (state.status === 'signed-in') void this.drainer.sync();
    });
  }

  /** Subscribe to mirror/outbox changes. The IPC layer coalesces these into a
   *  single `collections:changed` broadcast carrying a fresh snapshot. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Replay the outbox and hydrate the mirror. Called on boot; also fires on every
   *  sign-in via the constructor subscription. */
  sync(): Promise<void> {
    return this.drainer.sync();
  }

  // ---- reads (offline-safe; empty when signed out) -------------------------

  /** Every collection this account holds, newest last, with its denormalised count. */
  list(): CollectionSummary[] {
    const owner = this.ownerOrNull();
    if (!owner) return [];
    return getDb()
      .select()
      .from(collections)
      .where(eq(collections.ownerId, owner))
      .orderBy(asc(collections.createdAt))
      .all()
      .map((r) => ({ id: r.id, name: r.name, documentCount: r.documentCount, isSynced: r.isSynced }));
  }

  /** The ids of the collections a document belongs to — the picker's checkmarks. */
  forDocument(documentId: string): string[] {
    const owner = this.ownerOrNull();
    if (!owner || !isSafeDocumentId(documentId)) return [];
    return getDb()
      .select({ collectionId: collectionItems.collectionId })
      .from(collectionItems)
      .where(and(eq(collectionItems.ownerId, owner), eq(collectionItems.documentId, documentId)))
      .all()
      .map((r) => r.collectionId);
  }

  /** How many outbox rows are waiting to sync — drives the "Changes will sync" chip. */
  pending(): number {
    return getDb()
      .select({ opId: syncQueue.opId })
      .from(syncQueue)
      .where(inArray(syncQueue.state, ['pending', 'inflight']))
      .all().length;
  }

  /** The full renderer-facing view: the collection list plus the pending count. */
  snapshot(): CollectionsSnapshot {
    return { collections: this.list(), pending: this.pending() };
  }

  // ---- writes (local mirror + outbox row, one transaction) -----------------

  /** Creates a collection under a client-minted `col_<hex>` id and queues its
   *  create. The returned summary lets the renderer file documents into it at
   *  once — the drainer re-keys the placeholder to the Convex id when it syncs. */
  create(name: string): CollectionSummary {
    const owner = this.requireOwner();
    const clean = cleanName(name);
    const id = mintCollectionId();
    const opId = mintLocalId();
    const stamp = this.nextStamp();
    getDb().transaction((tx) => {
      tx.insert(collections)
        .values({
          id,
          ownerId: owner,
          name: clean,
          documentCount: 0,
          clientOpId: opId,
          clientUpdatedAt: stamp,
          createdAt: stamp,
          updatedAt: stamp,
          isSynced: false,
        })
        .run();
      this.enqueue(tx, opId, 'collection.create', { localId: id, name: clean }, stamp, stamp);
    });
    this.after();
    return { id, name: clean, documentCount: 0, isSynced: false };
  }

  /** Renames a collection this account owns. Last-writer-wins server-side on the
   *  device clock; a foreign or unknown id is a no-op (nothing local to change). */
  rename(collectionId: string, name: string): void {
    const owner = this.requireOwner();
    this.assertCollectionId(collectionId);
    const clean = cleanName(name);
    const stamp = this.nextStamp();
    const db = getDb();
    const exists = db
      .select({ id: collections.id })
      .from(collections)
      .where(and(eq(collections.id, collectionId), eq(collections.ownerId, owner)))
      .get();
    if (!exists) return;
    db.transaction((tx) => {
      tx.update(collections)
        .set({ name: clean, clientUpdatedAt: stamp, updatedAt: stamp })
        .where(and(eq(collections.id, collectionId), eq(collections.ownerId, owner)))
        .run();
      this.enqueue(tx, mintLocalId(), 'collection.rename', { collectionId, name: clean }, stamp, stamp);
    });
    this.after();
  }

  /** Deletes a collection (its documents survive). A never-synced `col_<hex>`
   *  collection queues no remote remove — instead its pending create and every
   *  op naming it are dropped, so nothing replays for a folder the server never
   *  knew. A synced collection queues an owner-checked remote remove. */
  remove(collectionId: string): void {
    const owner = this.requireOwner();
    this.assertCollectionId(collectionId);
    const db = getDb();
    const row = db
      .select()
      .from(collections)
      .where(and(eq(collections.id, collectionId), eq(collections.ownerId, owner)))
      .get();
    if (!row) return;
    db.transaction((tx) => {
      tx.delete(collectionItems)
        .where(and(eq(collectionItems.collectionId, collectionId), eq(collectionItems.ownerId, owner)))
        .run();
      tx.delete(collections).where(and(eq(collections.id, collectionId), eq(collections.ownerId, owner))).run();
      if (isLocalCollectionId(collectionId)) {
        this.dropQueuedOps(tx, collectionId, row.clientOpId);
      } else {
        this.enqueue(tx, mintLocalId(), 'collection.remove', { collectionId }, this.nextStamp(), this.nextStamp());
      }
    });
    this.after();
  }

  /** Files documents into a collection. Only genuinely-new memberships are written
   *  (the `uniqueIndex` would collapse a duplicate anyway) and the denormalised
   *  count moves by exactly that many; the full requested set is queued, since the
   *  server's add is idempotent. A no-op when nothing changes locally. */
  addDocuments(collectionId: string, documentIds: string[]): void {
    const owner = this.requireOwner();
    this.assertCollectionId(collectionId);
    const ids = this.assertDocumentIds(documentIds);
    const stamp = this.nextStamp();
    getDb().transaction((tx) => {
      const coll = tx
        .select({ id: collections.id })
        .from(collections)
        .where(and(eq(collections.id, collectionId), eq(collections.ownerId, owner)))
        .get();
      if (!coll) return;
      const existing = tx
        .select({ documentId: collectionItems.documentId })
        .from(collectionItems)
        .where(and(eq(collectionItems.collectionId, collectionId), inArray(collectionItems.documentId, ids)))
        .all();
      const have = new Set(existing.map((e) => e.documentId));
      const toAdd = ids.filter((id) => !have.has(id));
      if (toAdd.length === 0) return;
      for (const documentId of toAdd) {
        tx.insert(collectionItems)
          .values({ collectionId, documentId, ownerId: owner, addedAt: stamp })
          .onConflictDoNothing()
          .run();
      }
      tx.update(collections)
        .set({ documentCount: sql`${collections.documentCount} + ${toAdd.length}`, updatedAt: stamp })
        .where(and(eq(collections.id, collectionId), eq(collections.ownerId, owner)))
        .run();
      this.enqueue(tx, mintLocalId(), 'collection.addDocuments', { collectionId, documentIds: ids }, null, stamp);
    });
    this.after();
  }

  /** Removes documents from a collection, clamping the count at zero. The full
   *  requested set is queued (the server's remove is idempotent); a no-op when
   *  none of the ids were members. */
  removeDocuments(collectionId: string, documentIds: string[]): void {
    const owner = this.requireOwner();
    this.assertCollectionId(collectionId);
    const ids = this.assertDocumentIds(documentIds);
    const stamp = this.nextStamp();
    getDb().transaction((tx) => {
      const coll = tx
        .select({ id: collections.id })
        .from(collections)
        .where(and(eq(collections.id, collectionId), eq(collections.ownerId, owner)))
        .get();
      if (!coll) return;
      const existing = tx
        .select({ documentId: collectionItems.documentId })
        .from(collectionItems)
        .where(and(eq(collectionItems.collectionId, collectionId), inArray(collectionItems.documentId, ids)))
        .all();
      const toRemove = existing.map((e) => e.documentId);
      if (toRemove.length === 0) return;
      tx.delete(collectionItems)
        .where(and(eq(collectionItems.collectionId, collectionId), inArray(collectionItems.documentId, toRemove)))
        .run();
      tx.update(collections)
        .set({ documentCount: sql`max(0, ${collections.documentCount} - ${toRemove.length})`, updatedAt: stamp })
        .where(and(eq(collections.id, collectionId), eq(collections.ownerId, owner)))
        .run();
      this.enqueue(tx, mintLocalId(), 'collection.removeDocuments', { collectionId, documentIds: ids }, null, stamp);
    });
    this.after();
  }

  /** Sets favorite on a bounded set of documents. The local mirror reflects it for
   *  rows already present (title is NOT NULL, so this never invents a row); the
   *  server settles by the device clock (last-writer-wins). */
  setFavorite(documentIds: string[], isFavorite: boolean): void {
    const owner = this.requireOwner();
    const ids = this.assertDocumentIds(documentIds);
    const stamp = this.nextStamp();
    getDb().transaction((tx) => {
      tx.update(documentsCache)
        .set({ isFavorite, updatedAt: stamp })
        .where(and(eq(documentsCache.ownerId, owner), inArray(documentsCache.id, ids)))
        .run();
      this.enqueue(tx, mintLocalId(), 'library.setFavorite', { documentIds: ids, isFavorite }, stamp, stamp);
    });
    this.after();
  }

  /** Marks a bounded set of documents finished/unread. Same local/LWW posture as
   *  `setFavorite`. */
  setFinished(documentIds: string[], isFinished: boolean): void {
    const owner = this.requireOwner();
    const ids = this.assertDocumentIds(documentIds);
    const stamp = this.nextStamp();
    getDb().transaction((tx) => {
      tx.update(documentsCache)
        .set({ isFinished, updatedAt: stamp })
        .where(and(eq(documentsCache.ownerId, owner), inArray(documentsCache.id, ids)))
        .run();
      this.enqueue(tx, mintLocalId(), 'library.setFinished', { documentIds: ids, isFinished }, stamp, stamp);
    });
    this.after();
  }

  // ---- internals -----------------------------------------------------------

  /** Enqueues one outbox row. `payload` is JSON-serialised validated arguments —
   *  never a SQL string or path. `clientUpdatedAt` is the LWW clock for
   *  rename/favorite/finished and null for the set-merge membership ops. */
  private enqueue(
    tx: Tx,
    opId: string,
    kind: SyncOpKind,
    payload: Record<string, unknown>,
    clientUpdatedAt: number | null,
    createdAt: number,
  ): void {
    tx.insert(syncQueue)
      .values({
        opId,
        kind,
        payload: JSON.stringify(payload),
        clientUpdatedAt,
        state: 'pending',
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
      })
      .run();
  }

  /** Drops the queued create of a never-synced `col_<hex>` collection and every
   *  still-to-send op that names it, so nothing replays for a folder the server
   *  never knew about. `done` rows are left alone (a create that already reached
   *  the server is handled by the synced-id branch, not here). */
  private dropQueuedOps(tx: Tx, collectionId: string, createOpId: string | null): void {
    if (createOpId) {
      tx.delete(syncQueue).where(and(eq(syncQueue.opId, createOpId), ne(syncQueue.state, 'done'))).run();
    }
    const rows = tx.select().from(syncQueue).where(ne(syncQueue.state, 'done')).all();
    for (const row of rows) {
      const p = parseObject(row.payload);
      if (p && p.collectionId === collectionId) {
        tx.delete(syncQueue).where(eq(syncQueue.opId, row.opId)).run();
      }
    }
  }

  /** Notify local listeners, then kick a fire-and-forget replay. The replay no-ops
   *  when signed out, so an offline edit simply waits in the outbox. */
  private after(): void {
    this.notify();
    void this.drainer.flush();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private ownerOrNull(): string | null {
    const subject = this.session.getState().profile?.subject ?? null;
    return subject ? accountKey(subject) : null;
  }

  private requireOwner(): string {
    const owner = this.ownerOrNull();
    if (!owner) throw new Error('Not signed in.');
    return owner;
  }

  private assertCollectionId(id: string): void {
    if (!isSafeCollectionId(id)) throw new Error('collections rejected: bad collection id');
  }

  private assertDocumentIds(ids: unknown): string[] {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > BULK_MAX) {
      throw new Error('collections rejected: bad document id set');
    }
    for (const id of ids) {
      if (!isSafeDocumentId(id)) throw new Error('collections rejected: bad document id');
    }
    return ids as string[];
  }

  private nextStamp(): number {
    this.lastStamp = Math.max(Date.now(), this.lastStamp + 1);
    return this.lastStamp;
  }
}

/** Trims, strips control characters, collapses runs of whitespace, and bounds the
 *  length — the local mirror stays tidy while the server re-validates with
 *  `cleanText` on replay. Throws on a non-string or an empty result. */
function cleanName(name: unknown): string {
  if (typeof name !== 'string') throw new Error('collections rejected: bad name');
  const clean = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, COLLECTION_NAME_MAX);
  if (clean.length === 0) throw new Error('collections rejected: empty name');
  return clean;
}

/** Parses a stored outbox payload for the drop-ops scan, returning null for
 *  anything that is not a JSON object. */
function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
