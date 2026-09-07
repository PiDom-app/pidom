import { useMemo } from 'react';

import type { LibraryDocument } from './types';

/**
 * The one document the library should read again, if there is one.
 *
 * A document lands in `probing` two ways, and both are ordinary rather than
 * exceptional. The Add button is live the moment a file is picked and the probe
 * takes a second or two, so a reader who taps promptly commits before it
 * reports — and the import screen closes, taking the probe with it. The other
 * way is the app going to the background mid-import, which kills the render the
 * same way.
 *
 * Before this existed, both left a document that said `Preparing…` for ever,
 * with no way out but finding Reprocess in a menu. The state was reachable and
 * had no exit.
 *
 * **One at a time.** A probe is a native `<Pdf>` view rendering a page and
 * snapshotting it; four of them mounted at once on a cold launch is the frame
 * budget spent on covers nobody is looking at yet. The next one starts when this
 * one reports, because the row changing is what re-runs this.
 *
 * Only for documents whose file is on this device — the probe reads the local
 * PDF, and a document that lives only in the account has nothing here to read.
 */
export function usePendingProbe(documents: LibraryDocument[]): LibraryDocument | null {
  return useMemo(() => {
    // Oldest first: a document that has been waiting through two launches
    // should not queue behind one imported a moment ago.
    let oldest: LibraryDocument | null = null;
    for (const document of documents) {
      if (document.processing !== 'probing' || document.fileState !== 'available') {
        continue;
      }
      if (oldest === null || document.createdAt < oldest.createdAt) {
        oldest = document;
      }
    }
    return oldest;
  }, [documents]);
}
