import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { ReadingMode } from '@convex/model/library';

/**
 * What this phone remembers about reading.
 *
 * Two things live here, and the split is the point.
 *
 * **The page, written often.** `documents.currentPage` is the cross-device
 * answer, but it is written on a debounce, so between two of those writes the
 * only record of where somebody got to is this one. It is what makes a
 * force-quit survivable, and it is read back before Convex answers, so a cold
 * open lands on the right page without waiting for a socket.
 *
 * **Preferences that are about a screen rather than about a book.** Fit policy
 * and the wake lock describe this device — a phone and a tablet want different
 * answers and neither is wrong — so they never sync. `readingMode` is the
 * exception and is deliberately not stored here: how a document reads is a
 * property of the document, so it rides on the row with the position. What is
 * kept is the *last* mode, as the default the next document opens under.
 *
 * `AsyncStorage`, not `SecureStore`. A password for an encrypted PDF is a
 * credential and goes somewhere else entirely; see `document-password.ts`.
 */

/**
 * What, if anything, is laid over the page.
 *
 * `none` is faithful rendering, and is the default: a PDF is somebody else's
 * document and Pidom's theme is not its business. The other two are an overlay
 * and **not an inversion** — `react-native-pdf` cannot invert a page, and a
 * dark reading treatment is a different feature from a dark app. `dim` takes
 * the glare off a white page in a dark room; `warm` takes the blue out of it.
 */
export type PageTint = 'none' | 'dim' | 'warm';

/** How the renderer sizes a page. Mirrors `react-native-pdf`'s `fitPolicy`. */
export type FitPolicy = 'width' | 'height' | 'both';

export const FIT_POLICY: Record<FitPolicy, 0 | 1 | 2> = { width: 0, height: 1, both: 2 };

/**
 * A page the reader should move to when it comes back into focus.
 *
 * The navigator is a screen rather than a sheet now, and a screen cannot return
 * a value: `router.back()` has nowhere to put "page 142". Passing it forward as
 * a route param would push a second reader over the first, which is a second
 * copy of a 400-page document held open. So the navigator leaves the page here
 * and the reader picks it up on focus.
 *
 * Carries the document id because a jump is only ever meant for the document it
 * was chosen in — a stale one left by a reader who backed all the way out must
 * not move the next document they open.
 *
 * Deliberately **not** persisted: it describes one navigation, and a jump
 * surviving a force-quit would move somebody who reopened a book to wherever
 * they last tapped in a list.
 */
type PendingJump = { documentId: string; page: number };

type ReaderState = {
  /** Page per document id, 1-based. The between-writes record of the position. */
  pages: Record<string, number>;
  pendingJump: PendingJump | null;
  /** The mode the next document opens under, when it has none of its own. */
  lastMode: ReadingMode;
  fit: FitPolicy;
  keepAwake: boolean;
  tint: PageTint;
  /** False until the persisted values have been read back. */
  hydrated: boolean;

  rememberPage: (documentId: string, page: number) => void;
  forgetPage: (documentId: string) => void;
  /** Asks the reader to move, from a screen sitting over it. */
  requestJump: (documentId: string, page: number) => void;
  /** Reads it once and clears it. A jump taken twice is a jump that fights. */
  takeJump: (documentId: string) => number | null;
  setLastMode: (mode: ReadingMode) => void;
  setFit: (fit: FitPolicy) => void;
  setKeepAwake: (keepAwake: boolean) => void;
  setTint: (tint: PageTint) => void;
};

export const useReaderStore = create<ReaderState>()(
  persist(
    (set, get) => ({
      pages: {},
      pendingJump: null,
      lastMode: 'continuous',
      fit: 'width',
      keepAwake: true,
      tint: 'none',
      hydrated: false,

      rememberPage: (documentId, page) =>
        set((state) => {
          // Bailing when nothing changed keeps a page turn from writing to
          // storage twice: `onPageChanged` can fire for a page already held.
          if (state.pages[documentId] === page) {
            return state;
          }
          return { pages: { ...state.pages, [documentId]: page } };
        }),

      forgetPage: (documentId) =>
        set((state) => {
          if (!(documentId in state.pages)) {
            return state;
          }
          const pages = { ...state.pages };
          delete pages[documentId];
          return { pages };
        }),

      requestJump: (documentId, page) => set({ pendingJump: { documentId, page } }),

      takeJump: (documentId) => {
        // `get`, not `useReaderStore.getState()`: reading the store through its
        // own binding here makes the initialiser reference the value it is
        // creating, and TypeScript gives up on the whole state type.
        const pending = get().pendingJump;
        if (pending === null || pending.documentId !== documentId) {
          return null;
        }
        set({ pendingJump: null });
        return pending.page;
      },

      setLastMode: (lastMode) => set({ lastMode }),
      setFit: (fit) => set({ fit }),
      setKeepAwake: (keepAwake) => set({ keepAwake }),
      setTint: (tint) => set({ tint }),
    }),
    {
      name: 'pidom.reader',
      storage: createJSONStorage(() => AsyncStorage),
      // `hydrated` and `pendingJump` describe this launch and one navigation
      // inside it; neither is written back.
      partialize: (state) => ({
        pages: state.pages,
        lastMode: state.lastMode,
        fit: state.fit,
        keepAwake: state.keepAwake,
        tint: state.tint,
      }),
      onRehydrateStorage: () => () => {
        useReaderStore.setState({ hydrated: true });
      },
    },
  ),
);
