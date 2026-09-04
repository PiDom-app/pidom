import { useCallback, useMemo, type RefObject } from 'react';
import { AccessibilityInfo } from 'react-native';

import type { ReadingMode } from '@convex/model/library';
import type { FitPolicy } from '@/stores/reader-store';

import type { ReaderCanvasRef } from './reader-canvas';

/**
 * The one way anything moves the page.
 *
 * Contents entries, search hits, the scrubber, the page field and the arrow
 * keys of a future keyboard all want the same thing, and if each of them talks
 * to `pdfRef.setPage` directly then clamping, pair-snapping and progress
 * recording have to be right in five places. They are right here instead.
 *
 * This is also what makes the next feature cheap: bookmarks, a "back to where I
 * was" jump, an outline sidebar on a tablet — each is a caller of `goToPage`
 * rather than a new relationship with the renderer.
 *
 * Every command is a plain function over a ref and two callbacks. There is no
 * store behind it on purpose: a command that wrote to a store would make
 * turning a page an asynchronous round trip through React for no benefit.
 */

export type ReaderCommands = {
  /** Clamped, pair-snapped in a spread, recorded as a deliberate move. */
  goToPage: (page: number) => void;
  /** One page, or two when two are on screen. */
  nextPage: () => void;
  previousPage: () => void;
  setMode: (mode: ReadingMode) => void;
  /** Only meaningful in continuous; the other modes size the page themselves. */
  setFit: (fit: FitPolicy) => void;
  /** Back to fit-to-page after a pinch. The ref has no zoom, so this is a prop. */
  resetZoom: () => void;
  toggleControls: () => void;
  openContents: () => void;
  openSearch: () => void;
  openPageJump: () => void;
  closeReader: () => void;
};

export function useReaderCommands({
  canvas,
  page,
  pageCount,
  mode,
  onJumped,
  onModeChanged,
  onFitChanged,
  onResetZoom,
  onToggleControls,
  onOpenContents,
  onOpenSearch,
  onOpenPageJump,
  onClose,
}: {
  canvas: RefObject<ReaderCanvasRef | null>;
  page: number;
  /** `null` until the renderer has counted; commands clamp against it once it has. */
  pageCount: number | null;
  mode: ReadingMode;
  onJumped: (page: number) => void;
  onModeChanged: (mode: ReadingMode) => void;
  onFitChanged: (fit: FitPolicy) => void;
  onResetZoom: () => void;
  onToggleControls: () => void;
  onOpenContents: () => void;
  onOpenSearch: () => void;
  onOpenPageJump: () => void;
  onClose: () => void;
}): ReaderCommands {
  const goToPage = useCallback(
    (target: number) => {
      if (!Number.isFinite(target)) {
        return;
      }
      const last = pageCount ?? Number.MAX_SAFE_INTEGER;
      let next = Math.min(last, Math.max(1, Math.round(target)));
      // A spread shows an even page and the one after it, so landing on 143
      // means landing on the 142–143 spread. Without this, jumping to an odd
      // page would re-pair the whole document by one and every later jump
      // would land on a different half.
      if (mode === 'spread' && next % 2 === 1 && next > 1) {
        next -= 1;
      }
      canvas.current?.setPage(next);
      onJumped(next);
      // Every way of moving the page comes through here, so one announcement
      // covers the Contents sheet, a search hit, the scrubber and the page
      // field at once. Without it a screen-reader user is moved and never told
      // where to.
      AccessibilityInfo.announceForAccessibility(
        pageCount === null ? `Page ${next}` : `Page ${next} of ${pageCount}`,
      );
    },
    [canvas, pageCount, mode, onJumped],
  );

  const step = mode === 'spread' ? 2 : 1;

  const nextPage = useCallback(() => goToPage(page + step), [goToPage, page, step]);
  const previousPage = useCallback(() => goToPage(page - step), [goToPage, page, step]);

  const setMode = useCallback(
    (next: ReadingMode) => {
      onModeChanged(next);
      // The canvas remounts on a mode change and opens at `page`, so nothing
      // needs to be told to navigate — see `reader-canvas.tsx` for why the
      // remount rather than a prop change.
    },
    [onModeChanged],
  );

  return useMemo(
    () => ({
      goToPage,
      nextPage,
      previousPage,
      setMode,
      setFit: onFitChanged,
      resetZoom: onResetZoom,
      toggleControls: onToggleControls,
      openContents: onOpenContents,
      openSearch: onOpenSearch,
      openPageJump: onOpenPageJump,
      closeReader: onClose,
    }),
    [
      goToPage,
      nextPage,
      previousPage,
      setMode,
      onFitChanged,
      onResetZoom,
      onToggleControls,
      onOpenContents,
      onOpenSearch,
      onOpenPageJump,
      onClose,
    ],
  );
}
