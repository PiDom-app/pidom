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
}
