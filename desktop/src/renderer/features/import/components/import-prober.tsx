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
  } catch {
    /* best-effort: the document stays `probing` and a later session retries */
  } finally {
    destroy?.();
    void pdf?.destroy();
    if (handle) void window.pidom.reader.closeDocument(handle);
  }
}
