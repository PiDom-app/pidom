import { useCallback, useEffect, useRef } from 'react';
import { useConvex } from 'convex/react';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';
import type { FunctionReturnType } from 'convex/server';
import { PROGRESS_DEBOUNCE_MS, PROGRESS_JUMP_PAGES } from '@convex-model/limits';

type ReadingMode = NonNullable<FunctionReturnType<typeof api.library.document>['readingMode']>;

/**
 * Keeps the account's saved reading position in step with where the reader is,
 * without a write per page turn.
 *
 * A write per turn is a write per scroll, replicated to every device the account
 * has open and re-running the home query on all of them, so ordinary reading is
 * debounced hard — see `PROGRESS_DEBOUNCE_MS`. A deliberate jump is different: a
 * reader who taps a Contents entry has moved on purpose, and losing that to a
 * force-quit inside the debounce window would lose the one page they went
 * looking for, so a jump past `PROGRESS_JUMP_PAGES` writes at once. The last
 * position is flushed on the way out.
 *
 * `readingMode` rides the document row because it is the same choice on every
 * device; zoom and scroll offset are this machine's and stay local.
 */
export function useReaderSession(
  documentId: Id<'documents'>,
  pageCount: number,
  readingMode: ReadingMode,
): { reportPage: (page: number) => void } {
  const convex = useConvex();

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<number | null>(null);
  const lastWritten = useRef<number | null>(null);
  // Read through refs so the flusher is stable and always sees the latest values
  // rather than the ones captured when a debounce was scheduled.
  const pageCountRef = useRef(pageCount);
  const readingModeRef = useRef(readingMode);
  pageCountRef.current = pageCount;
  readingModeRef.current = readingMode;

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const page = pending.current;
    if (page === null || page === lastWritten.current) return;
    pending.current = null;
    lastWritten.current = page;

    const count = pageCountRef.current;
    void convex.mutation(api.library.recordProgress, {
      documentId,
      currentPage: page,
      ...(count > 0 ? { pageCount: count } : {}),
      ...(count > 0 && page >= count ? { isFinished: true } : {}),
      readingMode: readingModeRef.current,
      clientUpdatedAt: Date.now(),
    });
  }, [convex, documentId]);

  const reportPage = useCallback(
    (page: number) => {
      if (page === pending.current) return;
      pending.current = page;

      const previous = lastWritten.current;
      const jumped = previous !== null && Math.abs(page - previous) >= PROGRESS_JUMP_PAGES;
      if (jumped) {
        flush();
        return;
      }

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, PROGRESS_DEBOUNCE_MS);
    },
    [flush],
  );

  // Flush the last position when the reader closes the document or leaves.
  useEffect(() => flush, [flush]);
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener('beforeunload', onHide);
    return () => window.removeEventListener('beforeunload', onHide);
  }, [flush]);

  return { reportPage };
}
