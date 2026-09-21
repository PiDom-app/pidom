import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/types/src/display/api';
// The worker is a bundled asset, resolved to a same-origin URL at build. Never a
// CDN — the CSP forbids one, and a reader's document should not need the network
// to turn a page. `?url` hands Vite the emitted path rather than the module.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * The one place the renderer talks to PDF.js.
 *
 * Everything above this file works in pages and viewports; the library's own
 * types stop here. The split matters for two reasons the spec asks for: the
 * worker parses the file off the UI thread, and the document bytes are the one
 * piece of untrusted input in the renderer — keeping the parser behind a named
 * boundary is what lets the rest of the reader treat a page as data.
 */

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy, RenderTask };

/** Page dimensions at scale 1, before any zoom. Used to lay out before render. */
export interface PageSize {
  width: number;
  height: number;
}

/**
 * Opens a verified copy by its handle URL.
 *
 * `disableAutoFetch`/`disableStream` are off: the copy is served by main over a
 * scheme that answers range requests, so a thousand-page book streams the pages
 * in view rather than the whole file up front. The standard fonts and character
 * maps are bundled assets, pointed at the same origin the worker came from.
 */
export function openPdf(url: string): { promise: Promise<PDFDocumentProxy>; destroy: () => void } {
  const task = pdfjs.getDocument({
    url,
    // Same-origin, copied to the build root by the renderer's pdfjs-assets plugin
    // and served by Vite in dev. Resolved against the document origin so it is
    // `app://bundle/cmaps/` in the packaged app and `http://localhost/cmaps/` in
    // dev — never a CDN, which the CSP forbids.
    cMapUrl: new URL('/cmaps/', document.baseURI).toString(),
    cMapPacked: true,
    standardFontDataUrl: new URL('/standard_fonts/', document.baseURI).toString(),
    // A page render is what a compromised PDF would use to reach the DOM; keep
    // it painting pixels, never running its own scripts or fetching XFA.
    isEvalSupported: false,
    enableXfa: false,
  });
  return { promise: task.promise, destroy: () => void task.destroy() };
}

/** The page's size at scale 1, in CSS pixels. */
export function pageSizeOf(page: PDFPageProxy): PageSize {
  const viewport = page.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
}

/**
 * Paints one page onto a canvas at the given CSS scale, sharp on any display.
 *
 * The backing store is sized in device pixels and the canvas is sized in CSS
 * pixels, so a page on a 2× display renders at twice the resolution rather than
 * upscaling a blurry bitmap. Returns the task so the caller can `cancel()` it
 * when the page scrolls off or the zoom changes mid-render — an uncancelled
 * render into a reused canvas is the classic PDF.js flicker.
 */
export function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  cssScale: number,
): RenderTask {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const viewport = page.getViewport({ scale: cssScale * dpr });
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('2D canvas context unavailable');

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
  canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

  return page.render({ canvasContext: context, viewport });
}

/**
 * Lays a selectable, invisible text layer over a rendered page.
 *
 * PDF.js positions transparent spans exactly over the glyphs the canvas painted,
 * which is what makes a drag select real words and the find bar highlight the
 * right place. The container is emptied first so a re-render at a new zoom does
 * not stack two layers.
 */
export async function renderTextLayer(
  page: PDFPageProxy,
  container: HTMLElement,
  cssScale: number,
): Promise<void> {
  container.replaceChildren();
  // PDF.js positions every span with `calc(var(--scale-factor) * …)`, so the
  // container has to carry the scale it was rendered at or the text lands in the
  // top-left corner instead of over the glyphs.
  container.style.setProperty('--scale-factor', String(cssScale));
  const viewport = page.getViewport({ scale: cssScale });
  const textLayer = new pdfjs.TextLayer({
    textContentSource: page.streamTextContent(),
    container,
    viewport,
  });
  await textLayer.render();
}
