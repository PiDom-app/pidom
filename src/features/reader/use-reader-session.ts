import { useMutation } from 'convex/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import type { ReadingMode } from '@convex/model/library';
import { PROGRESS_DEBOUNCE_MS, PROGRESS_JUMP_PAGES } from '@convex/model/limits';
import { log } from '@/lib/logger';
import { useReaderStore } from '@/stores/reader-store';

const SCOPE = 'reader-session';

/**
 * Where the reader is, and when that becomes everybody else's business.
 *
 * ```
 * onPageChanged ─► component state          immediately, it draws the bar
 *               ─► reader store             immediately, it survives a crash
 *               ─► api.library.recordProgress  debounced, and on the way out
 * ```
 *
 * The middle line is the one that is new. Position used to land only on unmount
 * and on backgrounding, which is correct for the common exits and loses the
 * chapter for the one that is not an exit at all — a force-quit, an OOM kill, a
 * battery. The store write is cheap enough to do on every page and is read back
 * before Convex answers, so reopening lands on the right page instantly and
 * offline.
 *
 * The last line stays expensive and therefore stays rare. A mutation per swipe
 * is a write per swipe, replicated to every device the account owns and
 * re-running the home query on all of them to move a bar on one. Fifteen
 * seconds of quiet, a jump big enough to be deliberate, backgrounding, or
 * leaving — and nothing else.
 *
 * Both exits read refs rather than state, because neither the cleanup nor the
 * `AppState` listener sees the render that set it.
 */

export type ReaderSession = {
  page: number;
  pageCount: number | null;
  /** Everything the renderer reports goes through here. */
  onPageChanged: (page: number) => void;
  onLoaded: (pageCount: number) => void;
  /** A deliberate move — a Contents entry, a search hit, the page field. */
  onJumped: (page: number) => void;
  /** Mode is a preference, so it is written straight through rather than debounced. */
  onModeChanged: (mode: ReadingMode) => void;
  /** Where to open. `null` until the row and the store have both been consulted. */
  resumeAt: number | null;
};

export function useReaderSession({
  documentId,
  profileId,
  /** `documents.currentPage`, or `null` while the row is still loading. */
  storedPage,
  /** A `?page=` parameter. A reader who asked for a page gets that page. */
  requestedPage,
  storedPageCount,
}: {
  documentId: Id<'documents'> | undefined;
  profileId: string | null;
  storedPage: number | null;
  requestedPage: number | null;
  storedPageCount: number | null;
}): ReaderSession {
  const recordProgress = useMutation(api.library.recordProgress);
  const rememberPage = useReaderStore((state) => state.rememberPage);
  const hydrated = useReaderStore((state) => state.hydrated);

  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(storedPageCount);
  const [resumeAt, setResumeAt] = useState<number | null>(null);

  const pageRef = useRef(1);
  const pageCountRef = useRef<number | null>(storedPageCount);
  const modeRef = useRef<ReadingMode | undefined>(undefined);
  const openedRef = useRef(false);
  const syncedPageRef = useRef(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Tells the server where the reader got to.
   *
   * Idempotent and never awaited by anything a reader is waiting on, so calling
   * it from four exits costs a duplicate mutation at worst.
   *
   * `force` is what opening a document uses. Without it this skips when nothing
   * has moved — which is right for the debounce and was wrong for everything
   * else: `lastOpenedAt` is written *only* by `recordProgress`, and Continue
   * Reading both filters and sorts on it. So somebody who opened a book, read
   * the page they resumed on, and left never entered the rail the whole reader
   * exists to feed. Opening now writes once, unconditionally.
   */
  const flush = useCallback(
    (force = false) => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (documentId === undefined || !openedRef.current) {
        // Nothing can be written yet. Drop any pending mode with it rather than
        // letting it ride a flush minutes from now, on a different page.
        modeRef.current = undefined;
        return;
      }
      const mode = modeRef.current;
      if (!force && mode === undefined && pageRef.current === syncedPageRef.current) {
        return;
      }
      syncedPageRef.current = pageRef.current;
      modeRef.current = undefined;
      recordProgress({
        documentId,
        currentPage: pageRef.current,
        ...(pageCountRef.current === null ? {} : { pageCount: pageCountRef.current }),
        ...(mode === undefined ? {} : { readingMode: mode }),
      }).catch((error: unknown) => {
        // Losing a page position is not worth interrupting somebody who is
        // reading. The next flush sends the newer number anyway, so a failed
        // page costs nothing but the gap — which is why `syncedPageRef` is not
        // rolled back: rolling it back would retry a stale page over a fresh one.
        //
        // That reasoning does not transfer to the mode. There is no newer mode
        // coming — it changes only when the reader changes it — so a mode
        // switched with no connection would be lost from the one field the
        // reader is told follows the document to their other devices. It goes
        // back in the ref to ride the next flush.
        if (mode !== undefined && modeRef.current === undefined) {
          modeRef.current = mode;
        }
        log.debug(SCOPE, 'could not save the position', error);
      });
    },
    [documentId, recordProgress],
  );

  /** Restarts the quiet timer. Reading is a stream of these; one write is not. */
  const schedule = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(flush, PROGRESS_DEBOUNCE_MS);
  }, [flush]);

  const record = useCallback(
    (next: number, deliberate: boolean) => {
      const moved = Math.abs(next - pageRef.current);
      setPage(next);
      pageRef.current = next;
      if (documentId !== undefined) {
        rememberPage(documentId, next);
      }
      // A tap on a Contents entry has moved somebody on purpose, and losing
      // that inside the debounce window loses the one page they went looking
      // for. Anything smaller waits out the quiet.
      if (deliberate || moved >= PROGRESS_JUMP_PAGES) {
        flush();
      } else {
        schedule();
      }
    },
    [documentId, rememberPage, flush, schedule],
  );

  const onPageChanged = useCallback((next: number) => record(next, false), [record]);
  const onJumped = useCallback((next: number) => record(next, true), [record]);

  const onLoaded = useCallback(
    (count: number) => {
      setPageCount(count);
      pageCountRef.current = count;

      // The renderer is the only thing that actually knows how long the document
      // is, so this is where a resume page taken from a deep link gets its upper
      // bound. `?page=99999` on a 499-page book lands on 499 rather than being
      // handed to the native view.
      if (count > 0 && pageRef.current > count) {
        const clamped = Math.max(1, count);
        setPage(clamped);
        pageRef.current = clamped;
        setResumeAt(clamped);
      }

      // One write on open. This is what puts the document in Continue Reading
      // and backfills `pageCount` for a row whose import probe never got one —
      // both documented as happening on open, and neither of which did.
      flush(true);
    },
    [flush],
  );

  const onModeChanged = useCallback(
    (mode: ReadingMode) => {
      modeRef.current = mode;
      flush();
    },
    [flush],
  );

  // Where to open: an explicit page wins, then whatever this device saw last,
  // then the account's answer. The device is ahead of the account by up to one
  // debounce, which is the whole reason it is consulted first.
  //
  // Once, and only once. After this the reader owns the page and re-syncing
  // from the row would fight their swipes.
  useEffect(() => {
    if (openedRef.current || documentId === undefined || profileId === null) {
      return;
    }
    if (storedPage === null || !hydrated) {
      return;
    }
    const local = useReaderStore.getState().pages[documentId] ?? null;
    const resume = requestedPage ?? Math.max(1, local ?? storedPage);
    openedRef.current = true;
    syncedPageRef.current = resume;
    setPage(resume);
    pageRef.current = resume;
    setResumeAt(resume);
  }, [documentId, profileId, storedPage, requestedPage, hydrated]);

  // The three ways out of a document: the app going away, the screen going
  // away, and a quiet fifteen seconds.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        flush();
      }
    });
    return () => {
      subscription.remove();
      flush();
    };
  }, [flush]);

  return { page, pageCount, onPageChanged, onLoaded, onJumped, onModeChanged, resumeAt };
}
