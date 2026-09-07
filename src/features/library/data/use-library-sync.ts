import { useQuery } from 'convex/react';
import { useEffect } from 'react';

import { api } from '@convex/_generated/api';
import { log } from '@/lib/logger';

import { database } from '../local/db';
import * as Collections from '../local/repository/collections';
import * as Documents from '../local/repository/documents';
import { useLibraryStatus } from './use-library-status';

const SCOPE = 'library-sync';

/**
 * Keeps the device's copy current while the app is open and connected.
 *
 * The sync engine's reconcile is the complete pass — every document, every
 * mark, every collection, paged — and it runs on a reconnect and on a
 * heartbeat. This is the other half: one live Convex subscription that upserts
 * into the local database whenever the account changes, so a book favourited on
 * a tablet appears on the phone in the same second rather than at the next
 * heartbeat.
 *
 * **It is not what the screens read.** Nothing here returns anything. The rails
 * are drawn from SQLite whatever is happening on the socket, and this is a
 * writer into that database like any other — which is the whole point of the
 * arrangement: there is one shape of data on the screen, and being online only
 * changes how often it is refreshed.
 *
 * Mount once, in the authenticated layout.
 */
export function useLibrarySync(): void {
  const { ready, profileId } = useLibraryStatus();

  const home = useQuery(api.library.home, ready ? {} : 'skip');

  useEffect(() => {
    if (home === undefined || profileId === null) {
      return;
    }

    let live = true;

    void (async () => {
      const db = await database(profileId);
      if (db === null || !live) {
        return;
      }

      try {
        // Deliberately no pruning here. This answer is six rails of twelve,
        // not the library — a document missing from it has almost certainly
        // just fallen off the end of a rail. Working out what was *deleted*
        // needs the whole account, and that is the reconcile's job.
        const seen = new Set<string>();
        for (const document of [
          ...home.continueReading,
          ...home.recentlyAdded,
          ...home.favorites,
          ...home.finished,
        ]) {
          if (seen.has(document.id)) {
            continue;
          }
          seen.add(document.id);
          await Documents.upsertFromRemote(db, document);
        }

        for (const collection of home.collections) {
          await Collections.upsertRemoteCollection(db, collection);
        }
      } catch (error) {
        log.debug(SCOPE, 'could not bring the account answer down', error);
      }
    })();

    return () => {
      live = false;
    };
  }, [home, profileId]);
}
