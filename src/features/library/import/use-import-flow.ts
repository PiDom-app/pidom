import { useCallback, useEffect, useRef, useState } from 'react';

import { CLOUD_BYTE_MAX, TITLE_MAX } from '@convex/model/limits';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { log } from '@/lib/logger';
import { useLocalLibraryStore } from '@/stores/local-library-store';

import type { OutlineEntry, ProbeResult } from '../components/document-probe';
import type { LibraryDocument } from '../data/types';
import { useLibraryStatus } from '../data/use-library-status';
import { database } from '../local/db';
import { mintId } from '../local/repository/ids';
import * as Documents from '../local/repository/documents';
import * as Files from '../local/repository/files';
import * as Queue from '../local/repository/queue';
import { roomFor } from '../local/space';
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
export type Refusal = 'not-a-pdf' | 'encrypted' | 'unreadable' | 'no-size' | 'no-space';

export function useImportFlow() {
  const { offline, hasNetwork, profileId } = useLibraryStatus();
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
  /** How big the file was that would not fit. Only set with a `no-space` refusal. */
  const [spaceNeeded, setSpaceNeeded] = useState<number | null>(null);
  const [duplicate, setDuplicate] = useState<LibraryDocument | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [sync, setSync] = useState(true);

  const oversize = picked !== null && picked.byteSize > CLOUD_BYTE_MAX;

  /**
   * Whether the copy for other devices can be asked for at all.
   *
   * Only the size decides now. Being offline used to force this off, because
   * the upload had to happen inside the import and there was nothing to hold
   * the intention: a reader in a tunnel was told no and had to remember to come
   * back. The intention is recorded on the row instead, and performed when
   * there is a connection.
   */
  const canSync = !oversize;

  /**
   * Why the toggle is off, when it is off, in the reader's terms.
   *
   * `null` when it is available — the row then explains what syncing does
   * instead of why it cannot.
   */
  const syncBlockedBecause = oversize
    ? `Over the ${Math.round(CLOUD_BYTE_MAX / 1024 / 1024)} MB sync limit, so this one stays on this phone. It still opens here with no connection.`
    : null;

  /**
   * A note beside an available toggle, when there is no connection.
   *
   * Not a refusal — the switch works and the copy will be made. It is here
   * because a reader who turns something on is owed the truth about when it
   * happens.
   */
  const syncDeferredBecause =
    !offline || oversize
      ? null
      : hasNetwork
        ? 'Pidom is not reachable right now, so the copy for your other devices is made when it is.'
        : 'There is no connection right now, so the copy for your other devices is made when there is one.';

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

      // Asked of this device rather than of the account, which is both faster
      // and the only version that works in a tunnel — the local database holds
      // every document the account does, so the answer is the same one.
      try {
        if (profileId === null) {
          return;
        }
        const db = await database(profileId);
        if (db === null) {
          return;
        }
        const existing = await Documents.findByFingerprint(db, fingerprint);
        if (stagedRef.current?.pdf === uri) {
          setDuplicate(existing);
        }
      } catch (error) {
        // A duplicate warning is a courtesy. Losing it must not cost an import.
        log.debug(SCOPE, 'could not check for a duplicate', error);
      }
    },
    [profileId],
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

      // Asked here rather than at the commit, because here is where nothing has
      // been written yet and the reader has not typed a title into a screen
      // that was always going to refuse them.
      if (!roomFor(size).ok) {
        discardStaged(uri);
        setSpaceNeeded(size);
        setRefusal('no-space');
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

  /**
   * Adds the document to this device, and tells the account afterwards.
   *
   * **This is the change that makes importing possible with no connection.**
   * The id used to come from `library.importDocument` and the id is the
   * filename, so there was nothing to name the file until a round trip
   * returned — which is why import was the one action that could not be queued
   * and had to refuse. The device mints it now.
   *
   * The file moves before the row is written, which is the reverse of the old
   * order and better for the same reason the old order was chosen: whichever
   * of the two can fail should go first. A move that fails leaves nothing
   * behind at all, where a row written first would need taking back.
   */
  const commit = useCallback(async () => {
    if (picked === null || profileId === null || title.trim() === '') {
      return;
    }

    setStage('saving');
    let created: string | null = null;

    try {
      const space = roomFor(picked.byteSize);
      if (!space.ok) {
        showToast({
          id: 'import',
          tone: 'error',
          title: 'Not enough room',
          description: space.message,
        });
        setStage('ready');
        return;
      }

      const db = await database(profileId);
      if (db === null) {
        throw new Error('The local library is not available.');
      }

      const documentId = mintId();
      created = documentId;

      storeLocally(profileId, documentId, picked.uri);

      await Documents.insertLocal(db, {
        id: documentId,
        title: title.trim(),
        author: author.trim() === '' ? null : author.trim(),
        pageCount: picked.pageCount,
        byteSize: picked.byteSize,
        fingerprint: picked.fingerprint,
        originalFileName: picked.originalFileName,
        mimeType: picked.mimeType,
      });

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

      await Files.setState(db, documentId, 'available', {
        localBytes: picked.byteSize,
        expectedBytes: picked.byteSize,
      });
      if (coverKept) {
        await Files.setCoverState(db, documentId, 'available');
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
      if (probed) {
        await Documents.patchLocal(db, documentId, {
          processing: coverKept ? 'ready' : 'partial',
          hasOutline: picked.outline.length > 0,
        });
        // Always stored once the probe has reported, empty included: an absent
        // outline has to be able to clear a previous one.
        await Documents.saveOutline(db, documentId, picked.outline);
      }

      // One row in the outbox, carrying the whole document. It is a create
      // rather than an update however many times the row is edited afterwards,
      // because the account has still never seen it.
      await Queue.enqueue(db, 'document', documentId, 'create');
    } catch (error) {
      if (created !== null) {
        // Whatever landed, take it back. There is no half-imported state worth
        // keeping, and nothing has been sent anywhere to undo.
        removeLocally(profileId, created);
        const db = await database(profileId);
        if (db !== null) {
          await Documents.purge(db, created).catch(() => undefined);
        }
      }
      showToast({
        id: 'import',
        tone: 'error',
        title: "Couldn't add the document",
        description: 'Something went wrong writing it to this device. Try again.',
      });
      log.debug(SCOPE, 'import failed', error);
      setStage('ready');
      return;
    }

    // `created` is non-null on every path that reaches here — the catch above
    // returns — but the check is written out rather than asserted away, because
    // an assertion is a claim about control flow that survives an edit and a
    // condition is not.
    if (created !== null && sync && canSync) {
      // Deliberately not awaited, and deliberately an intention rather than an
      // upload. The account has not met this document yet — its create is still
      // in the queue — so there is no id to upload against and nothing to
      // upload to. `use-sync-intents.ts` performs it once the create lands,
      // which is also what happens when the reader was offline. A 100 MB upload
      // over slow data is minutes nobody should spend on a screen whose Cancel
      // no longer means anything.
      const db = await database(profileId);
      if (db !== null) {
        await Documents.patchLocal(db, created, { syncIntent: 'upload' });
      }
    }

    setStage('done');
  }, [picked, profileId, title, author, sync, canSync, duplicate, markPresent, showToast]);

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
    syncDeferredBecause,
    spaceNeeded,
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
