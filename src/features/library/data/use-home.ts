import { useCallback, useMemo, useState } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';

import { RAIL_LIMIT } from '@convex/model/limits';
import { useLocalLibraryStore } from '@/stores/local-library-store';
import { useSyncStore } from '@/stores/sync-store';

import * as Collections from '../local/repository/collections';
import * as Documents from '../local/repository/documents';
import * as Shares from '../local/repository/shares';
import type {
  LibraryCollection,
  LibraryDocument,
  LibraryShare,
} from '../local/repository/types';
import { useLocalQuery } from '../local/use-local-query';
import { useSyncNow } from '../sync/use-sync-engine';
import { useCoverSync } from './use-cover-sync';
import { useLibraryStatus } from './use-library-status';
import { useTextMirror } from './use-text-mirror';

/**
 * Everything the home screen renders.
 *
 * **One source now, where there used to be three.** It read a live Convex
 * query, a filesystem scan and a persisted copy of the last answer, and joined
 * them here — which is why the offline path was a different shape from the
 * online one, why "On this device" was assembled twice, and why the all-library
 * screen next door could not do any of it. All six rails are one read of the
 * device's own database, and being online only changes how often that database
 * is refreshed.
 */

export type HomeSection =
  | {
      kind: 'documents';
      id: string;
      title: string;
      documents: LibraryDocument[];
      showProgress: boolean;
    }
  | {
      kind: 'collections';
      id: string;
      title: string;
      collections: LibraryCollection[];
    }
  /**
   * Documents other people sent, before any of them is on this device.
   *
   * Its own kind rather than a `documents` rail, because a share is not a
   * `LibraryDocument` yet — there is no local row and no file, only a title, a
   * size and a name. A rail that pretended otherwise would be a rail of covers
   * for files that are not here.
   */
  | {
      kind: 'shares';
      id: string;
      title: string;
      shares: LibraryShare[];
      waiting: number;
    };

export type HomeState = {
  sections: HomeSection[];
  /** True until the device has answered. Distinct from "the library is empty". */
  loading: boolean;
  /** Nothing at all here — the empty state, not an empty rail. */
  isEmpty: boolean;
  /** The account is not answering. */
  offline: boolean;
  /** Signed in on a remembered account, with no token to reach the backend. */
  offlineIdentity: boolean;
  /**
   * This device has never finished a sync.
   *
   * The one case where an empty library is not an empty library: a phone signed
   * in a moment ago and disconnected before the first reconcile has nothing to
   * show and nothing wrong with it.
   */
  neverSynced: boolean;
  /** When the account was last read in full. `null` until it has been. */
  lastSyncedAt: number | null;
  /** No network at all, as opposed to a backend that is not answering. */
  hasNetwork: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
};

type Rails = {
  continueReading: LibraryDocument[];
  recentlyAdded: LibraryDocument[];
  favorites: LibraryDocument[];
  finished: LibraryDocument[];
  onDevice: LibraryDocument[];
  collections: LibraryCollection[];
  /** Live grants from other people. Not documents yet — see `HomeSection`. */
  shared: LibraryShare[];
  total: number;
};

/** The tables these rails are built from. Anything else writing is not our business. */
const TABLES = [
  'documents',
  'documentFiles',
  'collections',
  'collectionDocuments',
  'shares',
] as const;

export function useHome(): HomeState {
  const { offline, offlineIdentity, hasNetwork, profileId } = useLibraryStatus();
  const scan = useLocalLibraryStore((state) => state.scan);
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt);
  const syncNow = useSyncNow();
  const [refreshing, setRefreshing] = useState(false);

  const read = useCallback(
    async (db: SQLiteDatabase): Promise<Rails> => ({
      continueReading: await Documents.continueReading(db),
      recentlyAdded: await Documents.recentlyAdded(db),
      favorites: await Documents.favorites(db),
      finished: await Documents.finished(db),
      onDevice: await Documents.onThisDevice(db),
      collections: await Collections.listCollections(db),
      // Waiting first, then the rest: the ones with somebody at the other end
      // are the ones worth putting in front of the reader.
      shared: (await Shares.incoming(db))
        .filter((share) => share.status === 'pending' || share.status === 'accepted')
        .sort((a, b) =>
          a.status === b.status ? b.updatedAt - a.updatedAt : a.status === 'pending' ? -1 : 1,
        )
        .slice(0, RAIL_LIMIT),
      total: await Documents.documentCount(db),
    }),
    [],
  );

  const { data, loading } = useLocalQuery(profileId, TABLES, read);

  const refresh = useCallback(async () => {
    if (profileId === null) {
      return;
    }
    setRefreshing(true);
    try {
      // Two things a pull can genuinely refresh now: what is on the disk, and
      // what the account has to say. Neither is a websocket, which is what made
      // the old version of this theatre.
      await scan(profileId);
      await syncNow();
    } finally {
      setRefreshing(false);
    }
  }, [profileId, scan, syncNow]);

  const everything = useMemo<LibraryDocument[]>(
    () =>
      data === null
        ? []
        : [...data.continueReading, ...data.recentlyAdded, ...data.favorites, ...data.finished],
    [data],
  );

  useCoverSync(everything);
  // The other thing the account has that the device wants on disk. Same footing
  // as covers: quiet, sequential, once per document, and never urgent.
  useTextMirror(everything);

  const sections = useMemo<HomeSection[]>(() => {
    if (data === null) {
      return [];
    }

    const candidates: HomeSection[] = [
      // Above Continue reading, because an unanswered share is the one thing on
      // this screen with somebody waiting at the other end of it.
      {
        kind: 'shares',
        id: 'shared',
        title: 'Shared with you',
        shares: data.shared,
        waiting: data.shared.filter((share) => share.status === 'pending').length,
      },
      {
        kind: 'documents',
        id: 'continue',
        title: 'Continue reading',
        documents: data.continueReading,
        showProgress: true,
      },
      {
        kind: 'documents',
        id: 'recent',
        title: 'Recently added',
        documents: data.recentlyAdded,
        showProgress: false,
      },
      {
        kind: 'documents',
        id: 'favorites',
        title: 'Favourites',
        documents: data.favorites,
        showProgress: false,
      },
      {
        kind: 'documents',
        id: 'device',
        title: 'On this device',
        documents: data.onDevice,
        showProgress: false,
      },
      {
        kind: 'collections',
        id: 'collections',
        title: 'Collections',
        collections: data.collections,
      },
      {
        kind: 'documents',
        id: 'finished',
        title: 'Finished',
        documents: data.finished,
        showProgress: false,
      },
    ];

    // A rail with nothing in it renders nothing at all. Six empty headings is
    // what a dashboard does; this screen would rather be shorter.
    return candidates.filter((section) =>
      section.kind === 'documents'
        ? section.documents.length > 0
        : section.kind === 'shares'
          ? section.shares.length > 0
          : section.collections.length > 0,
    );
  }, [data]);

  const isEmpty = data !== null && data.total === 0 && data.collections.length === 0;

  return {
    sections,
    loading,
    isEmpty,
    offline,
    offlineIdentity,
    neverSynced: lastSyncedAt === null,
    lastSyncedAt,
    hasNetwork,
    refreshing,
    refresh,
  };
}
