import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { LibraryCollection, LibraryDocument } from '@/features/library/data/types';

/**
 * The last home payload, kept so the library is legible with no connection.
 *
 * Convex holds its query results in memory and has no on-device persistence, so
 * a cold launch in aeroplane mode leaves `useQuery` at `undefined` forever. The
 * empty state promises documents are "readable with no connection"; without
 * this the metadata needed to *find* them is not, and the reader gets a
 * skeleton that never resolves.
 *
 * Scoped by profile id. Two accounts on one device is unusual but not
 * impossible, and showing one reader's library to the other would be the worst
 * kind of bug to ship.
 *
 * This is a cache, never a source of truth: it is only read when the live query
 * has not answered, and every write replaces it wholesale.
 */

export type CachedHome = {
  continueReading: LibraryDocument[];
  recentlyAdded: LibraryDocument[];
  favorites: LibraryDocument[];
  finished: LibraryDocument[];
  collections: LibraryCollection[];
};

type LibraryCacheState = {
  /** Which account the cache belongs to. */
  profileId: string | null;
  home: CachedHome | null;
  /** When it was written, for the "as of" line on the offline notice. */
  savedAt: number | null;
  hydrated: boolean;

  save: (profileId: string, home: CachedHome) => void;
  /** The cache for this account, or `null` if it belongs to another one. */
  read: (profileId: string) => { home: CachedHome; savedAt: number } | null;
  clear: () => void;
};

export const useLibraryCacheStore = create<LibraryCacheState>()(
  persist(
    (set, get) => ({
      profileId: null,
      home: null,
      savedAt: null,
      hydrated: false,

      save: (profileId, home) => set({ profileId, home, savedAt: Date.now() }),

      read: (profileId) => {
        const state = get();
        if (state.home === null || state.savedAt === null || state.profileId !== profileId) {
          return null;
        }
        return { home: state.home, savedAt: state.savedAt };
      },

      clear: () => set({ profileId: null, home: null, savedAt: null }),
    }),
    {
      name: 'pidom.library-cache',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        profileId: state.profileId,
        home: state.home,
        savedAt: state.savedAt,
      }),
      onRehydrateStorage: () => () => {
        // Fires whether or not the read succeeded. A failure leaves the cache
        // empty, which degrades to the online-only behaviour rather than to a
        // wrong library.
        useLibraryCacheStore.setState({ hydrated: true });
      },
    },
  ),
);
