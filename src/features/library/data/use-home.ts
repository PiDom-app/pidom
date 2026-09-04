import { useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { IDS_MAX, RAIL_LIMIT } from '@convex/model/limits';
import { useLibraryCacheStore, type CachedHome } from '@/stores/library-cache-store';
import { useLocalLibraryStore } from '@/stores/local-library-store';

import { removeLocally } from '../local/import';
import type { LibraryCollection, LibraryDocument } from './types';
import { useCoverSync } from './use-cover-sync';
import { useTextMirror } from './use-text-mirror';
import { useLibraryStatus } from './use-library-status';

/**
 * Everything the home screen renders.
 *
 * Three sources, joined here rather than in the components: Convex answers what
 * the account owns, the filesystem answers what this phone holds, and a
 * persisted copy of the last answer stands in when Convex cannot be reached.
 * None of the three can answer another's half, which is the whole architecture
 * of the screen.
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
    };

export type HomeState = {
  sections: HomeSection[];
  /** True until the first answer arrives. Distinct from "the library is empty". */
  loading: boolean;
  /** The account owns nothing at all — the empty state, not an empty rail. */
  isEmpty: boolean;
  /** Convex is not answering. With no cache behind it, this is what to say. */
  offline: boolean;
  /** Rendering from the cache because Convex is not answering. */
  stale: boolean;
  /** When the cache was written, for the notice. `null` when live. */
  staleAt: number | null;
  /** No network at all, as opposed to a backend that is not answering. */
  hasNetwork: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
};

export function useHome(): HomeState {
  const { ready, offline, hasNetwork, profileId } = useLibraryStatus();

  // Gated on the profile row existing, not merely on being authenticated —
  // see `useLibraryStatus`. Without it a first sign-in throws `NO_PROFILE`
  // out of render.
  const live = useQuery(api.library.home, ready ? {} : 'skip');

  const localIds = useLocalLibraryStore((state) => state.ids);
  const scan = useLocalLibraryStore((state) => state.scan);
  const markAbsent = useLocalLibraryStore((state) => state.markAbsent);
  const saveCache = useLibraryCacheStore((state) => state.save);
  const readCache = useLibraryCacheStore((state) => state.read);
  const cacheHydrated = useLibraryCacheStore((state) => state.hydrated);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * The ids this device holds, as the server will accept them.
   *
   * Sorted, so the array is structurally equal between renders and Convex does
   * not re-subscribe every time the set is rebuilt. Capped because the server
   * refuses more than `IDS_MAX` — a library past that browses through the
   * all-library screen instead of asking for everything at once.
   *
   * The cast is the one place a client supplies an id it did not get from a
   * query. These came out of filenames this app wrote from ids Convex minted,
   * and the server checks ownership on every one regardless, so the worst a
   * corrupted name can do is come back missing.
   */
  const ids = useMemo(
    () => [...localIds].sort().slice(0, IDS_MAX) as Id<'documents'>[],
    [localIds],
  );

  const onDevice = useQuery(api.library.byIds, ready && ids.length > 0 ? { ids } : 'skip');

  /** Keep the offline copy current whenever a live answer arrives. */
  useEffect(() => {
    if (live !== undefined && profileId !== null) {
      saveCache(profileId, live);
    }
  }, [live, profileId, saveCache]);

  /**
   * Deletes local files whose row is gone.
   *
   * A document deleted on another phone leaves its file here forever: nothing
   * on this device is told, and the next scan happily counts it again. `byIds`
   * asked about every local id and answered for the ones that still exist, so
   * whatever is missing from that answer has no record behind it.
   *
   * Only when a live answer is in hand. Running it against a cache, or against
   * `undefined`, would delete the reader's library.
   *
   * Safe across accounts because the directory is per profile — see
   * `local/paths.ts`. In one shared directory this would delete the previous
   * reader's documents the moment somebody else signed in.
   */
  useEffect(() => {
    if (onDevice === undefined || ids.length === 0 || profileId === null) {
      return;
    }
    const alive = new Set(onDevice.map((doc) => doc.id));
    for (const id of ids) {
      if (!alive.has(id)) {
        removeLocally(profileId, id);
        markAbsent(id);
      }
    }
  }, [onDevice, ids, profileId, markAbsent]);

  const refresh = useCallback(async () => {
    if (profileId === null) {
      return;
    }
    setRefreshing(true);
    try {
      // Convex keeps its own subscriptions live, so the only thing a pull can
      // actually refresh is the filesystem. Pulling to refresh a websocket
      // would be theatre.
      await scan(profileId);
    } finally {
      setRefreshing(false);
    }
  }, [profileId, scan]);

  /**
   * The live answer, or the last one, or nothing yet.
   *
   * The cache is only consulted once it has been read back from storage and the
   * live query has not answered — so a working connection never shows stale
   * data, and a broken one never shows an empty library the reader knows is
   * wrong.
   */
  const cached = useMemo(
    () => (live === undefined && cacheHydrated && profileId !== null ? readCache(profileId) : null),
    [live, cacheHydrated, profileId, readCache],
  );

  const home: CachedHome | undefined = live ?? cached?.home;

  /**
   * The device rail, trimmed to a rail's worth.
   *
   * Every other rail is capped at `RAIL_LIMIT` by the index that builds it.
   * This one arrives as up to `IDS_MAX` documents in filename order, which is
   * neither a length nor an order anyone asked for — so it is sorted the way
   * the reader would expect and cut to the same length as its neighbours.
   */
  const deviceRail = useMemo(() => {
    if (onDevice !== undefined) {
      return [...onDevice]
        .sort((a, b) => (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt))
        .slice(0, RAIL_LIMIT);
    }
    // Offline, the cache is the only place a title can come from — so the rail
    // is the cached documents intersected with what is actually on disk.
    if (home === undefined) {
      return [];
    }
    const seen = new Map<string, LibraryDocument>();
    for (const doc of [...home.continueReading, ...home.recentlyAdded, ...home.favorites, ...home.finished]) {
      if (localIds.has(doc.id)) {
        seen.set(doc.id, doc);
      }
    }
    return [...seen.values()]
      .sort((a, b) => (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt))
      .slice(0, RAIL_LIMIT);
  }, [onDevice, home, localIds]);

  const everything = useMemo<LibraryDocument[]>(
    () =>
      home === undefined
        ? []
        : [...home.continueReading, ...home.recentlyAdded, ...home.favorites, ...home.finished],
    [home],
  );
  useCoverSync(everything);
  // The other thing the account has that the device wants on disk. Same footing
  // as covers: quiet, sequential, once per document, and never urgent.
  useTextMirror(everything);

  const sections = useMemo<HomeSection[]>(() => {
    if (home === undefined) {
      return [];
    }

    const candidates: HomeSection[] = [
      {
        kind: 'documents',
        id: 'continue',
        title: 'Continue reading',
        documents: home.continueReading,
        showProgress: true,
      },
      {
        kind: 'documents',
        id: 'recent',
        title: 'Recently added',
        documents: home.recentlyAdded,
        showProgress: false,
      },
      {
        kind: 'documents',
        id: 'favorites',
        title: 'Favourites',
        documents: home.favorites,
        showProgress: false,
      },
      {
        kind: 'documents',
        id: 'device',
        title: 'On this device',
        documents: deviceRail,
        showProgress: false,
      },
      {
        kind: 'collections',
        id: 'collections',
        title: 'Collections',
        collections: home.collections,
      },
      {
        kind: 'documents',
        id: 'finished',
        title: 'Finished',
        documents: home.finished,
        showProgress: false,
      },
    ];

    // A rail with nothing in it renders nothing at all. Six empty headings is
    // what a dashboard does; this screen would rather be shorter.
    return candidates.filter((section) =>
      section.kind === 'documents'
        ? section.documents.length > 0
        : section.collections.length > 0,
    );
  }, [home, deviceRail]);

  // `recentlyAdded` reads `by_owner` newest-first, so it is empty exactly when
  // the account owns no documents at all.
  const isEmpty =
    home !== undefined && home.recentlyAdded.length === 0 && home.collections.length === 0;

  return {
    sections,
    loading: home === undefined,
    isEmpty,
    offline,
    stale: live === undefined && cached !== null,
    staleAt: live === undefined ? (cached?.savedAt ?? null) : null,
    hasNetwork,
    refreshing,
    refresh,
  };
}
