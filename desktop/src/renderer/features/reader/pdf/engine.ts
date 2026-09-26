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

/** One flattened table-of-contents entry, in the shape the account stores: a
 *  title, the 1-based page it jumps to, and its nesting depth (0 = top level).
 *  The server re-bounds all three and clamps the page against the real page
 *  count, so this is deliberately best-effort — a malformed bookmark is dropped,
 *  never trusted. */
export interface OutlineEntry {
  title: string;
  page: number;
  depth: number;
}

/** PDF.js hands back a nested bookmark tree; only the fields the flattener needs. */
type OutlineNode = { title?: string; dest?: string | unknown[] | null; items?: OutlineNode[] };

/** Resolves one bookmark destination to its 1-based page number, or null when it
 *  cannot be resolved (a named destination that is missing, an external link, a
 *  malformed dest array). PDF.js addresses pages by an opaque ref, so this is a
 *  per-entry async lookup that is allowed to fail without sinking the rest. */
async function pageNumberOf(
  doc: PDFDocumentProxy,
  dest: string | unknown[] | null | undefined,
): Promise<number | null> {
  if (dest == null) return null;
  const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || explicit.length === 0) return null;
  const ref = explicit[0];
  if (!ref || typeof ref !== 'object') return null;
  const index = await doc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
  return index + 1;
}

/**
 * Flattens a PDF's bookmark tree into page-numbered entries, depth-first.
 *
 * The running `depth` preserves the nesting the contents sheet shows; a
 * whitespace-only title is a label-less bookmark and is skipped, and an entry
 * whose destination will not resolve is dropped rather than pointed at page one.
 * Returns an empty array when the document declares no outline. The caller sends
 * whatever comes back to `setProcessed`, which bounds the count, depth, and every
 * title on the server — the file is untrusted input, so the trust lives there.
 */
export async function readOutline(doc: PDFDocumentProxy): Promise<OutlineEntry[]> {
  const root = (await doc.getOutline().catch(() => null)) as OutlineNode[] | null;
  if (!root || root.length === 0) return [];

  const entries: OutlineEntry[] = [];
  const walk = async (nodes: OutlineNode[], depth: number): Promise<void> => {
    for (const node of nodes) {
      const title = typeof node.title === 'string' ? node.title.trim() : '';
      if (title) {
        const page = await pageNumberOf(doc, node.dest).catch(() => null);
        if (page !== null) entries.push({ title, page, depth });
      }
      if (Array.isArray(node.items) && node.items.length > 0) await walk(node.items, depth + 1);
    }
  };
  await walk(root, 0);
  return entries;
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
