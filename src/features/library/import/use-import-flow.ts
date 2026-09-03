import { File } from 'expo-file-system';
import { useMutation } from 'convex/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { CLOUD_BYTE_MAX, TITLE_MAX } from '@convex/model/limits';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { log } from '@/lib/logger';
import { useLocalLibraryStore } from '@/stores/local-library-store';

import type { CoverResult } from '../components/cover-renderer';
import { messageOf } from '../data/errors';
import { useLibraryActions } from '../data/use-library-actions';
import { useLibraryStatus } from '../data/use-library-status';
import { discardStaged, pickPdf, removeLocally, storeLocally } from '../local/import';
import { coverFile, ensureCoversDirectory } from '../local/paths';

const SCOPE = 'import-flow';

/**
 * The import screen's state, and the order things happen in.
 *
 * The order is the whole design. Nothing is written until the reader commits,
 * so cancelling leaves no row and no file — and the cover renders while they
 * are still reading the title, so the slowest step is free.
 *
 * On commit the sequence is: mint the row, move the PDF, move the cover, then
 * upload. Every step after the first rolls the row back if it fails, because a
 * row with no file behind it reads as permanently "not on this device" with
 * nothing the reader could do.
 */

export type PickedFile = {
  /** The staged copy, under a path this app owns. See `stagingDirectory`. */
  uri: string;
  byteSize: number;
  /** From the cover render, which is the first thing that can count pages. */
  pageCount: number | null;
  /** The rendered first page, in the cache directory until there is an id. */
  coverUri: string | null;
  /** True once the render has reported, whether or not it produced anything. */
  coverAttempted: boolean;
};

/**
 * `saving` covers the row, the file move and the cover move. There is no
 * `uploading`: the upload outlives this screen, and the tile carries it.
 */
export type ImportStage = 'idle' | 'picking' | 'ready' | 'saving' | 'done' | 'cancelled';

export function useImportFlow() {
  const { offline, hasNetwork, profileId } = useLibraryStatus();
  const { syncDocument } = useLibraryActions();
  const importDocument = useMutation(api.library.importDocument);
  const removeDocument = useMutation(api.library.remove);
  const markPresent = useLocalLibraryStore((state) => state.markPresent);
  const showToast = useAppToast();

  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [stage, setStage] = useState<ImportStage>('idle');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [sync, setSync] = useState(true);

  const oversize = picked !== null && picked.byteSize > CLOUD_BYTE_MAX;
  const canSync = !offline && !oversize;

  /**
   * Why the toggle is off, when it is off, in the reader's terms.
   *
   * `null` when it is available — the row then explains what syncing does
   * instead of why it cannot.
   */
  const syncBlockedBecause = oversize
    ? `Over the ${Math.round(CLOUD_BYTE_MAX / 1024 / 1024)} MB sync limit, so this one stays on this phone. It still opens here with no connection.`
    : offline
      ? hasNetwork
        ? 'Syncing needs Pidom to be reachable. You can add it now and sync later.'
        : 'Syncing needs a connection. You can add it now and sync later.'
      : null;

  const picking = useCallback(async () => {
    setStage('picking');
    const result = await pickPdf();

    if (!result.ok) {
      if (result.reason === 'not-a-pdf') {
        showToast({
          id: 'import',
          tone: 'error',
          title: 'That is not a PDF',
          description: 'Pidom reads PDFs. Pick a file ending in .pdf.',
        });
      } else if (result.reason === 'no-size') {
        showToast({
          id: 'import',
          tone: 'error',
          title: "Couldn't read that file",
          description: 'The file appears to be empty.',
        });
      } else if (result.reason === 'unknown') {
        showToast({ id: 'import', tone: 'error', title: "Couldn't open the file picker" });
      }
      // `cancelled` says nothing. The reader closed the sheet; they know.
      setStage('cancelled');
      return;
    }

    setTitle(result.document.title.slice(0, TITLE_MAX));
    setPicked({
      uri: result.document.uri,
      byteSize: result.document.byteSize,
      pageCount: null,
      coverUri: null,
      coverAttempted: false,
    });
    // A document that cannot be synced starts with the toggle off, so the
    // control agrees with the sentence next to it.
    setSync(result.document.byteSize <= CLOUD_BYTE_MAX);
    setStage('ready');
  }, [showToast]);

  const onCoverReady = useCallback((result: CoverResult | null) => {
    setPicked((current) =>
      current === null
        ? current
        : {
            ...current,
            coverAttempted: true,
            coverUri: result?.uri ?? null,
            pageCount: result?.pageCount ?? null,
          },
    );
  }, []);

  const commit = useCallback(async () => {
    if (picked === null || profileId === null || title.trim() === '') {
      return;
    }

    setStage('saving');
    let documentId: Id<'documents'> | null = null;

    try {
      documentId = await importDocument({
        title: title.trim(),
        ...(author.trim() === '' ? {} : { author: author.trim() }),
        byteSize: picked.byteSize,
      });

      storeLocally(profileId, documentId, picked.uri);

      // The cover was rendered before there was an id to name it after, so it
      // moves into place now. Its failure is survivable: the tinted fallback is
      // a working state, and losing a document over a thumbnail would not be.
      if (picked.coverUri !== null) {
        try {
          ensureCoversDirectory(profileId);
          const destination = coverFile(profileId, documentId);
          if (destination.exists) {
            destination.delete();
          }
          new File(picked.coverUri).move(destination);
        } catch (error) {
          log.debug(SCOPE, 'could not keep the cover', error);
        }
      }

      markPresent(documentId);
      // `storeLocally` and the cover move both *move*, so staging is already
      // empty. Marking it committed is what stops the unmount cleanup below
      // from hunting for files that are now in the library.
      committedRef.current = true;
    } catch (error) {
      if (documentId !== null) {
        // The row exists and the file does not. Take the row back rather than
        // leave a document that can never be opened or explained.
        removeLocally(profileId, documentId);
        await removeDocument({ documentId }).catch(() => undefined);
      }
      showToast({
        id: 'import',
        tone: 'error',
        title: "Couldn't add the document",
        description: messageOf(error, 'There may not be enough space on this device.'),
      });
      setStage('ready');
      return;
    }

    if (sync && canSync) {
      // Deliberately not awaited. A 100 MB upload over slow data is minutes the
      // reader would spend on a screen with a Cancel they cannot use; the tile
      // draws the progress from `useTransferStore` and the document is already
      // fully usable here either way. A failure raises its own toast and leaves
      // a local-only document behind, which is the same state as choosing not
      // to sync and needs no rollback.
      void syncDocument(documentId, picked.byteSize);
    }

    setStage('done');
  }, [
    picked,
    profileId,
    title,
    author,
    sync,
    canSync,
    importDocument,
    removeDocument,
    markPresent,
    syncDocument,
    showToast,
  ]);

  /**
   * Deletes the staged file if the screen closes without committing.
   *
   * Through refs and a cleanup with no dependencies, deliberately. A cleanup
   * keyed on `picked` would run every time the cover render updates it, and
   * delete the file the reader is still looking at.
   */
  const stagedRef = useRef<{ pdf: string; cover: string | null } | null>(null);
  const committedRef = useRef(false);

  stagedRef.current =
    picked === null ? null : { pdf: picked.uri, cover: picked.coverUri };

  useEffect(() => {
    return () => {
      if (committedRef.current) {
        return;
      }
      const staged = stagedRef.current;
      if (staged !== null) {
        discardStaged(staged.pdf);
        if (staged.cover !== null) {
          discardStaged(staged.cover);
        }
      }
    };
  }, []);

  return {
    picked,
    picking,
    stage,
    title,
    author,
    sync,
    canSync,
    syncBlockedBecause,
    setTitle,
    setAuthor,
    setSync,
    onCoverReady,
    commit,
  };
}
