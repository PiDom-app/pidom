import { useMutation } from 'convex/react';
import { useCallback } from 'react';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { CLOUD_BYTE_MAX } from '@convex/model/limits';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { useSession } from '@/features/auth/session-provider';
import { log } from '@/lib/logger';
import { useLocalLibraryStore } from '@/stores/local-library-store';
import { useTransferStore } from '@/stores/transfer-store';

import type { OutlineEntry } from '../components/document-probe';
import { removeLocally } from '../local/import';
import {
  coverFile,
  documentFile,
  forgetPageThumbnails,
  keepCover,
  localCoverUri,
} from '../local/paths';
import { forgetPassword } from '@/features/reader/document-password';
import { useReaderStore } from '@/stores/reader-store';
import { forgetLocally } from '../local/text-index';
import { downloadCover, downloadDocument, uploadFile } from '../local/transfer';
import type { LibraryDocument } from './types';
import { messageOf } from './errors';
import { useLibraryStatus } from './use-library-status';

const SCOPE = 'library-actions';

/**
 * Every write the library can make, with the local half attached.
 *
 * Deleting and syncing each touch two things that can fail independently — a
 * Convex row or a stored blob, and a file on disk — and the ordering and
 * cleanup for both live here rather than in whichever component had the button.
 *
 * Import is the exception and lives in `../import/use-import-flow.ts`, because
 * it has a screen's worth of state in front of it rather than a single call.
 */
export function useLibraryActions() {
  const importDocument = useMutation(api.library.importDocument);
  const removeDocument = useMutation(api.library.remove);
  const setFavorite = useMutation(api.library.setFavorite);
  const renameDocument = useMutation(api.library.rename);
  const uploadUrl = useMutation(api.library.uploadUrl);
  const downloadUrl = useMutation(api.library.downloadUrl);
  const syncMetadata = useMutation(api.r2.syncMetadata);
  const attachUpload = useMutation(api.library.attachUpload);
  const detachUpload = useMutation(api.library.detachUpload);
  const recordProgress = useMutation(api.library.recordProgress);
  const reprocessDocument = useMutation(api.library.reprocess);
  const setProcessed = useMutation(api.library.setProcessed);

  const { offline, hasNetwork, profileId } = useLibraryStatus();
  const { fetchIdToken } = useSession();
  const markPresent = useLocalLibraryStore((state) => state.markPresent);
  const markAbsent = useLocalLibraryStore((state) => state.markAbsent);
  const bumpCoverEpoch = useLocalLibraryStore((state) => state.bumpCoverEpoch);
  const startTransfer = useTransferStore((state) => state.start);
  const reportProgress = useTransferStore((state) => state.progress);
  const finishTransfer = useTransferStore((state) => state.finish);
  const showToast = useAppToast();

  /**
   * Deletes the row, then the file.
   *
   * That order, and not the other one: a file deleted before a failed mutation
   * is gone from a document the library still lists, which is the one outcome
   * with no way back. A row deleted before a failed unlink leaves a stray file,
   * which the next scan simply ignores.
   */
  const deleteDocument = useCallback(
    async (documentId: Id<'documents'>): Promise<boolean> => {
      if (profileId === null) {
        return false;
      }
      try {
        await removeDocument({ documentId });
      } catch (error) {
        showToast({
          id: 'delete',
          tone: 'error',
          title: "Couldn't delete",
          description: messageOf(error, 'Try again in a moment.'),
        });
        return false;
      }

      removeLocally(profileId, documentId);
      // The mirrored text goes with the file it describes. It is the reader's
      // own document content sitting in a database on this phone, and a delete
      // that leaves it behind is a delete that did not happen.
      void forgetLocally(profileId, documentId);
      // Same rule for what the reader left behind: the page they got to, and
      // the password if they asked this phone to remember one. A credential
      // outliving the document it unlocks is a credential nothing will ever
      // come back for.
      useReaderStore.getState().forgetPage(documentId);
      void forgetPassword(documentId);
      // And the pictures of its pages, for the same reason as the text: a
      // rendered page is the document's content, and it has no business
      // outliving the document.
      forgetPageThumbnails(profileId, documentId);
      markAbsent(documentId);
      return true;
    },
    [profileId, removeDocument, markAbsent, showToast],
  );

  const toggleFavorite = useCallback(
    async (documentId: Id<'documents'>, isFavorite: boolean) => {
      try {
        await setFavorite({ documentId, isFavorite });
      } catch (error) {
        showToast({
          id: 'favourite',
          tone: 'error',
          title: "Couldn't update",
          description: messageOf(error, 'Try again in a moment.'),
        });
      }
    },
    [setFavorite, showToast],
  );

  const rename = useCallback(
    async (documentId: Id<'documents'>, title: string, author: string) => {
      try {
        await renameDocument({ documentId, title, author });
        return true;
      } catch (error) {
        showToast({
          id: 'rename',
          tone: 'error',
          title: "Couldn't rename",
          description: messageOf(error, 'Try again in a moment.'),
        });
        return false;
      }
    },
    [renameDocument, showToast],
  );

  /**
   * Puts a document's PDF, and its cover, in the account.
   *
   * Three requests by design: `generateUploadUrl`, a POST straight to storage,
   * then `attachUpload`. Nothing in the middle request is under the server's
   * control, which is exactly why the third one recomputes the key and re-reads
   * the object's size, type and digest from R2 before linking it.
   *
   * The cover goes second and its failure is survivable — the tinted fallback
   * is a working state, and losing a document over a thumbnail would not be.
   */
  const syncDocument = useCallback(
    async (documentId: Id<'documents'>, byteSize: number): Promise<boolean> => {
      if (profileId === null) {
        return false;
      }
      if (offline) {
        showToast({
          id: 'sync',
          tone: 'error',
          title: hasNetwork ? "Can't reach Pidom" : "You're offline",
          description: 'Syncing needs a connection.',
        });
        return false;
      }
      if (byteSize > CLOUD_BYTE_MAX) {
        showToast({
          id: 'sync',
          tone: 'error',
          title: 'Too large to sync',
          description: `Documents over ${Math.round(CLOUD_BYTE_MAX / 1024 / 1024)} MB stay on the device that imported them.`,
        });
        return false;
      }

      startTransfer(documentId, 'upload');
      try {
        const pdf = documentFile(profileId, documentId);
        if (!pdf.exists) {
          showToast({ id: 'sync', tone: 'error', title: 'That document is not on this device' });
          return false;
        }

        const target = await uploadUrl({ documentId, what: 'document' });
        await uploadFile(pdf, target.url, 'application/pdf', ({ sent, total }) =>
          reportProgress(documentId, sent, total),
        );
        // The component records the object's size, type and digest from R2.
        // `attachUpload` reads them back to decide whether to link it, so this
        // has to land before that call.
        await syncMetadata({ key: target.key });

        let coverStorageKey: string | undefined;
        const cover = coverFile(profileId, documentId);
        if (cover.exists) {
          try {
            const coverTarget = await uploadUrl({ documentId, what: 'cover' });
            await uploadFile(cover, coverTarget.url, 'image/jpeg');
            await syncMetadata({ key: coverTarget.key });
            coverStorageKey = coverTarget.key;
          } catch (error) {
            // A cover is decoration. Losing one must not lose the document.
            log.debug(SCOPE, 'cover upload failed; keeping the document', error);
          }
        }

        await attachUpload({
          documentId,
          storageKey: target.key,
          ...(coverStorageKey === undefined ? {} : { coverStorageKey }),
        });
        return true;
      } catch (error) {
        showToast({
          id: 'sync',
          tone: 'error',
          title: "Couldn't sync",
          description: messageOf(error, 'Try again in a moment.'),
        });
        return false;
      } finally {
        finishTransfer(documentId);
      }
    },
    [
      profileId,
      offline,
      hasNetwork,
      uploadUrl,
      syncMetadata,
      attachUpload,
      startTransfer,
      reportProgress,
      finishTransfer,
      showToast,
    ],
  );

  /**
   * Frees the local copy of a synced document.
   *
   * Only ever offered for a document that is *both* here and in the account —
   * see the guard in `document-actions.tsx`. Doing this to a local-only
   * document would be a delete with no confirmation and no way back.
   *
   * No mutation: the row already knows the account still has it, and whether
   * this phone does is not the server's to record.
   */
  const removeDownload = useCallback(
    (documentId: Id<'documents'>): boolean => {
      if (profileId === null) {
        return false;
      }
      removeLocally(profileId, documentId);
      // Offline search is for documents that open offline, and this one no
      // longer does. It mirrors again if the reader downloads it back.
      void forgetLocally(profileId, documentId);
      // The password goes with the file; the page does not. The document is
      // still in the account and still has a position worth keeping, and the
      // copy that comes back may not even be encrypted the same way.
      void forgetPassword(documentId);
      // The thumbnails were rendered from the file that has just gone. They
      // would be re-rendered from the copy that comes back, and keeping stale
      // pictures of a document this phone no longer holds is the same mistake
      // as keeping its text.
      forgetPageThumbnails(profileId, documentId);
      markAbsent(documentId);
      return true;
    },
    [profileId, markAbsent],
  );

  /**
   * Marks a document read or unread.
   *
   * Through `recordProgress`, which is also what the reader calls: one path
   * writes reading state, and it clamps and derives on the server.
   *
   * Finishing jumps to the last page, because a book marked finished at page 12
   * would come back saying it was 4% read. **Unmarking leaves the page alone** —
   * unread means "not done with it", not "never opened", and sending somebody
   * who marked a book finished at 40% back to page one throws away a real
   * position with no undo.
   */
  const setFinished = useCallback(
    async (document: LibraryDocument, isFinished: boolean): Promise<boolean> => {
      try {
        await recordProgress({
          documentId: document.id,
          currentPage: isFinished
            ? (document.pageCount ?? document.currentPage)
            : document.currentPage,
          isFinished,
        });
        return true;
      } catch (error) {
        showToast({
          id: 'finished',
          tone: 'error',
          title: "Couldn't update",
          description: messageOf(error, 'Try again in a moment.'),
        });
        return false;
      }
    },
    [recordProgress, showToast],
  );

  /**
   * Runs the pipeline again for a document that came out of it incomplete.
   *
   * Two halves, and the caller supplies the first. The **device** half is a
   * probe against the local file, which only this phone can do — so
   * `onReprobe` is handed back to whatever screen can mount one, and it reports
   * through `recordProbe` below. The **cloud** half is one mutation, and only a
   * synced document has one to run.
   *
   * Both are offered together because a reader tapping Reprocess is not
   * thinking about which half failed.
   */
  const reprocess = useCallback(
    async (document: LibraryDocument): Promise<boolean> => {
      if (!document.isSynced) {
        // Nothing in the account to re-read. The device half still runs, and
        // the caller has already started it.
        return true;
      }
      try {
        await reprocessDocument({ documentId: document.id });
        return true;
      } catch (error) {
        showToast({
          id: 'reprocess',
          tone: 'error',
          title: "Couldn't reprocess",
          description: messageOf(error, 'Try again in a moment.'),
        });
        return false;
      }
    },
    [reprocessDocument, showToast],
  );

  /**
   * Records what a probe found, from wherever one was mounted.
   *
   * The import screen has its own path through `useImportFlow`, because there
   * the row does not exist yet. This is the one for a document already in the
   * library — a reprocess, or a probe that outlived the screen that started it.
   */
  const recordProbe = useCallback(
    async (
      documentId: Id<'documents'>,
      probe:
        | { ok: true; cover: string | null; pageCount: number; outline: OutlineEntry[] }
        | { ok: false; reason: 'encrypted' | 'unreadable' },
    ): Promise<void> => {
      if (!probe.ok) {
        await setProcessed({
          documentId,
          processing: 'failed',
          error: probe.reason === 'encrypted' ? 'ENCRYPTED' : 'UNREADABLE',
        }).catch(() => undefined);
        return;
      }

      // The cover is written before the row is told, so a tile that turns
      // `ready` has a cover behind it rather than one arriving a moment later.
      const coverKept =
        probe.cover !== null && profileId !== null
          ? keepCover(profileId, documentId, probe.cover)
          : false;
      if (coverKept) {
        bumpCoverEpoch();
      }

      await setProcessed({
        documentId,
        processing: coverKept ? 'ready' : 'partial',
        pageCount: probe.pageCount,
        // Always, empty included. Sending it only when non-empty meant a
        // reprocess could never *remove* a table of contents — a document whose
        // file no longer declares one kept the old entries and its Contents
        // button opened a list from a previous version of the file.
        outline: probe.outline,
      }).catch((error: unknown) => {
        log.debug(SCOPE, 'could not record what the probe found', error);
      });
    },
    [profileId, setProcessed, bumpCoverEpoch],
  );

  /** Removes the account's copy. The file on this device stays put. */
  const unsyncDocument = useCallback(
    async (documentId: Id<'documents'>): Promise<boolean> => {
      try {
        await detachUpload({ documentId });
        return true;
      } catch (error) {
        showToast({
          id: 'sync',
          tone: 'error',
          title: "Couldn't stop syncing",
          description: messageOf(error, 'Try again in a moment.'),
        });
        return false;
      }
    },
    [detachUpload, showToast],
  );

  /**
   * Fetches a synced document onto this device.
   *
   * Through the authenticated route, with the same Google ID token every query
   * carries. `fetchIdToken` is the one seam a credential leaves the session
   * through, and it refreshes on the way out if the current one is near expiry.
   */
  const fetchDocument = useCallback(
    async (documentId: Id<'documents'>): Promise<boolean> => {
      if (profileId === null) {
        return false;
      }
      startTransfer(documentId, 'download');
      try {
        const url = await downloadUrl({ documentId, what: 'document' });
        if (url === null) {
          showToast({ id: 'download', tone: 'error', title: 'That document is not in your account' });
          return false;
        }

        await downloadDocument(profileId, documentId, url, ({ sent, total }) =>
          reportProgress(documentId, sent, total),
        );
        markPresent(documentId);

        // Best effort, and after the document: a cover is worth a round trip
        // but never worth blocking the thing the reader asked for.
        if (localCoverUri(profileId, documentId) === null) {
          void downloadUrl({ documentId, what: 'cover' }).then((coverUrl) =>
            coverUrl === null ? undefined : downloadCover(profileId, documentId, coverUrl),
          );
        }
        return true;
      } catch (error) {
        showToast({
          id: 'download',
          tone: 'error',
          title: "Couldn't download",
          description: messageOf(error, 'Check your connection and try again.'),
        });
        return false;
      } finally {
        finishTransfer(documentId);
      }
    },
    [
      profileId,
      downloadUrl,
      startTransfer,
      reportProgress,
      finishTransfer,
      markPresent,
      showToast,
    ],
  );

  return {
    deleteDocument,
    toggleFavorite,
    rename,
    syncDocument,
    unsyncDocument,
    fetchDocument,
    removeDownload,
    setFinished,
    reprocess,
    recordProbe,
  };
}
