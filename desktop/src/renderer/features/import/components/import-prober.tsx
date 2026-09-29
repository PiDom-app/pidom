import { useEffect, useRef } from 'react';
import { useConvex } from 'convex/react';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';
import { OUTLINE_ENTRY_MAX } from '@convex-model/limits';
import { openPdf, readOutline, type PDFDocumentProxy } from '@/features/reader/pdf/engine';
import { useImports } from '../data/use-imports';

/**
 * A headless watcher that finishes the desktop half of a document's probe.
 *
 * A desktop-imported PDF is registered before anything has read the file, so the
 * account holds it as `processing: 'probing'` with no page count and no contents
 * — the mobile importer fills those from its one `<Pdf>` load, and until this
 * existed a desktop-only document never got them. This is that load: for each
 * reconciled import it opens the copy already on disk (never pulling one from the
 * cloud just to read it), counts the pages, flattens the outline, and pushes both
 * up with `setProcessed`, exactly as the phone does.
 *
 * The server's own `processing` flag is the durable ledger of what still needs a
 * probe, so a document imported while the app was closed is picked up on the next
 * launch, and one already `ready` is skipped without reopening it. Within a
 * session an in-memory set stops a failed probe from spinning; a genuine failure
 * leaves the document `probing`, and a later session tries again. Everything here
 * is best-effort — a probe that cannot run never touches the import itself.
 *
 * Mounted once at the app root (like `ImportBatchToaster`) so a single pass runs
 * regardless of how many `useImports` consumers are on screen.
 */
export function ImportProber() {
  const { jobs } = useImports();
  const convex = useConvex();
  // Documents this session has already tried, so the effect does not re-open a
  // file each time the jobs snapshot changes. Durable de-duplication is the
  // server's `processing` flag, checked per document below.
  const attempted = useRef<Set<string>>(new Set());
  const busy = useRef(false);

  useEffect(() => {
    if (busy.current) return;
    const pending = jobs.filter(
      (job) => job.documentId !== null && !attempted.current.has(job.documentId),
    );
    if (pending.length === 0) return;

    busy.current = true;
    void (async () => {
      try {
        for (const job of pending) {
          const documentId = job.documentId;
          if (!documentId) continue;
          attempted.current.add(documentId);
          await probe(convex, documentId as Id<'documents'>);
        }
      } finally {
        busy.current = false;
      }
    })();
  }, [jobs, convex]);

  return null;
}

/** Probes one document if it still needs it and its bytes are on this computer.
 *  Never throws: a failure leaves the document `probing` for a later attempt. */
async function probe(
  convex: ReturnType<typeof useConvex>,
  documentId: Id<'documents'>,
): Promise<void> {
  // Only documents the server still lists as `probing` need this; skip anything
  // already finished (or that is not ours / not yet synced / unreachable offline).
  let doc: { processing: string } | null;
  try {
    doc = await convex.query(api.library.document, { documentId });
  } catch {
    return;
  }
  if (!doc || doc.processing !== 'probing') return;

  // Read only a copy already on disk. `openDocument` would otherwise fetch the
  // file from the cloud, and downloading a document purely to count its pages is
  // not worth the bytes — a later session probes it once it is downloaded.
  const status = await window.pidom.storage.status(documentId).catch(() => null);
  if (!status || status.state !== 'available') return;

  // A signed URL lets main fall back to the cloud if the local copy vanished
  // between the check above and the open; a failed mint (offline, local-only) is
  // fine — `openDocument` resolves the on-disk copy from the id.
  let signedUrl: string | null = null;
  try {
    signedUrl = await convex.mutation(api.library.downloadUrl, { documentId, what: 'document' });
  } catch {
    signedUrl = null;
  }

  let handle: string | null = null;
  let destroy: (() => void) | null = null;
  let pdf: PDFDocumentProxy | null = null;
  try {
    const opened = await window.pidom.reader.openDocument({
      documentId,
      signedUrl: signedUrl ?? '',
    });
    handle = opened.handle;
    const task = openPdf(opened.url);
    destroy = task.destroy;
    pdf = await task.promise;

    const pageCount = pdf.numPages;
    const outline = (await readOutline(pdf)).slice(0, OUTLINE_ENTRY_MAX);
    await convex.mutation(api.library.setProcessed, {
      documentId,
      processing: 'ready',
      pageCount,
      outline,
    });

    // Render page 1 to a bounded JPEG and attach it as the cover. This is the one
    // place a desktop cover can be made — pdfjs runs only in the renderer — and
    // until it existed a desktop-imported document never got one, so every tile
    // and collection mosaic drew the lettered fallback. The bytes go to main,
    // which does the R2 PUT (the renderer's CSP has no `connect-src` for R2). Its
    // own try/catch: the probe above already landed, and a cover is decoration —
    // a render or upload failure must never undo a `ready` document.
    try {
      const jpeg = await renderCoverJpeg(pdf);
      if (jpeg) await window.pidom.storage.attachCover(documentId, jpeg);
    } catch {
      /* best-effort: the document stays `ready` and keeps the fallback cover */
    }
  } catch {
    /* best-effort: the document stays `probing` and a later session retries */
  } finally {
    destroy?.();
    void pdf?.destroy();
    if (handle) void window.pidom.reader.closeDocument(handle);
  }
}

/** Backing-store width of a rendered cover, in pixels. Wide enough to stay crisp
 *  on the ~148px collection mosaic cells and 120px grid tiles at 2×, small enough
 *  that a quality-0.8 JPEG sits far under the server's COVER_BYTE_MAX (512 KB). */
const COVER_RENDER_WIDTH = 640;

/**
 * Renders page 1 to a bounded JPEG, or null when the canvas cannot encode one.
 *
 * The size is deterministic regardless of the display: the backing store is sized
 * to `COVER_RENDER_WIDTH` directly rather than scaled by `devicePixelRatio` (as
 * the reader's `renderPageToCanvas` is, to stay sharp on any monitor), so the
 * encoded bytes stay predictable and well under the cover cap on every machine.
 * The canvas is never attached to the DOM — pdfjs paints an offscreen one fine.
 */
async function renderCoverJpeg(pdf: PDFDocumentProxy): Promise<ArrayBuffer | null> {
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: COVER_RENDER_WIDTH / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return null;
  await page.render({ canvasContext: context, viewport }).promise;
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.8),
  );
  return blob ? blob.arrayBuffer() : null;
}
