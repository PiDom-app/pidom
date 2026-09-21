import { useEffect, useRef } from 'react';
import { renderPageToCanvas, renderTextLayer, type PDFDocumentProxy } from '../pdf/engine';
import { cn } from '@/lib/utils';

/**
 * One rendered page: a canvas the engine paints, with a selectable text layer
 * over it.
 *
 * The render is demand-driven and cancellable. When the page scrolls off, the
 * zoom changes, or the component unmounts, the in-flight `RenderTask` is
 * cancelled and the page's own resources are released with `cleanup()` — an
 * uncancelled render into a canvas that is about to be reused is the classic
 * PDF.js flicker, and a book left with every page's operator list in memory is
 * how a reader runs a laptop out of it.
 */
export function ReaderPage({
  doc,
  pageNumber,
  scale,
  width,
  height,
  className,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  /** CSS box the page occupies, so the layout holds before the paint lands. */
  width: number;
  height: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: ReturnType<typeof renderPageToCanvas> | null = null;
    let page: Awaited<ReturnType<PDFDocumentProxy['getPage']>> | null = null;

    void (async () => {
      try {
        page = await doc.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        renderTask = renderPageToCanvas(page, canvasRef.current, scale);
        await renderTask.promise;
        if (cancelled || !textRef.current) return;
        await renderTextLayer(page, textRef.current, scale);
      } catch {
        // A cancelled render rejects; that is the teardown path, not an error a
        // reader can act on. A genuine page fault leaves the placeholder box.
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      page?.cleanup();
    };
  }, [doc, pageNumber, scale]);

  return (
    <div
      className={cn('relative bg-white shadow-sm', className)}
      style={{ width, height }}
      data-page={pageNumber}
    >
      <canvas ref={canvasRef} className="block" />
      <div ref={textRef} className="pdf-text-layer" />
    </div>
  );
}
