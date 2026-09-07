/**
 * Everything this device holds about one document, removed together.
 *
 * There were five things a document leaves on a phone — the PDF, its cover, the
 * pictures of its pages, the mirrored copy of its text, and the password if the
 * reader asked this phone to remember one — and three different callers that
 * each removed a different subset of them. `deleteDocument` cleaned four and
 * left the cover. `removeDownload` cleaned four and left the cover. The home
 * screen's reconciliation, which is what runs when a document is deleted on
 * another phone, removed only the PDF: the reader's own document text, page
 * images and stored password stayed on the device indefinitely, for a document
 * that no longer existed anywhere.
 *
 * So there is one function, every caller uses it, and adding a sixth artifact
 * later is a change in one place rather than an audit of three.
 */
import { forgetPassword } from '@/features/reader/document-password';
import { useReaderStore } from '@/stores/reader-store';

import { removeLocally } from './import';
import { forgetCover, forgetPageThumbnails } from './paths';
import { forgetLocally } from './text-index';

export type SweepScope =
  /**
   * The file and everything derived from it, keeping the library row.
   *
   * "Remove download": the document stays in the account and in the library,
   * and a tap fetches it again. Deliberately keeps nothing that was rendered
   * from the file, because a cover left behind for a document that is not here
   * would put a picture on a tile that cannot be opened.
   */
  | 'download'
  /** The document is gone. Take the reading position and the password too. */
  | 'document';

/**
 * Removes a document's local artifacts.
 *
 * Every step is best effort and none of them throws: this runs after the
 * decision has already been made, and a cover that would not unlink is not a
 * reason to leave a reader looking at a document they asked to delete.
 */
export function sweepDocument(profileId: string, documentId: string, scope: SweepScope): void {
  removeLocally(profileId, documentId);
  forgetCover(profileId, documentId);
  forgetPageThumbnails(profileId, documentId);

  // The mirrored text goes with the file it describes. It is the reader's own
  // document content sitting in a database on this phone, and a delete that
  // leaves it behind is a delete that did not happen.
  void forgetLocally(profileId, documentId);

  if (scope === 'document') {
    // The page they got to, and the password if this phone was asked to
    // remember one. A credential outliving the document it unlocks is a
    // credential nothing will ever come back for.
    useReaderStore.getState().forgetPage(documentId);
    void forgetPassword(documentId);
  }
}
