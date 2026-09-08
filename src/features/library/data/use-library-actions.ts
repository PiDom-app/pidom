import { useConvex, useMutation } from 'convex/react';
import { useCallback } from 'react';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { CLOUD_BYTE_MAX } from '@convex/model/limits';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { log } from '@/lib/logger';
import { useLocalLibraryStore } from '@/stores/local-library-store';
import { useTransferStore } from '@/stores/transfer-store';

import type { OutlineEntry } from '../components/document-probe';
import { database } from '../local/db';
import { coverFile, documentFile, keepCover, localCoverUri } from '../local/paths';
import * as Documents from '../local/repository/documents';
import * as Files from '../local/repository/files';
import * as Queue from '../local/repository/queue';
import { sweepDocument } from '../local/sweep';
import { BadDownload, downloadCover, downloadDocument, uploadFile } from '../local/transfer';
import { messageOf } from './errors';
import type { LibraryDocument } from './types';
import { useLibraryStatus } from './use-library-status';

const SCOPE = 'library-actions';

/**
 * Every write the library can make.
 *
 * **Local first, always.** Each of these commits to the device's own database
 * and puts one row in the outbox; the account is told when there is a
 * connection. Nothing here awaits a mutation, and nothing here fails because
 * the reader is in a tunnel — which is what every one of them used to do, with
 * a toast saying so.
 *
 * The exceptions are the two that move bytes, and they are exceptions for a
 * reason rather than an oversight. `library.uploadUrl` deletes whatever is at
 * the key before it signs a new URL, so replaying an upload would destroy the
 * copy in the account while the row went on claiming there was one — see
 * `sync/operations.ts`. A transfer is therefore live, foreground and once; a
 * reader who asks for one with no connection has the intention recorded on the
 * row, and `use-sync-intents.ts` performs it when there is one.
 *
 * Import is elsewhere, in `../import/use-import-flow.ts`, because it has a
 * screen's worth of state in front of it rather than a single call.
 */
export function useLibraryActions() {
  const client = useConvex();
  const uploadUrl = useMutation(api.library.uploadUrl);
  const downloadUrl = useMutation(api.library.downloadUrl);
  const syncMetadata = useMutation(api.r2.syncMetadata);
  const attachUpload = useMutation(api.library.attachUpload);
  const detachUpload = useMutation(api.library.detachUpload);
  const reprocessDocument = useMutation(api.library.reprocess);

  const { offline, hasNetwork, profileId } = useLibraryStatus();
  const markPresent = useLocalLibraryStore((state) => state.markPresent);
  const markAbsent = useLocalLibraryStore((state) => state.markAbsent);
  const bumpCoverEpoch = useLocalLibraryStore((state) => state.bumpCoverEpoch);
  const startTransfer = useTransferStore((state) => state.start);
  const reportProgress = useTransferStore((state) => state.progress);
  const finishTransfer = useTransferStore((state) => state.finish);
  const showToast = useAppToast();

  /**
   * Deletes it here, and tells the account later.
   *
   * The order that used to matter — row first, then file, so a failed mutation
   * could not strip a document the library still listed — is not a question any
   * more. There is one write, it is local, and it cannot half-succeed: the row
   * is marked deleted, the outbox is told, and the files go. If the account is
   * never reachable again the reader has still deleted their document, which is
   * what they asked for.
   */
  const deleteDocument = useCallback(
    async (documentId: string): Promise<boolean> => {
      if (profileId === null) {
        return false;
      }
      try {
        const db = await database(profileId);
        if (db === null) {
          return false;
        }

        /**
         * A document somebody else owns is removed from this phone and nowhere
         * else.
         *
         * There is nothing to tell the account: `library.remove` is the
         * owner's, the grant is theirs and stays until they take it back, and
         * the share row remains so the inbox can offer the download again. So
         * the row is purged rather than soft-deleted — a tombstone exists to
         * carry a delete to the account, and this delete has nowhere to go.
         */
        const mine = await Documents.isOwnedByMe(db, documentId);
        if (!mine) {
          await Queue.dropOperationsFor(db, 'annotation', await annotationIdsOf(db, documentId));
          await Documents.purge(db, documentId);
          sweepDocument(profileId, documentId, 'document');
          markAbsent(documentId);
          return true;
        }

        await Documents.softDelete(db, documentId);
        const outcome = await Queue.enqueue(db, 'document', documentId, 'remove');

        // Its marks, notes and memberships all cascade at the account, so
        // sending their operations first is work the cascade is about to undo
        // — and half of them would come back `FORBIDDEN` from a document that
        // is no longer there.
        await Queue.dropOperationsFor(db, 'annotation', await annotationIdsOf(db, documentId));

        sweepDocument(profileId, documentId, 'document');
        markAbsent(documentId);

        // A document the account never heard of leaves nothing behind to tell
        // it about.
        if (outcome === 'annihilated') {
          await Documents.purge(db, documentId);
        }
        return true;
      } catch (error) {
        showToast({
          id: 'delete',
          tone: 'error',
          title: "Couldn't delete",
          description: 'Something went wrong on this device. Try again.',
        });
        log.debug(SCOPE, 'delete failed', error);
        return false;
      }
    },
    [profileId, markAbsent, showToast],
  );

  const toggleFavorite = useCallback(
    async (documentId: string, isFavorite: boolean): Promise<boolean> => {
      return await patch(profileId, documentId, { isFavorite }, ['isFavorite']);
    },
    [profileId],
  );

  const rename = useCallback(
    async (documentId: string, title: string, author?: string): Promise<boolean> => {
      return await patch(
        profileId,
        documentId,
        { title, author: author ?? null },
        ['title', 'author'],
      );
    },
    [profileId],
  );

  /**
   * Marks a document read or unread.
   *
   * Finishing jumps to the last page, because a book marked finished at page 12
   * would come back saying it was 4% read. **Unmarking leaves the page alone** —
   * unread means "not done with it", not "never opened", and sending somebody
   * who marked a book finished at 40% back to page one throws away a real
   * position with no undo.
   */
  const setFinished = useCallback(
    async (document: LibraryDocument, isFinished: boolean): Promise<boolean> => {
      const currentPage = isFinished
        ? (document.pageCount ?? document.currentPage)
        : document.currentPage;
      const progress =
        document.pageCount === null || document.pageCount === 0
          ? document.progress
          : Math.min(1, currentPage / document.pageCount);

      return await patch(
        profileId,
        document.id,
        { isFinished, currentPage, progress },
        ['isFinished', 'currentPage', 'progress'],
      );
    },
    [profileId],
  );

  /**
   * The three requests, run once and in the foreground.
   *
   * Separate from `syncDocument` because `use-sync-intents.ts` calls it too:
   * an upload asked for with no connection is recorded on the row, and that
   * hook performs it when there is one.
   */
  const performUpload = useCallback(
    async (remoteId: string, localId: string): Promise<boolean> => {
      if (profileId === null) {
        return false;
      }
      const documentId = remoteId as Id<'documents'>;

      startTransfer(localId, 'upload');
      try {
        const pdf = documentFile(profileId, localId);
        if (!pdf.exists) {
          showToast({ id: 'sync', tone: 'error', title: 'That document is not on this device' });
          return false;
        }

        const target = await uploadUrl({ documentId, what: 'document' });
        await uploadFile(pdf, target.url, 'application/pdf', ({ sent, total }) =>
          reportProgress(localId, sent, total),
        );
        // The component records the object's size, type and digest from R2.
        // `attachUpload` reads them back to decide whether to link it, so this
        // has to land before that call.
        await syncMetadata({ key: target.key });

        let coverStorageKey: string | undefined;
        const cover = coverFile(profileId, localId);
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

        await patch(profileId, localId, { syncIntent: null }, []);
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
        finishTransfer(localId);
      }
    },
    [
      profileId,
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
   * Puts a document's PDF, and its cover, in the account.
   *
   * Three requests by design: `uploadUrl`, a PUT straight to storage, then
   * `attachUpload`. Nothing in the middle request is under the server's
   * control, which is exactly why the third one recomputes the key and re-reads
   * the object's size, type and digest from R2 before linking it.
   *
   * With no connection this records the intention on the row instead and
   * answers yes. The reader asked for a cloud copy; they will have one. What
   * they will not have is a queued `uploadUrl` waiting to delete the object it
   * is about to replace, in an app that may be killed in between.
   */
  const syncDocument = useCallback(
    async (document: LibraryDocument): Promise<boolean> => {
      if (profileId === null) {
        return false;
      }
      if (document.byteSize > CLOUD_BYTE_MAX) {
        showToast({
          id: 'sync',
          tone: 'error',
          title: 'Too large to sync',
          description: `Documents over ${Math.round(CLOUD_BYTE_MAX / 1024 / 1024)} MB stay on the device that imported them.`,
        });
        return false;
      }

      if (offline || document.remoteId === null) {
        await patch(profileId, document.id, { syncIntent: 'upload' }, []);
        showToast({
          id: 'sync',
          tone: 'info',
          title: 'Will sync when you are back online',
          description: 'It stays fully readable on this device in the meantime.',
        });
        return true;
      }

      return await performUpload(document.remoteId, document.id);
    },
    [profileId, offline, performUpload, showToast],
  );

  /**
   * Frees the local copy of a synced document.
   *
   * Only ever offered for a document that is *both* here and in the account —
   * see the guard in `document-actions.tsx`. Doing this to a local-only
   * document would be a delete with no confirmation and no way back.
   *
   * Nothing is sent: the row already knows the account still has it, and
   * whether this phone does is not the server's to record.
   */
  const removeDownload = useCallback(
    async (documentId: string): Promise<boolean> => {
      if (profileId === null) {
        return false;
      }
      // The password goes with the file; the page does not. The document is
      // still in the account and still has a position worth keeping, and the
      // copy that comes back may not even be encrypted the same way.
      sweepDocument(profileId, documentId, 'download');
      markAbsent(documentId);

      const db = await database(profileId);
      if (db !== null) {
        await Files.setState(db, documentId, 'missing');
      }
      return true;
    },
    [profileId, markAbsent],
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
   * The cloud half is the one write in this file that is not queued, and that
   * is deliberate: reprocessing cancels a running extraction and starts
   * another, so a queued one that arrived twice would be two more runs of a
   * Node action over a 32 MB file. It is offered when there is a connection and
   * skipped when there is not; the device half runs either way, which is the
   * half a reader tapping Reprocess can actually see.
   */
  const reprocess = useCallback(
    async (document: LibraryDocument): Promise<boolean> => {
      if (!document.isSynced || document.remoteId === null || offline) {
        return true;
      }
      try {
        await reprocessDocument({ documentId: document.remoteId as Id<'documents'> });
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
    [offline, reprocessDocument, showToast],
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
      documentId: string,
      probe:
        | { ok: true; cover: string | null; pageCount: number; outline: OutlineEntry[] }
        | { ok: false; reason: 'encrypted' | 'unreadable' },
    ): Promise<void> => {
      if (profileId === null) {
        return;
      }
      const db = await database(profileId);
      if (db === null) {
        return;
      }

      if (!probe.ok) {
        await Documents.patchLocal(db, documentId, {
          processing: 'failed',
          processingError: probe.reason === 'encrypted' ? 'ENCRYPTED' : 'UNREADABLE',
        });
        await Queue.enqueue(db, 'document', documentId, 'update', ['processing']);
        return;
      }

      // The cover is written before the row is told, so a tile that turns
      // `ready` has a cover behind it rather than one arriving a moment later.
      const coverKept = probe.cover !== null && keepCover(profileId, documentId, probe.cover);
      if (coverKept) {
        await Files.setCoverState(db, documentId, 'available');
        bumpCoverEpoch();
      }

      await Documents.patchLocal(db, documentId, {
        processing: coverKept ? 'ready' : 'partial',
        processingError: null,
        pageCount: probe.pageCount,
        hasOutline: probe.outline.length > 0,
      });
      // Always, empty included. Storing it only when non-empty meant a
      // reprocess could never *remove* a table of contents — a document whose
      // file no longer declares one kept the old entries and its Contents
      // button opened a list from a previous version of the file.
      await Documents.saveOutline(db, documentId, probe.outline);
      await Queue.enqueue(db, 'document', documentId, 'update', [
        'processing',
        'pageCount',
        'hasOutline',
      ]);
    },
    [profileId, bumpCoverEpoch],
  );

  /** Removes the account's copy. The file on this device stays put. */
  const unsyncDocument = useCallback(
    async (document: LibraryDocument): Promise<boolean> => {
      if (document.remoteId === null) {
        return true;
      }
      try {
        await detachUpload({ documentId: document.remoteId as Id<'documents'> });
        if (profileId !== null) {
          await patch(profileId, document.id, { syncIntent: null }, []);
        }
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
    [profileId, detachUpload, showToast],
  );

  /**
   * Fetches a synced document onto this device.
   *
   * Takes the document rather than its id, because the bytes that arrive have
   * to be checked against something: the size the account recorded, and the
   * fingerprint if it has one. A download that finished is not the same fact as
   * a document that opens — see `downloadDocument`.
   */
  const fetchDocument = useCallback(
    async (document: LibraryDocument): Promise<boolean> => {
      if (profileId === null || document.remoteId === null) {
        return false;
      }
      const documentId = document.remoteId as Id<'documents'>;
      const db = await database(profileId);

      startTransfer(document.id, 'download');
      if (db !== null) {
        await Files.setState(db, document.id, 'downloading', { expectedBytes: document.byteSize });
      }

      try {
        const url = await downloadUrl({ documentId, what: 'document' });
        if (url === null) {
          showToast({ id: 'download', tone: 'error', title: 'That document is not in your account' });
          if (db !== null) {
            await Files.setState(db, document.id, 'missing');
          }
          return false;
        }

        await downloadDocument(
          profileId,
          document.id,
          url,
          { byteSize: document.byteSize, fingerprint: document.fingerprint },
          ({ sent, total }) => reportProgress(document.id, sent, total),
        );

        if (db !== null) {
          await Files.setState(db, document.id, 'available', {
            localBytes: document.byteSize,
            expectedBytes: document.byteSize,
          });
        }
        markPresent(document.id);

        // Best effort, and after the document: a cover is worth a round trip
        // but never worth blocking the thing the reader asked for.
        if (localCoverUri(profileId, document.id) === null) {
          void downloadUrl({ documentId, what: 'cover' }).then(async (coverUrl) => {
            if (coverUrl === null) {
              return;
            }
            if (await downloadCover(profileId, document.id, coverUrl)) {
              bumpCoverEpoch();
              if (db !== null) {
                await Files.setCoverState(db, document.id, 'available');
              }
            }
          });
        }
        return true;
      } catch (error) {
        // A file that arrived and is not the document is a different state from
        // one that never arrived, and the tile offers a different thing for it.
        const broken = error instanceof BadDownload && error.reason !== 'no-space';
        if (db !== null) {
          await Files.setState(db, document.id, broken ? 'corrupt' : 'missing', {
            failure: error instanceof BadDownload ? error.reason : null,
          });
        }
        showToast({
          id: 'download',
          tone: 'error',
          title: broken ? "That download didn't arrive whole" : "Couldn't download",
          description:
            error instanceof BadDownload && error.reason === 'no-space'
              ? 'There is not enough room on this device.'
              : broken
                ? 'Nothing was kept. Try again when you have a steadier connection.'
                : messageOf(error, 'Check your connection and try again.'),
        });
        return false;
      } finally {
        finishTransfer(document.id);
      }
    },
    [
      profileId,
      downloadUrl,
      startTransfer,
      reportProgress,
      finishTransfer,
      markPresent,
      bumpCoverEpoch,
      showToast,
    ],
  );

  return {
    deleteDocument,
    toggleFavorite,
    rename,
    setFinished,
    syncDocument,
    performUpload,
    removeDownload,
    reprocess,
    recordProbe,
    unsyncDocument,
    fetchDocument,
    offline,
    hasNetwork,
    client,
  };
}

/** One local patch plus one queue row. Every simple write in this file is this. */
async function patch(
  profileId: string | null,
  documentId: string,
  fields: Documents.DocumentPatch,
  changed: string[],
): Promise<boolean> {
  if (profileId === null) {
    return false;
  }
  try {
    const db = await database(profileId);
    if (db === null) {
      return false;
    }
    await Documents.patchLocal(db, documentId, fields);
    if (changed.length > 0) {
      await Queue.enqueue(db, 'document', documentId, 'update', changed);
    }
    return true;
  } catch (error) {
    log.debug(SCOPE, 'a local write failed', error);
    return false;
  }
}

async function annotationIdsOf(
  db: Awaited<ReturnType<typeof database>>,
  documentId: string,
): Promise<string[]> {
  if (db === null) {
    return [];
  }
  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM annotations WHERE documentId = ?',
    documentId,
  );
  return rows.map((row) => row.id);
}
