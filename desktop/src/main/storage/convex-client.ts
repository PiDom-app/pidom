import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';
import type { SessionManager } from '../auth/oauth';

/**
 * A main-process Convex client for the storage service.
 *
 * The renderer already mints signed download URLs through its own reactive
 * Convex client. The storage manager runs in main, though, where downloads
 * happen, and routing a signed URL back out to the renderer and in again would
 * be pointless and would put an R2 URL somewhere the CSP works to keep it out
 * of. So main holds its own client and mints the URL where it is used.
 *
 * Auth is the verified Google ID token from `SessionManager`, the same token
 * the renderer's client uses — Convex checks ownership server-side either way.
 * The token is fetched fresh per call (it may have refreshed), so this never
 * caches a credential of its own.
 *
 * `VITE_CONVEX_URL` is inlined into the main bundle by Vite via `import.meta.env`
 * (the main config's `envPrefix` includes `VITE_`), the same way `oauth.ts` reads
 * its `GOOGLE_*` values. It is not on `process.env` at runtime in a packaged app.
 */

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined;

export class StorageConvex {
  private readonly session: SessionManager;

  constructor(session: SessionManager) {
    this.session = session;
  }

  private async client(): Promise<ConvexHttpClient> {
    if (!CONVEX_URL) {
      throw new Error('VITE_CONVEX_URL is not set; cannot reach Convex from the main process.');
    }
    const token = await this.session.getIdToken(false);
    if (!token) throw new Error('Not signed in.');
    const client = new ConvexHttpClient(CONVEX_URL);
    client.setAuth(token);
    return client;
  }

  /** A five-minute signed R2 URL for a document's PDF, or null when unsynced.
   *  Owner-checked server-side by `library.downloadUrl`. */
  async documentUrl(documentId: string): Promise<string | null> {
    const client = await this.client();
    return client.mutation(api.library.downloadUrl, {
      documentId: documentId as Id<'documents'>,
      what: 'document',
    });
  }

  /**
   * Registers a desktop-imported file on the account and returns its Convex id.
   *
   * Idempotent on `localId` (the device-minted id we staged under): a resumed or
   * retried import re-calls this with the same key and gets the same document
   * back rather than a duplicate. The server also collapses a byte-identical file
   * onto an existing document via `fingerprint`, so a re-import never mints a
   * second row. No user id is passed — ownership comes from the verified token.
   */
  async importDocument(input: {
    title: string;
    byteSize: number;
    localId: string;
    fingerprint?: string;
    originalFileName?: string;
    author?: string;
    mimeType?: string;
    pageCount?: number;
    clientUpdatedAt?: number;
  }): Promise<string> {
    const client = await this.client();
    const id = await client.mutation(api.library.importDocument, {
      title: input.title,
      byteSize: input.byteSize,
      localId: input.localId,
      ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}),
      ...(input.originalFileName ? { originalFileName: input.originalFileName } : {}),
      ...(input.author ? { author: input.author } : {}),
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      ...(typeof input.pageCount === 'number' ? { pageCount: input.pageCount } : {}),
      ...(typeof input.clientUpdatedAt === 'number'
        ? { clientUpdatedAt: input.clientUpdatedAt }
        : {}),
    });
    return id as string;
  }

  /** A one-shot signed R2 PUT target for a document's PDF or cover: `{ key, url }`.
   *  Owner-checked server-side by `library.uploadUrl`. `what` mirrors the server's
   *  own noun so the desktop uploader can put a cover on the same terms mobile does. */
  async uploadUrl(
    documentId: string,
    what: 'document' | 'cover' = 'document',
  ): Promise<{ key: string; url: string }> {
    const client = await this.client();
    return client.mutation(api.library.uploadUrl, {
      documentId: documentId as Id<'documents'>,
      what,
    });
  }

  /** Records the uploaded R2 object's size/type/digest server-side. Must run
   *  after the PUT and before `attachUpload`, which reads that metadata back —
   *  the same ordering the mobile uploader relies on. */
  async syncMetadata(key: string): Promise<void> {
    const client = await this.client();
    await client.mutation(api.r2.syncMetadata, { key });
  }

  /** Attaches an uploaded PDF (and, when one was uploaded, its cover) to a
   *  document, moving it out of the pending state so it flows through `snapshot`
   *  like any synced doc. A cover is decoration: the server drops a bad one and
   *  keeps the PDF. Owner-checked. */
  async attachUpload(
    documentId: string,
    storageKey: string,
    opts?: { coverStorageKey?: string; pageCount?: number },
  ): Promise<void> {
    const client = await this.client();
    await client.mutation(api.library.attachUpload, {
      documentId: documentId as Id<'documents'>,
      storageKey,
      ...(opts?.coverStorageKey ? { coverStorageKey: opts.coverStorageKey } : {}),
      ...(typeof opts?.pageCount === 'number' ? { pageCount: opts.pageCount } : {}),
    });
  }

  /* ── organization outbox replay (see collections/drain.ts) ──────────────── */

  /**
   * Creates a collection on the account and returns its Convex id.
   *
   * Idempotent on `clientOpId` — the device-minted 32-hex id the outbox filed
   * this create under: a replayed create returns the row it made the first time
   * rather than a second folder (`convex/model/sync.ts` `collectionByOpId`).
   * `clientUpdatedAt` lets the server settle a concurrent rename by last-writer.
   */
  async createCollection(name: string, clientOpId: string, clientUpdatedAt: number): Promise<string> {
    const client = await this.client();
    const id = await client.mutation(api.collections.create, { name, clientOpId, clientUpdatedAt });
    return id as string;
  }

  /** Renames a collection. Owner-checked; last-writer-wins on `clientUpdatedAt`. */
  async renameCollection(collectionId: string, name: string, clientUpdatedAt: number): Promise<void> {
    const client = await this.client();
    await client.mutation(api.collections.rename, {
      collectionId: collectionId as Id<'collections'>,
      name,
      clientUpdatedAt,
    });
  }

  /** Deletes a collection and its memberships. The documents survive. Owner-checked. */
  async removeCollection(collectionId: string): Promise<void> {
    const client = await this.client();
    await client.mutation(api.collections.remove, {
      collectionId: collectionId as Id<'collections'>,
    });
  }

  /** Files a bounded set of documents into a collection in one call. Ownership of
   *  the collection and of every document is checked server-side. */
  async addDocumentsToCollection(collectionId: string, documentIds: string[]): Promise<void> {
    const client = await this.client();
    await client.mutation(api.collections.addDocuments, {
      collectionId: collectionId as Id<'collections'>,
      documentIds: documentIds as Id<'documents'>[],
    });
  }

  /** Removes a bounded set of documents from a collection in one call. Owner-checked. */
  async removeDocumentsFromCollection(collectionId: string, documentIds: string[]): Promise<void> {
    const client = await this.client();
    await client.mutation(api.collections.removeDocuments, {
      collectionId: collectionId as Id<'collections'>,
      documentIds: documentIds as Id<'documents'>[],
    });
  }

  /** Favourites/unfavourites a bounded set of documents in one call. Owner-checked. */
  async setFavoriteMany(documentIds: string[], isFavorite: boolean): Promise<void> {
    const client = await this.client();
    await client.mutation(api.library.setFavoriteMany, {
      documentIds: documentIds as Id<'documents'>[],
      isFavorite,
    });
  }

  /** Marks a bounded set of documents finished/unread in one call. Owner-checked. */
  async setFinishedMany(documentIds: string[], isFinished: boolean): Promise<void> {
    const client = await this.client();
    await client.mutation(api.library.setFinishedMany, {
      documentIds: documentIds as Id<'documents'>[],
      isFinished,
    });
  }

  /* ── hydration reads (pull the account's truth into the local mirror) ────── */

  /** Every collection on the account, with its denormalised document count. */
  async listCollections(): Promise<
    { id: string; name: string; documentCount: number; createdAt: number }[]
  > {
    const client = await this.client();
    const rows = await client.query(api.collections.list, {});
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name,
      documentCount: r.documentCount,
      createdAt: r.createdAt,
    }));
  }

  /** One page of the whole membership relation, for a device rebuilding its mirror. */
  async membershipPage(
    cursor: string | null,
    numItems: number,
  ): Promise<{
    page: { collectionId: string; documentId: string; addedAt: number }[];
    isDone: boolean;
    continueCursor: string;
  }> {
    const client = await this.client();
    const result = await client.query(api.collections.membership, {
      paginationOpts: { numItems, cursor },
    });
    return {
      page: result.page.map((m) => ({
        collectionId: m.collectionId as string,
        documentId: m.documentId as string,
        addedAt: m.addedAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  }

  /** One page of every document the account owns, for favorite/finished mirror. */
  async snapshotPage(
    cursor: string | null,
    numItems: number,
  ): Promise<{
    page: {
      id: string;
      title: string;
      author: string | null;
      pageCount: number | null;
      byteSize: number;
      currentPage: number;
      progress: number;
      isFinished: boolean;
      isFavorite: boolean;
      isSynced: boolean;
      createdAt: number;
    }[];
    isDone: boolean;
    continueCursor: string;
  }> {
    const client = await this.client();
    const result = await client.query(api.library.snapshot, {
      paginationOpts: { numItems, cursor },
    });
    return {
      page: result.page.map((d) => ({
        id: d.id as string,
        title: d.title,
        author: d.author,
        pageCount: d.pageCount,
        byteSize: d.byteSize,
        currentPage: d.currentPage,
        progress: d.progress,
        isFinished: d.isFinished,
        isFavorite: d.isFavorite,
        isSynced: d.isSynced,
        createdAt: d.createdAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  }
}
