import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ReaderPage } from './reader-page';
import type { PageSize, PDFDocumentProxy } from '../pdf/engine';
import type { ReaderView } from '../data/use-reader-view';

/**
 * The document surface, in whichever view mode is active.
 *
 * Continuous mode is virtualized: only the pages in view plus a small look-ahead
 * are mounted, so opening to page 700 of a scan does not render 1–699 first and
 * scrolling a thousand-page book stays a handful of live canvases. Single and
 * spread mount just their one or two pages and step with the toolbar and the
 * keyboard.
 *
 * The gap between pages comes from the account's `pageSpacing`; the background is
 * its `documentBackground`, kept separate from the app theme on purpose — a
 * reader wants a dark UI and a white page as often as not.
 */

export interface ReaderCanvasHandle {
  /** Scroll continuous mode to a page; a no-op guard so the toolbar can call blind. */
  scrollToPage: (page: number) => void;
}

const SPACING_PX: Record<'compact' | 'normal' | 'relaxed', number> = {
  compact: 8,
  normal: 20,
  relaxed: 40,
};

export function ReaderCanvas({
  doc,
  pageCount,
  firstPageSize,
  view,
  currentPage,
  onVisiblePage,
  spacing,
  background,
  handleRef,
}: {
  doc: PDFDocumentProxy;
  pageCount: number;
  firstPageSize: PageSize;
  view: ReaderView;
  currentPage: number;
  onVisiblePage: (page: number) => void;
  spacing: 'compact' | 'normal' | 'relaxed';
  background: 'neutral' | 'dark';
  handleRef: Ref<ReaderCanvasHandle>;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gap = SPACING_PX[spacing];

  // The container decides the fit, so the scale is measured, not assumed. Seeded
  // from the first page's size; every page is laid out against the same box,
  // which is right for the overwhelmingly common single-page-size document and
  // self-corrects visually for the rare mixed one.
  const box = useMemo(() => {
    const el = scrollRef.current;
    const width = el?.clientWidth ?? 900;
    const height = el?.clientHeight ?? 1200;
    const scale = view.scaleFor(firstPageSize, width - gap * 2, height - gap * 2);
    return {
      scale,
      pageWidth: Math.floor(firstPageSize.width * scale),
      pageHeight: Math.floor(firstPageSize.height * scale),
    };
    // scrollRef.current is read imperatively; the deps that change the answer are
    // the fit inputs.
  }, [view, firstPageSize, gap]);

  const virtualizer = useVirtualizer({
    count: pageCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => box.pageHeight + gap,
    overscan: 2,
    enabled: view.mode === 'continuous',
  });

  const scrollToPage = useCallback(
    (page: number) => {
      const index = Math.max(0, Math.min(pageCount - 1, page - 1));
      if (view.mode === 'continuous') {
        virtualizer.scrollToIndex(index, { align: 'start' });
      }
    },
    [pageCount, view.mode, virtualizer],
  );

  useImperativeHandle(handleRef, () => ({ scrollToPage }), [scrollToPage]);

  // Re-measure when the fit changes so a zoom re-lays the estimates.
  useEffect(() => {
    if (view.mode === 'continuous') virtualizer.measure();
  }, [box.pageHeight, view.mode, virtualizer]);

  // Report the page that leads the viewport so the toolbar indicator and the
  // progress writer track the scroll.
  useEffect(() => {
    if (view.mode !== 'continuous') return;
    const items = virtualizer.getVirtualItems();
    const lead = items[0];
    if (lead) onVisiblePage(lead.index + 1);
  }, [view.mode, virtualizer, onVisiblePage, virtualizer.getVirtualItems()]);

  // Document presentation, deliberately independent of the app's light/dark
  // theme — a reader often wants a dark surround and a white page.
  const surfaceClass = background === 'dark' ? 'bg-canvas' : 'bg-sunken';

  if (view.mode === 'continuous') {
    return (
      <div ref={scrollRef} className={`h-full overflow-auto ${surfaceClass}`}>
        <div
          className="relative mx-auto"
          style={{ height: virtualizer.getTotalSize(), width: box.pageWidth }}
        >
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${item.start}px)`, paddingBottom: gap }}
            >
              <ReaderPage
                doc={doc}
                pageNumber={item.index + 1}
                scale={box.scale}
                width={box.pageWidth}
                height={box.pageHeight}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Single and spread: the pages the reader is on, centered, no virtualizer.
  const pages = view.mode === 'spread' ? spreadPages(currentPage, pageCount) : [currentPage];

  return (
    <div
      ref={scrollRef}
      className={`flex h-full items-center justify-center overflow-auto ${surfaceClass}`}
    >
      <div className="flex items-start" style={{ gap }}>
        {pages.map((page) => (
          <ReaderPage
            key={page}
            doc={doc}
            pageNumber={page}
            scale={box.scale}
            width={box.pageWidth}
            height={box.pageHeight}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The two pages of a spread. Page one sits alone on the right like a book cover,
 * so a left-hand page is always even — the pairing a printed book falls into
 * when you open it.
 */
function spreadPages(current: number, pageCount: number): number[] {
  if (current <= 1) return [1];
  const left = current % 2 === 0 ? current : current - 1;
  const right = left + 1;
  return right <= pageCount ? [left, right] : [left];
}
