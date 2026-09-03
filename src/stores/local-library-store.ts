import { create } from 'zustand';

import { documentIdFromName, ensureLibraryDirectory } from '@/features/library/local/paths';
import { log } from '@/lib/logger';

const SCOPE = 'local-library';

/**
 * Which documents this device actually holds.
 *
 * The server cannot answer this, and a field on the Convex row claiming to
 * would be wrong the moment a reader clears app storage. So the filesystem is
 * scanned once at launch and the answer is kept here, where a rail of twelve
 * tiles can read it synchronously — twelve `File.exists` calls per render would
 * put the filesystem on the render path.
 *
 * Not persisted. `AsyncStorage` would only ever be a stale copy of something a
 * single `directory.list()` answers in milliseconds.
 */

type LocalLibraryState = {
  /** Document ids with a file on disk. */
  ids: ReadonlySet<string>;
  /** False until the first scan finishes. Rails hold their offline badge until then. */
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
    try {
      const entries = ensureLibraryDirectory(profileId).list();
      const ids = new Set<string>();

      for (const entry of entries) {
        // Directories are skipped outright — `covers/` lives here too, and a
        // directory is never a document.
        if (!('size' in entry)) {
          continue;
        }
        // Anything that is not `<convex id>.pdf` was not written by this app.
        // Ignored rather than deleted: a file we did not create is not ours to
        // remove.
        const id = documentIdFromName(entry.name);
        if (id !== null) {
          ids.add(id);
        }
      }

      set({ ids, scanned: true, profileId });
    } catch (error) {
      // A failed scan means every document reads as "not on this device",
      // which is wrong but safe — it disables opening rather than opening
      // something that is not there.
      log.error(SCOPE, 'could not read the library directory', error);
      set({ ids: new Set<string>(), scanned: true, profileId });
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
