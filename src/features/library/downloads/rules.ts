import type { SQLiteDatabase } from 'expo-sqlite';

import { preferencesNow } from '@/stores/preferences-store';

import * as Documents from '../local/repository/documents';
import * as Shares from '../local/repository/shares';
import * as Files from '../local/repository/files';

/**
 * The downloads nobody asked for individually.
 *
 * Three settings on the Downloads screen promise that certain documents will be
 * here without being tapped, and this is what makes that true. Writing the
 * settings without writing this is the failure `docs/security.md` names by
 * example: a switch wired to no behaviour is not a feature, it is a claim.
 *
 * Everything here only ever *queues*. It never transfers, never overrides a
 * hold, and never outranks a tap — `request(..., { byRule: true })` enters at
 * priority zero, so a reader who presses Download on the book they are about to
 * read is not behind four favourites a rule asked for while they were on a bus.
 * The Wi-Fi rule, the mobile-data ceiling and the disk check all still apply,
 * because `policy.ts` is asked at the moment of transfer rather than here.
 */

/**
 * One pass, cheap enough to run on every tick of the queue.
 *
 * Each rule reads at most a screenful of rows and enqueues what is missing.
 * `Files.enqueue` is idempotent — a document already queued, moving or here is
 * left exactly as it is — so running this repeatedly costs a query and nothing
 * else.
 */
export async function applyRules(db: SQLiteDatabase): Promise<void> {
  const prefs = preferencesNow();

  if (prefs.autoDownloadFavourites) {
    await queueAll(
      db,
      await Documents.listDocuments(db, {
        sort: 'opened',
        filter: 'favorites',
        limit: FAVOURITE_LIMIT,
        offset: 0,
      }),
    );
  }

  if (prefs.autoDownloadAccepted) {
    /**
     * Accepted shares, read as a state rather than caught as an event.
     *
     * The obvious design is a call from the accept button, and it does not
     * work: accepting writes the share row, and the `documents` row the
     * recipient will actually read comes down on the next reconcile — so the
     * event fires at a moment when there is nothing yet to queue, and the
     * setting silently does nothing. Which is precisely the failure this whole
     * file exists to avoid.
     *
     * Asking "is there an accepted share whose document is not here" instead
     * costs one query and is right whenever it is asked. It is also
     * self-correcting: access removed later makes the document unfetchable, the
     * account answers `FORBIDDEN`, and the queue settles the row rather than
     * retrying something that will never be allowed again.
     */
    const accepted = (await Shares.incoming(db)).filter((share) => share.status === 'accepted');
    for (const share of accepted) {
      if (share.documentId === null) {
        continue;
      }
      const document = await Documents.documentById(db, share.documentId);
      if (
        document !== null &&
        document.isSynced &&
        document.fileState === 'missing' &&
        share.canDownload
      ) {
        await Files.enqueue(db, document.id, { priority: 0, expectedBytes: document.byteSize });
      }
    }
  }

  if (prefs.keepRecent > 0) {
    await queueAll(
      db,
      await Documents.listDocuments(db, {
        sort: 'opened',
        filter: 'all',
        limit: prefs.keepRecent,
        offset: 0,
      }),
    );
  }
}

/**
 * How many favourites a rule will fetch.
 *
 * A ceiling rather than "all of them", because a reader who has hearted two
 * hundred books has not asked for two hundred downloads — they have asked for
 * their favourites to be to hand, and the fifty most recently opened is a far
 * better reading of that than eleven gigabytes. The storage limit would catch
 * it eventually; being caught by a limit is a worse outcome than not asking.
 */
const FAVOURITE_LIMIT = 50;

async function queueAll(
  db: SQLiteDatabase,
  documents: Awaited<ReturnType<typeof Documents.listDocuments>>,
): Promise<void> {
  for (const document of documents) {
    // Only what the account can actually supply, and only what is not already
    // here. A local-only document has no cloud copy to fetch, and a rule that
    // queued one would put a row in the queue that could never resolve.
    if (!document.isSynced || document.remoteId === null) {
      continue;
    }
    if (document.fileState !== 'missing') {
      continue;
    }
    /**
     * And only the reader's own documents.
     *
     * A document that arrived under a grant may or may not be downloadable —
     * `canDownload` is false by default and asked for per share — and a rule
     * that queued one without checking would be a loop with a bill attached:
     * the grant path refuses it, the queue settles the row back to `missing`,
     * the next pass sees a favourite that is not here and queues it again,
     * every iteration spending a token from the sender's rate bucket.
     *
     * The accepted-shares rule above is the one that may queue somebody else's
     * document, and it reads `canDownload` off the share before it does.
     */
    if (!document.ownedByMe) {
      continue;
    }
    await Files.enqueue(db, document.id, { priority: 0, expectedBytes: document.byteSize });
  }
}
