import type { SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useEffect } from 'react';

import { log } from '@/lib/logger';

import { useLibraryActions } from './use-library-actions';
import { useLibraryStatus } from './use-library-status';
import * as Documents from '../local/repository/documents';
import { useLocalQuery } from '../local/use-local-query';

const SCOPE = 'sync-intents';

const TABLES = ['documents'] as const;

/**
 * Uploads a reader asked for when there was nothing to upload to.
 *
 * The outbox cannot carry a transfer, and that is not a limitation of the queue
 * but a property of the mutation: `library.uploadUrl` deletes whatever object
 * is at the key before it signs a new URL, so an operation replayed against an
 * already-synced document destroys the copy in the account while the row goes
 * on claiming there is one. A queue that retries must never hold one.
 *
 * So an upload asked for with no connection — or asked for on a document the
 * account has not met yet, which is every document imported offline — is
 * recorded as an intention on the row. This is what performs it: once there is
 * a connection *and* the document's create has drained far enough to give it an
 * id in the account, the three requests run in the foreground, once.
 *
 * One at a time, and never on a cold library all at once: the reader asked for
 * this eventually, not urgently, and a dozen simultaneous uploads on a
 * reconnect is a burst nobody wanted.
 */
export function useSyncIntents(): void {
  const { offline, profileId } = useLibraryStatus();
  const { performUpload } = useLibraryActions();

  const read = useCallback(
    async (db: SQLiteDatabase) => await Documents.pendingUploads(db),
    [],
  );

  const { data } = useLocalQuery(profileId, TABLES, read);

  // A string rather than the array, so the effect compares by value: `data` is
  // rebuilt whenever anything in `documents` changes, and keying on it would
  // restart an upload on every page turn.
  const wanted = (data ?? []).map((row) => `${row.id}:${row.remoteId}`).join(',');

  useEffect(() => {
    if (wanted === '' || offline || profileId === null) {
      return;
    }

    let cancelled = false;

    void (async () => {
      for (const pair of wanted.split(',')) {
        if (cancelled) {
          return;
        }
        const [id, remoteId] = pair.split(':');
        if (id === undefined || remoteId === undefined || remoteId === '') {
          continue;
        }
        log.debug(SCOPE, 'performing an upload the reader asked for earlier');
        await performUpload(remoteId, id);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wanted, offline, profileId, performUpload]);
}
