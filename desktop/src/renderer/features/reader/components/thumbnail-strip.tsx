import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { renderPageToCanvas, type PDFDocumentProxy } from '../pdf/engine';
import { cn } from '@/lib/utils';

/**
 * A virtualized column of page thumbnails.
 *
 * A thumbnail is a real page render, so the strip is virtualized like the
 * document surface: only the thumbnails in view are painted, at a small fixed
 * width rather than reading resolution, and the rest are estimated boxes. That
 * is what keeps a several-hundred-page book's Pages tab from rendering the whole
 * document into the sidebar the moment it opens.
 */

const THUMB_WIDTH = 132;
/** A tall page is the common case; the estimate self-corrects on measure. */
const THUMB_HEIGHT = 176;

export function ThumbnailStrip({
  doc,
  pageCount,
  currentPage,
  onJump,
}: {
  doc: PDFDocumentProxy;
  pageCount: number;
  currentPage: number;
  onJump: (page: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: pageCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => THUMB_HEIGHT + 28,
    overscan: 3,
  });

  return (
    <div ref={scrollRef} className="h-full overflow-auto p-2">
      <div
        className="relative mx-auto"
        style={{ height: virtualizer.getTotalSize(), width: THUMB_WIDTH }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const page = item.index + 1;
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="absolute top-0 left-0 w-full pb-2"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <button
                onClick={() => onJump(page)}
                className={cn(
                  'block w-full rounded-md border p-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus',
                  page === currentPage
                    ? 'border-primary'
                    : 'border-border hover:border-border-strong',
                )}
                aria-label={`Page ${page}`}
                aria-current={page === currentPage}
              >
                <Thumbnail doc={doc} pageNumber={page} />
                <span className="mt-1 block text-center text-xs tabular-nums text-fg-muted">
                  {page}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Thumbnail({ doc, pageNumber }: { doc: PDFDocumentProxy; pageNumber: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof renderPageToCanvas> | null = null;
    let page: Awaited<ReturnType<PDFDocumentProxy['getPage']>> | null = null;

    void (async () => {
      try {
        page = await doc.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        const size = page.getViewport({ scale: 1 });
        // Render at whatever scale fits the thumbnail's width, not reading size.
        task = renderPageToCanvas(page, canvasRef.current, (THUMB_WIDTH - 8) / size.width);
        await task.promise;
      } catch {
        /* a cancelled thumbnail is the scroll-away path, not an error */
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
      page?.cleanup();
    };
  }, [doc, pageNumber]);

  return <canvas ref={canvasRef} className="mx-auto block bg-white" />;
}
