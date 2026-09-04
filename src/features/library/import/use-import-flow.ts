import { useConvex, useMutation } from 'convex/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { CLOUD_BYTE_MAX, TITLE_MAX } from '@convex/model/limits';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { log } from '@/lib/logger';
import { useLocalLibraryStore } from '@/stores/local-library-store';

import type { OutlineEntry, ProbeResult } from '../components/document-probe';
import type { LibraryDocument } from '../data/types';
import { messageOf } from '../data/errors';
import { useLibraryActions } from '../data/use-library-actions';
import { useLibraryStatus } from '../data/use-library-status';
import {
  discardStaged,
  pickPdf,
  removeLocally,
  storeLocally,
  titleFromFilename,
} from '../local/import';
import { copyCoverFrom, keepCover } from '../local/paths';
import { fingerprintOf, readsAsPdf, sizeOf } from '../local/validate';

const SCOPE = 'import-flow';

/**
 * The import screen's state, and the order things happen in.
 *
 * The order is the whole design. Nothing is written until the reader commits,
 * so cancelling leaves no row and no file — and the probe runs while they are
 * still reading the title, so the slowest step is free.
 *
 * On commit the sequence is: mint the row, move the PDF, move the cover, record
 * what the probe found, then upload. Every step through the cover move rolls
 * the row back if it fails, because a row with no file behind it reads as
 * permanently "not on this device" with nothing the reader could do.
 *
 * Two things can end an import before it starts, and both are new: a file whose
 * bytes are not a PDF (checked in `pickPdf`, before anything is staged) and a
 * PDF with a password (found by the probe, which is the only thing that can
 * tell). Both used to import cleanly and fail silently later.
 */

export type PickedFile = {
  /** The staged copy, under a path this app owns. See `stagingDirectory`. */
  uri: string;
  byteSize: number;
  /**
   * What the file was called when it was picked.
   *
   * Presentation metadata, never a path — the document id is the filename. It
   * is kept because renaming otherwise destroys the only record of what the
   * reader actually chose, which is the one thing they can search their own
   * downloads folder by.
   */
  originalFileName: string;
  /** What the picker claimed. A fact about the import; the bytes decided. */
  mimeType: string | null;
  /** From the probe. `null` until it reports. */
  pageCount: number | null;
  /** The rendered first page, in the cache directory until there is an id. */
  coverUri: string | null;
  /** The document's own table of contents. Empty for most PDFs. */
  outline: OutlineEntry[];
  /** True once the probe has reported, whatever it reported. */
  probed: boolean;
  /** `<size>-<sha256 of both ends>`, or `null` if it could not be taken. */
  fingerprint: string | null;
};

/**
 * `saving` covers the row, the file move, the cover move and the probe record.
 * There is no `uploading`: the upload outlives this screen, and the tile carries
 * it. `refused` is the terminal state for a file Pidom will not take.
 */
export type ImportStage =
  | 'idle'
  | 'picking'
  | 'ready'
  | 'saving'
  | 'done'
  | 'cancelled'
  | 'refused';

/** Why a file was refused, in the terms the screen renders a sentence from. */
export type Refusal = 'not-a-pdf' | 'encrypted' | 'unreadable' | 'no-size';

export function useImportFlow() {
  const { offline, hasNetwork, profileId } = useLibraryStatus();
  const { syncDocument } = useLibraryActions();
  const convex = useConvex();
  const importDocument = useMutation(api.library.importDocument);
  const setProcessed = useMutation(api.library.setProcessed);
  const removeDocument = useMutation(api.library.remove);
  const markPresent = useLocalLibraryStore((state) => state.markPresent);
  const showToast = useAppToast();

  /**
   * The staged file and its cover, for the cleanup that has to run without
   * depending on them.
   *
   * Through refs and a cleanup with no dependencies, deliberately: an effect
   * keyed on `picked` would run every time the probe updates it, and delete the
   * file the reader is still looking at. Declared here rather than beside that
   * effect because `picking` reads them too — a second pick has to discard the
   * first one's file, and by then `stagedRef` is about to be overwritten.
   */
  const stagedRef = useRef<{ pdf: string; cover: string | null } | null>(null);
  const committedRef = useRef(false);

  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [stage, setStage] = useState<ImportStage>('idle');
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [duplicate, setDuplicate] = useState<LibraryDocument | null>(null);
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

  /**
   * Fingerprints the staged file and asks whether the account already has it.
   *
   * Alongside the probe rather than before it: hashing both ends of the file is
   * fast, the probe is not, and neither blocks the reader typing a title.
   *
   * Both writes check they are still about the file they started on. A refusal
   * followed by "Choose another file" leaves this in flight against the old
   * pick, and without the guard it would hang the previous document's
   * fingerprint — and its duplicate warning — on the new one.
   */
  const identify = useCallback(
    async (uri: string) => {
      const fingerprint = await fingerprintOf(uri);
      if (fingerprint === null) {
        return;
      }
      setPicked((current) =>
        current === null || current.uri !== uri ? current : { ...current, fingerprint },
      );

      // A one-shot read rather than `useQuery`. The answer is needed once, at a
      // moment this function already owns, and a subscription would keep a
      // socket open on a question that cannot change while the screen is up.
      try {
        const existing = await convex.query(api.library.findByFingerprint, { fingerprint });
        if (stagedRef.current?.pdf === uri) {
          setDuplicate(existing);
        }
      } catch (error) {
        // A duplicate warning is a courtesy. Losing it must not cost an import.
        log.debug(SCOPE, 'could not check for a duplicate', error);
      }
    },
    [convex],
  );

  const picking = useCallback(async () => {
    // "Choose another file" comes back through here after a refusal, and the
    // file that was refused is still staged. The unmount cleanup would not
    // reach it: `stagedRef` is about to be overwritten with the new pick.
    const previous = stagedRef.current;
    if (previous !== null && !committedRef.current) {
      discardStaged(previous.pdf);
      if (previous.cover !== null) {
        discardStaged(previous.cover);
      }
    }

    setPicked(null);
    setDuplicate(null);
    setRefusal(null);
    setStage('picking');
    const result = await pickPdf();

    if (!result.ok) {
      if (result.reason === 'cancelled') {
        // The reader closed the sheet. They know; there is nothing to say.
        setStage('cancelled');
        return;
      }
      if (result.reason === 'unknown') {
        showToast({ id: 'import', tone: 'error', title: "Couldn't open the file picker" });
        setStage('cancelled');
        return;
      }
      // `not-a-pdf` and `no-size` are refusals about the file itself, and they
      // get a screen rather than a toast: there is nothing left on the form to
      // decide, because the document is not going to exist.
      setRefusal(result.reason);
      setStage('refused');
      return;
    }

    setTitle(result.document.title.slice(0, TITLE_MAX));
    setPicked({
      uri: result.document.uri,
      byteSize: result.document.byteSize,
      originalFileName: result.document.originalFileName,
      mimeType: result.document.mimeType,
      pageCount: null,
      coverUri: null,
      outline: [],
      probed: false,
      fingerprint: null,
    });
    // A document that cannot be synced starts with the toggle off, so the
    // control agrees with the sentence next to it.
    setSync(result.document.byteSize <= CLOUD_BYTE_MAX);
    setStage('ready');

    void identify(result.document.uri);
  }, [identify, showToast]);

  /**
   * Takes a file another app handed over, instead of opening the picker.
   *
   * The same screen, the same probe and the same commit — only the first step
   * differs, because the system already chose the file. It is validated here
   * rather than trusted: an app can hand Pidom anything, and "Open with" is a
   * path into the library that never went past `pickPdf`.
   *
   * The file is already staged by `useIncomingDocument`, under a UUID in the
   * directory the picker's copies live in, so the unmount cleanup and the
   * commit both work on it unchanged.
   */
  const adopt = useCallback(
    (uri: string, name: string | null) => {
      if (!readsAsPdf(uri)) {
        // The same refusal the picker path gives, for the same reason. Another
        // app's idea of a PDF is exactly as trustworthy as a filename.
        discardStaged(uri);
        setRefusal('not-a-pdf');
        setStage('refused');
        return;
      }

      const size = sizeOf(uri);
      if (size === null) {
        discardStaged(uri);
        setRefusal('no-size');
        setStage('refused');
        return;
      }

      const fileName = name ?? 'Document.pdf';
      setTitle(titleFromFilename(fileName).slice(0, TITLE_MAX));
      setPicked({
        uri,
        byteSize: size,
        originalFileName: fileName,
        // The system handed this over *because* it is a PDF, which is a
        // stronger statement than the picker's guess — but it is still a claim,
        // and the bytes above are what actually decided.
        mimeType: 'application/pdf',
        pageCount: null,
        coverUri: null,
        outline: [],
        probed: false,
        fingerprint: null,
      });
      setSync(size <= CLOUD_BYTE_MAX);
      setStage('ready');

      void identify(uri);
    },
    [identify],
  );

  const onProbed = useCallback((result: ProbeResult) => {
    if (!result.ok) {
      // The file cannot be read, so there is nothing to add. The staged copy is
      // cleaned up on the way out, or by the next `picking` if the reader
      // chooses another file.
      setRefusal(result.reason);
      setStage('refused');
      return;
    }
    setPicked((current) =>
      current === null
        ? current
        : {
            ...current,
            probed: true,
            coverUri: result.cover,
            pageCount: result.pageCount,
            outline: result.outline,
          },
    );
  }, []);

  const commit = useCallback(async () => {
    if (picked === null || profileId === null || title.trim() === '') {
      return;
    }

    setStage('saving');
    let created: Id<'documents'> | null = null;

    try {
      const documentId = await importDocument({
        title: title.trim(),
        ...(author.trim() === '' ? {} : { author: author.trim() }),
        byteSize: picked.byteSize,
        originalFileName: picked.originalFileName,
        ...(picked.mimeType === null ? {} : { mimeType: picked.mimeType }),
        ...(picked.pageCount === null ? {} : { pageCount: picked.pageCount }),
        ...(picked.fingerprint === null ? {} : { fingerprint: picked.fingerprint }),
      });
      created = documentId;

      storeLocally(profileId, documentId, picked.uri);

      // The cover was rendered before there was an id to name it after, so it
      // moves into place now. Its failure is survivable: the tinted fallback is
      // a working state, and losing a document over a thumbnail would not be.
      let coverKept = false;
      if (picked.coverUri !== null) {
        coverKept = keepCover(profileId, documentId, picked.coverUri);
      } else if (duplicate !== null) {
        // The reader is adding a second copy of a document this account already
        // has, so its first page has already been rendered once. Copying that
        // file is the whole of the work the probe is still doing, and it is the
        // one import where the answer is known before the question finishes.
        coverKept = copyCoverFrom(profileId, duplicate.id, documentId);
      }

      markPresent(documentId);
      // `storeLocally` and the cover move both *move*, so staging is already
      // empty. Marking it committed is what stops the unmount cleanup below
      // from hunting for files that are now in the library.
      committedRef.current = true;

      /**
       * What the probe found, or that it has not finished.
       *
       * The Add button is live the moment a file is picked and the probe takes a
       * second or two, so committing before it reports is the ordinary case
       * rather than an edge one. **A missing page count means "not yet", not
       * "unreadable"** — writing `failed` here marked a perfectly good PDF as
       * broken for ever, and the faster the reader tapped the worse it behaved.
       *
       * `probing` is a state the library knows how to leave: `usePendingProbe`
       * on the home screen picks the document up and finishes the job. That is
       * also what recovers a probe killed by the app going to the background.
       */
      const probed = picked.pageCount !== null;
      void setProcessed({
        documentId,
        processing: probed ? (coverKept ? 'ready' : 'partial') : 'probing',
        ...(probed ? { pageCount: picked.pageCount ?? undefined } : {}),
        // Always sent once the probe has reported, empty included: an absent
        // outline has to be able to clear a previous one.
        ...(probed ? { outline: picked.outline } : {}),
      }).catch((error: unknown) => {
        log.debug(SCOPE, 'could not record what the probe found', error);
      });
    } catch (error) {
      if (created !== null) {
        // The row exists and the file does not. Take the row back rather than
        // leave a document that can never be opened or explained.
        removeLocally(profileId, created);
        await removeDocument({ documentId: created }).catch(() => undefined);
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

    // `created` is non-null on every path that reaches here — the catch above
    // returns — but the check is written out rather than asserted away, because
    // an assertion is a claim about control flow that survives an edit and a
    // condition is not.
    if (created !== null && sync && canSync) {
      // Deliberately not awaited. A 100 MB upload over slow data is minutes the
      // reader would spend on a screen with a Cancel they cannot use; the tile
      // draws the progress from `useTransferStore` and the document is already
      // fully usable here either way. A failure raises its own toast and leaves
      // a local-only document behind, which is the same state as choosing not
      // to sync and needs no rollback.
      void syncDocument(created, picked.byteSize);
    }

    setStage('done');
  }, [
    picked,
    profileId,
    title,
    author,
    sync,
    canSync,
    duplicate,
    importDocument,
    setProcessed,
    removeDocument,
    markPresent,
    syncDocument,
    showToast,
  ]);

  stagedRef.current = picked === null ? null : { pdf: picked.uri, cover: picked.coverUri };

  /** Deletes the staged file if the screen closes without committing. */
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
    refusal,
    duplicate,
    title,
    author,
    sync,
    canSync,
    syncBlockedBecause,
    setTitle,
    setAuthor,
    setSync,
    /** Dismisses the duplicate notice — the reader chose to add it anyway. */
    dismissDuplicate: useCallback(() => setDuplicate(null), []),
    adopt,
    onProbed,
    commit,
  };
}
