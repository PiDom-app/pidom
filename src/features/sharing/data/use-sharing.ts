import { useCallback, useMemo } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';

import { useLibraryStatus } from '@/features/library/data/use-library-status';
import * as Groups from '@/features/library/local/repository/groups';
import * as Shares from '@/features/library/local/repository/shares';
import type {
  LibraryGroup,
  LibraryShare,
  LibraryShareEvent,
} from '@/features/library/local/repository/types';
import { useLocalQuery } from '@/features/library/local/use-local-query';

/**
 * What the sharing screens read.
 *
 * The device's own database, exactly like `use-home.ts` — not a Convex query.
 * That is what makes the inbox open in a tunnel: a share carries a copy of its
 * document's title and size, so there is something to draw before anything has
 * been fetched and long after the socket has gone.
 *
 * The account is still the authority on all of it. These rows are written by
 * the reconcile in `sync/engine.ts`, and every action a screen offers is
 * re-checked server-side before it grants anything — a stale local grant can
 * make a button appear and cannot make it work.
 */

const SHARE_TABLES = ['shares', 'documents'] as const;
const GROUP_TABLES = ['groupsLocal', 'groupMembersLocal'] as const;

export type Inbox = {
  incoming: LibraryShare[];
  pending: LibraryShare[];
  outgoing: LibraryShare[];
  loading: boolean;
};

export function useInbox(): Inbox {
  const { profileId } = useLibraryStatus();

  const read = useCallback(
    async (db: SQLiteDatabase) => ({
      incoming: await Shares.incoming(db),
      pending: await Shares.pending(db),
      outgoing: await Shares.outgoing(db),
    }),
    [],
  );

  const { data, loading } = useLocalQuery(profileId, SHARE_TABLES, read);

  return useMemo(
    () => ({
      incoming: data?.incoming ?? [],
      pending: data?.pending ?? [],
      outgoing: data?.outgoing ?? [],
      loading,
    }),
    [data, loading],
  );
}

export function useShare(shareId: string | null): { share: LibraryShare | null; loading: boolean } {
  const { profileId } = useLibraryStatus();

  const read = useCallback(
    async (db: SQLiteDatabase) => (shareId === null ? null : await Shares.shareById(db, shareId)),
    [shareId],
  );

  const { data, loading } = useLocalQuery(profileId, SHARE_TABLES, read);
  return { share: data ?? null, loading };
}

/**
 * The reader's own grant on a document, if it is not theirs.
 *
 * A hint for the chrome — whether to offer Share, whether a selection can
 * become a note — and never a gate. `null` means the document is the reader's
 * own or the device has not heard otherwise, and both of those render the same
 * way: as an ordinary document.
 */
export function useGrant(documentId: string | null): LibraryShare | null {
  const { profileId } = useLibraryStatus();

  const read = useCallback(
    async (db: SQLiteDatabase) =>
      documentId === null ? null : await Shares.grantFor(db, documentId),
    [documentId],
  );

  return useLocalQuery(profileId, SHARE_TABLES, read).data ?? null;
}

/**
 * Whether this document is shared at all, either way.
 *
 * The gate in front of presence. A document nobody shares does not get a
 * heartbeat, because presence on one is a mutation every ten seconds telling an
 * empty room that one person is in it.
 */
export function useIsShared(localId: string | null, remoteId: string | null): boolean {
  const { profileId } = useLibraryStatus();

  const read = useCallback(
    async (db: SQLiteDatabase) =>
      localId === null ? false : await Shares.isShared(db, localId, remoteId),
    [localId, remoteId],
  );

  return useLocalQuery(profileId, SHARE_TABLES, read).data ?? false;
}

export function useGroups(): { groups: LibraryGroup[]; loading: boolean } {
  const { profileId } = useLibraryStatus();
  const read = useCallback(async (db: SQLiteDatabase) => await Groups.listGroups(db), []);
  const { data, loading } = useLocalQuery(profileId, GROUP_TABLES, read);
  return { groups: data ?? [], loading };
}

export function useGroup(groupId: string | null) {
  const { profileId } = useLibraryStatus();

  const read = useCallback(
    async (db: SQLiteDatabase) => {
      if (groupId === null) {
        return null;
      }
      const group = await Groups.groupById(db, groupId);
      if (group === null) {
        return null;
      }
      return { group, members: await Groups.membersOf(db, group.id) };
    },
    [groupId],
  );

  const { data, loading } = useLocalQuery(profileId, GROUP_TABLES, read);
  return { group: data?.group ?? null, members: data?.members ?? [], loading };
}

/** The documents shared into one group, read off the local share rows. */
export function useGroupDocuments(groupId: string | null): LibraryShare[] {
  const { profileId } = useLibraryStatus();

  const read = useCallback(
    async (db: SQLiteDatabase) => {
      if (groupId === null) {
        return [];
      }
      const [incoming, outgoing] = await Promise.all([Shares.incoming(db), Shares.outgoing(db)]);
      return [...incoming, ...outgoing].filter((share) => share.groupId === groupId);
    },
    [groupId],
  );

  return useLocalQuery(profileId, SHARE_TABLES, read).data ?? [];
}

/** The in-app feed, mirrored so a cold launch with no connection still has one. */
export function useShareEvents(): { events: LibraryShareEvent[]; unread: number } {
  const { profileId } = useLibraryStatus();

  const read = useCallback(async (db: SQLiteDatabase) => {
    const rows = await db.getAllAsync<{
      id: string;
      kind: string;
      shareId: string | null;
      documentId: string | null;
      groupId: string | null;
      actorName: string | null;
      actorHandle: string | null;
      actorPicture: string | null;
      readAt: number | null;
      createdAt: number;
    }>(
      `SELECT id, kind, shareId, documentId, groupId, actorName, actorHandle, actorPicture,
              readAt, createdAt
         FROM shareEvents ORDER BY createdAt DESC LIMIT 50`,
    );
    return rows.map((row) => ({
      ...row,
      kind: row.kind as LibraryShareEvent['kind'],
      read: row.readAt !== null,
    }));
  }, []);

  const { data } = useLocalQuery(profileId, ['shareEvents'], read);
  const events = data ?? [];
  return { events, unread: events.filter((event) => !event.read).length };
}
