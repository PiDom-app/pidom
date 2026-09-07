import { create } from 'zustand';

import { database } from '@/features/library/local/db';
import { reconcileFiles } from '@/features/library/local/repository/files';
import { documentIdFromName, ensureLibraryDirectory } from '@/features/library/local/paths';
import { log } from '@/lib/logger';

const SCOPE = 'local-library';

/**
 * The filesystem scan, and a fast copy of its answer.
 *
 * **The truth is `documentFiles` in the local database**, not this store. That
 * is where a download's verification, a corrupt file and a removal are all
 * recorded, and it is what the tiles read through the document row. What lives
 * here is the scan itself — the once-per-launch pass that makes the table agree
 * with the disk — plus an in-memory set for the few callers that need the
 * answer synchronously outside a query.
 *
 * Not persisted, and now for a second reason as well as the original: it is a
 * cache of a cache. `AsyncStorage` would only ever be a stale copy of something
 * a single `directory.list()` answers in milliseconds.
 */

type LocalLibraryState = {
  /** Document ids with a file on disk, as of the last scan. */
  ids: ReadonlySet<string>;
  /** False until the first scan finishes. */
  scanned: boolean;
  /** The account the set belongs to, so a stale one is never read as current. */
  profileId: string | null;
  scan: (profileId: string) => Promise<void>;
  /** After an import, so the tile turns available without a rescan. */
  markPresent: (documentId: string) => void;
  /** After a delete, for the same reason. */
  markAbsent: (documentId: string) => void;

  /**
   * Bumped when covers land on disk.
   *
   * `DocumentCover` reads the filesystem, which React cannot subscribe to. A
   * counter every cover depends on is the smallest thing that tells them all to
   * look again after a background fetch, without putting a stat call on every
   * render.
   */
  coverEpoch: number;
  bumpCoverEpoch: () => void;
};

export const useLocalLibraryStore = create<LocalLibraryState>()((set) => ({
  ids: new Set<string>(),
  scanned: false,
  profileId: null,
  coverEpoch: 0,

  bumpCoverEpoch: () => set((state) => ({ coverEpoch: state.coverEpoch + 1 })),

  scan: async (profileId) => {
    const found = new Map<string, number>();

    try {
      const entries = ensureLibraryDirectory(profileId).list();

      for (const entry of entries) {
        // Directories are skipped outright — `covers/` lives here too, and a
        // directory is never a document.
        if (!('size' in entry)) {
          continue;
        }
        // Anything that is not `<id>.pdf` was not written by this app. Ignored
        // rather than deleted: a file we did not create is not ours to remove.
        const id = documentIdFromName(entry.name);
        if (id !== null) {
          found.set(id, entry.size ?? 0);
        }
      }
    } catch (error) {
      // A failed scan means every document reads as "not on this device",
      // which is wrong but safe — it disables opening rather than opening
      // something that is not there. The table is deliberately left alone in
      // that case rather than being told everything is gone.
      log.error(SCOPE, 'could not read the library directory');
      log.debug(SCOPE, 'scan failed', error);
      set({ ids: new Set<string>(), scanned: true, profileId });
      return;
    }

    set({ ids: new Set(found.keys()), scanned: true, profileId });

    try {
      const db = await database(profileId);
      if (db !== null) {
        await reconcileFiles(db, found);
      }
    } catch (error) {
      log.debug(SCOPE, 'could not record what is on disk', error);
    }
  },

  markPresent: (documentId) =>
    set((state) => {
      if (state.ids.has(documentId)) {
        return state;
      }
      const next = new Set(state.ids);
      next.add(documentId);
      return { ids: next };
    }),

  markAbsent: (documentId) =>
    set((state) => {
      if (!state.ids.has(documentId)) {
        return state;
      }
      const next = new Set(state.ids);
      next.delete(documentId);
      return { ids: next };
    }),
}));

/** The reactive read. Selecting the boolean keeps a tile off every other tile's re-render. */
export function useIsOnThisDevice(documentId: string): boolean {
  return useLocalLibraryStore((state) => state.ids.has(documentId));
}
