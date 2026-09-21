import { useEffect, useState } from 'react';
import { useConvex } from 'convex/react';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';
import { openPdf, pageSizeOf, type PageSize, type PDFDocumentProxy } from '../pdf/engine';

/**
 * The whole "resolve an id to renderable bytes" path, in one hook.
 *
 * It is the flow the plan settled on: the renderer mints a signed R2 URL through
 * Convex (which checks ownership), hands the short-lived URL to main to fetch
 * and verify, and opens the verified copy the engine is handed back. The
 * renderer never sees the object key, never fetches R2 itself, and never holds a
 * path — only a handle main will serve, and revoke when this unmounts.
 */

export type PdfStatus = 'loading' | 'ready' | 'error';

export interface PdfDocumentState {
  status: PdfStatus;
  doc: PDFDocumentProxy | null;
  pageCount: number;
  /** Page one at scale 1, so the canvas can size a layout before the first paint. */
  firstPageSize: PageSize | null;
  /** A reader-facing reason when `status` is `error`. */
  error: string | null;
}

const NOT_SYNCED =
  'This document is not stored in your account yet, so there is nothing here to open.';
const OPEN_FAILED = "This document couldn't be opened.";

export function usePdfDocument(documentId: Id<'documents'>): PdfDocumentState {
  const convex = useConvex();
  const [state, setState] = useState<PdfDocumentState>({
    status: 'loading',
    doc: null,
    pageCount: 0,
    firstPageSize: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let handle: string | null = null;
    let destroyTask: (() => void) | null = null;
    let doc: PDFDocumentProxy | null = null;

    setState({ status: 'loading', doc: null, pageCount: 0, firstPageSize: null, error: null });

    void (async () => {
      try {
        const signedUrl = await convex.mutation(api.library.downloadUrl, {
          documentId,
          what: 'document',
        });
        if (cancelled) return;
        if (!signedUrl) {
          setState({
            status: 'error',
            doc: null,
            pageCount: 0,
            firstPageSize: null,
            error: NOT_SYNCED,
          });
          return;
        }

        const opened = await window.pidom.reader.openDocument({ documentId, signedUrl });
        handle = opened.handle;
        if (cancelled) return;

        const task = openPdf(opened.url);
        destroyTask = task.destroy;
        doc = await task.promise;
        if (cancelled) return;

        const firstPageSize = pageSizeOf(await doc.getPage(1));
        if (cancelled) return;

        setState({ status: 'ready', doc, pageCount: doc.numPages, firstPageSize, error: null });
      } catch {
        if (cancelled) return;
        setState({
          status: 'error',
          doc: null,
          pageCount: 0,
          firstPageSize: null,
          error: OPEN_FAILED,
        });
      }
    })();

    return () => {
      cancelled = true;
      // Tear down in reverse: the render task first so it stops touching the
      // document, then the document, then the copy on disk in main.
      destroyTask?.();
      void doc?.destroy();
      if (handle) void window.pidom.reader.closeDocument(handle);
    };
  }, [convex, documentId]);

  return state;
}
