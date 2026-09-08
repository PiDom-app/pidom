import { useQuery } from 'convex/react';
import { useEffect } from 'react';

import { api } from '@convex/_generated/api';
import { useLibraryStatus } from '@/features/library/data/use-library-status';
import { database } from '@/features/library/local/db';
import * as Groups from '@/features/library/local/repository/groups';
import * as Shares from '@/features/library/local/repository/shares';
import { log } from '@/lib/logger';
import { inTransaction } from '@/features/library/local/transaction';

const SCOPE = 'sharing-sync';

/**
 * Keeps what other people have shared current while the app is open.
 *
 * **The other half of `use-library-sync.ts`, and it was missing.** The library
 * has had a live Convex subscription since the offline rewrite, so a book
 * favourited on a tablet appears on the phone in the same second. Sharing
 * shipped without one — every sharing screen reads SQLite, SQLite is written by
 * the reconcile, and the reconcile runs on a thirty-second heartbeat *and only
 * when the outbox is empty*. So a document somebody shared arrived somewhere
 * between instantly and never, and tapping a push while the app was already
 * open opened a screen whose row had not been written yet.
 *
 * Three subscriptions, because the account indexes the three answers
 * differently and merging them there would mean a scan: the inbox walks the
 * recipient's index, groups walk membership, and events are their own feed.
 * Locally they are three tables and one write path.
 *
 * **It is not what the screens read.** Nothing here returns anything, exactly
 * as `use-library-sync.ts` argues: the screens draw from SQLite whatever is
 * happening on the socket, and this is one more writer into that database.
 * Being online only changes how often it is refreshed.
 *
 * **And it does not prune.** A row missing from one of these answers has not
 * necessarily been deleted — `inbox` is bounded by `SHARE_LIST_LIMIT` and
 * `events` by fifty. Working out what actually went away needs the whole
 * account, which is the reconcile's job and stays the reconcile's job.
 *
 * Mount once, in the authenticated layout.
 */
export function useSharingSync(): void {
  const { ready, profileId } = useLibraryStatus();

  const inbox = useQuery(api.sharing.inbox, ready ? { filter: 'all' } : 'skip');
  const outbox = useQuery(api.sharing.outbox, ready ? {} : 'skip');
  const groups = useQuery(api.groups.list, ready ? {} : 'skip');
  const events = useQuery(api.sharing.events, ready ? { limit: 50 } : 'skip');

  useEffect(() => {
    if (inbox === undefined || outbox === undefined || profileId === null) {
      return;
    }
    let live = true;

    void (async () => {
      const db = await database(profileId);
      if (db === null || !live) {
        return;
      }
      try {
        for (const share of [...inbox, ...outbox]) {
          await Shares.upsertRemoteShare(db, {
            id: share.id,
            remoteId: share.id,
            documentId: share.document?.id ?? null,
            direction: share.direction,
            subject: share.subject,
            counterpartId: share.counterpart?.id ?? null,
            counterpartName: share.counterpart?.displayName ?? null,
            counterpartHandle: share.counterpart?.handle ?? null,
            counterpartPictureUrl: share.counterpart?.pictureUrl ?? null,
            groupId: share.group?.id ?? null,
            groupName: share.group?.name ?? null,
            title: share.document?.title ?? null,
            author: share.document?.author ?? null,
            pageCount: share.document?.pageCount ?? null,
            byteSize: share.document?.byteSize ?? 0,
            hasCover: share.document?.hasCover ?? false,
            role: share.role,
            canDownload: share.canDownload,
            canReshare: share.canReshare,
            status: share.status,
            message: share.message,
            expiresAt: share.expiresAt,
            revokedAt: share.revokedAt,
            createdAt: share.createdAt,
            updatedAt: share.updatedAt,
            clientUpdatedAt: 0,
            syncState: 'synced',
          });
        }
      } catch (error) {
        log.debug(SCOPE, 'could not bring the shares down', error);
      }
    })();

    return () => {
      live = false;
    };
  }, [inbox, outbox, profileId]);

  useEffect(() => {
    if (groups === undefined || profileId === null) {
      return;
    }
    let live = true;

    void (async () => {
      const db = await database(profileId);
      if (db === null || !live) {
        return;
      }
      try {
        // The group row only. Membership is a second round trip per group, so
        // it stays in the reconcile — a name and a count are what the list
        // renders, and a member joining is not something to spend a query per
        // group per change on.
        for (const group of groups) {
          await Groups.upsertRemoteGroup(db, {
            id: group.id,
            name: group.name,
            memberCount: group.memberCount,
            role: group.role,
            createdAt: group.createdAt,
            updatedAt: group.updatedAt,
          });
        }
      } catch (error) {
        log.debug(SCOPE, 'could not bring the groups down', error);
      }
    })();

    return () => {
      live = false;
    };
  }, [groups, profileId]);

  useEffect(() => {
    if (events === undefined || profileId === null) {
      return;
    }
    let live = true;

    void (async () => {
      const db = await database(profileId);
      if (db === null || !live) {
        return;
      }
      try {
        // Replaced wholesale rather than upserted. An event is immutable except
        // for whether it has been read, the account is the authority on both,
        // and fifty rows is a feed rather than an archive — a diff here would
        // be more code to keep two copies of the same list in step.
        await inTransaction(db, async (txn) => {
          await txn.runAsync('DELETE FROM shareEvents');
          for (const event of events) {
            await txn.runAsync(
              `INSERT INTO shareEvents (id, kind, shareId, documentId, groupId, actorName, actorHandle, actorPicture, readAt, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                event.id,
                event.kind,
                event.shareId,
                event.documentId,
                event.groupId,
                event.actor?.displayName ?? null,
                event.actor?.handle ?? null,
                event.actor?.pictureUrl ?? null,
                event.read ? event.createdAt : null,
                event.createdAt,
              ],
            );
          }
        });
      } catch (error) {
        log.debug(SCOPE, 'could not bring the activity down', error);
      }
    })();

    return () => {
      live = false;
    };
  }, [events, profileId]);
}
