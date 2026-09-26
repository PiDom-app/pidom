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
      // Minting a signed URL can fail for two benign reasons: a local-only
      // import carries a device-minted id Convex does not know yet, and offline
      // the mutation cannot run at all. Neither is fatal — main serves a staged
      // local copy straight from the id — so treat a failed mint as "no URL"
      // and let `openDocument` fall back to the local copy.
      let signedUrl: string | null = null;
      try {
        signedUrl = await convex.mutation(api.library.downloadUrl, {
          documentId,
          what: 'document',
        });
      } catch {
        signedUrl = null;
      }
      if (cancelled) return;

      let url: string;
      try {
        const opened = await window.pidom.reader.openDocument({
          documentId,
          signedUrl: signedUrl ?? '',
        });
        handle = opened.handle;
        url = opened.url;
      } catch {
        if (cancelled) return;
        // Main could neither find a local copy nor fetch one. With no URL to
        // begin with, there is genuinely nothing stored to open; with a URL
        // that failed, the open itself is at fault.
        setState({
          status: 'error',
          doc: null,
          pageCount: 0,
          firstPageSize: null,
          error: signedUrl ? OPEN_FAILED : NOT_SYNCED,
        });
        return;
      }
      if (cancelled) return;

      try {
        const task = openPdf(url);
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
