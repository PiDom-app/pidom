import { useCallback, useState } from 'react';
import { useMutation } from 'convex/react';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { messageOf } from '@/features/library/data/errors';
import { useLibraryStatus } from '@/features/library/data/use-library-status';
import { database } from '@/features/library/local/db';
import { localCoverUri } from '@/features/library/local/paths';
import * as Documents from '@/features/library/local/repository/documents';
import * as Files from '@/features/library/local/repository/files';
import { mintId } from '@/features/library/local/repository/ids';
import type { LibraryShare } from '@/features/library/local/repository/types';
import { roomFor } from '@/features/library/local/space';
import { BadDownload, downloadCover, downloadDocument } from '@/features/library/local/transfer';
import { useLocalLibraryStore } from '@/stores/local-library-store';
import { useTransferStore } from '@/stores/transfer-store';
import { log } from '@/lib/logger';
import { mayTransfer } from '@/lib/connectivity';
import { wifiOnlyNow } from '@/stores/preferences-store';

const SCOPE = 'share-download';

/**
 * Bringing a shared document onto this device.
 *
 * It is `useLibraryActions().fetchDocument` with two differences, and no third.
 *
 * The URL comes from `sharing.shareDownloadUrl` rather than
 * `library.downloadUrl`, because the recipient does not own the document —
 * that mutation resolves the grant instead of ownership, refuses a share whose
 * `canDownload` is off, and refuses an expired one against a fresh clock. Both
 * sign the same five-minute R2 URL.
 *
 * And the local row has to be made first, because there is not one: a share the
 * reader has accepted is a grant with no document on this phone. `insertShared`
 * writes it with `ownedByMe` at 0 and `shareId` pointing back at the grant, and
 * from that moment it is an ordinary document — it opens with no connection,
 * takes bookmarks and notes, and appears in the library like anything else.
 *
 * **The file and the grant stay separate afterwards.** Deleting the download
 * leaves the grant, so it can be fetched again. Losing the grant leaves the
 * file, because a file on a disk is not something a server can reach — which is
 * the sentence the whole feature is built around.
 */
export function useShareDownload() {
  const { profileId, hasNetwork } = useLibraryStatus();

  /**
   * The id the transfer is keyed on, published before the bytes move.
   *
   * `useTransferStore` is keyed on the *local* document id, which is minted
   * inside `download` — so a screen holding its own idea of the local id read
   * `null` for the entire transfer and could only show a spinner. This is the
   * same id, set the moment it exists.
   */
  const [transferId, setTransferId] = useState<string | null>(null);
  const shareDownloadUrl = useMutation(api.sharing.shareDownloadUrl);
  const shareCoverUrl = useMutation(api.sharing.shareCoverUrl);

  const markPresent = useLocalLibraryStore((state) => state.markPresent);
  const bumpCoverEpoch = useLocalLibraryStore((state) => state.bumpCoverEpoch);
  const startTransfer = useTransferStore((state) => state.start);
  const reportProgress = useTransferStore((state) => state.progress);
  const finishTransfer = useTransferStore((state) => state.finish);
  const showToast = useAppToast();

  /**
   * The local id for a shared document, making the row if it is not there yet.
   *
   * Returns `null` when the share names no document — a share whose document
   * was deleted, which the inbox renders as gone rather than as downloadable.
   */
  const localise = useCallback(
    async (share: LibraryShare): Promise<string | null> => {
      if (profileId === null || share.documentId === null) {
        return null;
      }
      const db = await database(profileId);
      if (db === null) {
        return null;
      }

      const existing = await Documents.localIdForRemote(db, share.documentId);
      if (existing !== null) {
        return existing;
      }

      const id = mintId();
      await Documents.insertShared(db, {
        id,
        remoteId: share.documentId,
        shareId: share.id,
        title: share.title ?? 'A shared document',
        author: share.author,
        pageCount: share.pageCount,
        byteSize: share.byteSize,
      });
      return id;
    },
    [profileId],
  );

  const download = useCallback(
    async (share: LibraryShare): Promise<boolean> => {
      if (profileId === null || share.documentId === null) {
        return false;
      }
      if (!hasNetwork) {
        showToast({
          id: 'share-download',
          tone: 'error',
          title: 'This needs a connection',
          description: 'The document is in the sender’s account, not on this phone yet.',
        });
        return false;
      }

      // The reader's own answer about their own connection. Only a link
      // NetInfo positively calls cellular is refused — see `mayTransfer`.
      if (!mayTransfer(wifiOnlyNow())) {
        showToast({
          id: 'share-download',
          tone: 'error',
          title: 'Waiting for Wi-Fi',
          description: 'Downloads are set to Wi-Fi only. Change that under Sync & data.',
        });
        return false;
      }

      // Asked before anything moves, so a refusal costs no bytes. The same
      // check the import path makes, and the same 64 MiB of headroom.
      const space = await roomFor(share.byteSize);
      if (!space.ok) {
        showToast({
          id: 'share-download',
          tone: 'error',
          title: 'Not enough room on this device',
          description: 'Remove a download or two and try again.',
        });
        return false;
      }

      const localId = await localise(share);
      if (localId === null) {
        return false;
      }
      setTransferId(localId);

      const db = await database(profileId);
      const documentId = share.documentId as Id<'documents'>;

      startTransfer(localId, 'download');
      if (db !== null) {
        await Files.setState(db, localId, 'downloading', { expectedBytes: share.byteSize });
      }

      try {
        const url = await shareDownloadUrl({ documentId, what: 'document' });
        if (url === null) {
          showToast({
            id: 'share-download',
            tone: 'error',
            title: 'That document is no longer available',
          });
          if (db !== null) {
            await Files.setState(db, localId, 'missing');
          }
          return false;
        }

        await downloadDocument(
          profileId,
          localId,
          url,
          // No fingerprint: that is the sender's own record of their file and
          // does not cross to a recipient. Size and the PDF header are what is
          // checked, which is what `downloadDocument` verifies regardless.
          { byteSize: share.byteSize, fingerprint: null },
          ({ sent, total }) => reportProgress(localId, sent, total),
        );

        if (db !== null) {
          await Files.setState(db, localId, 'available', {
            localBytes: share.byteSize,
            expectedBytes: share.byteSize,
          });
        }
        markPresent(localId);

        if (share.hasCover && localCoverUri(profileId, localId) === null) {
          void shareCoverUrl({ documentId }).then(async (coverUrl) => {
            if (coverUrl === null) {
              return;
            }
            if (await downloadCover(profileId, localId, coverUrl)) {
              bumpCoverEpoch();
              if (db !== null) {
                await Files.setCoverState(db, localId, 'available');
              }
            }
          });
        }
        return true;
      } catch (error) {
        const broken = error instanceof BadDownload && error.reason !== 'no-space';
        if (db !== null) {
          await Files.setState(db, localId, broken ? 'corrupt' : 'missing', {
            failure: error instanceof BadDownload ? error.reason : null,
          });
        }
        log.error(SCOPE, 'a shared download did not complete');
        showToast({
          id: 'share-download',
          tone: 'error',
          title: broken ? "That download didn't arrive whole" : "Couldn't download",
          description: broken
            ? 'Nothing was kept. Try again when you have a steadier connection.'
            : messageOf(error, 'Check your connection and try again.'),
        });
        return false;
      } finally {
        finishTransfer(localId);
        setTransferId(null);
      }
    },
    [
      bumpCoverEpoch,
      finishTransfer,
      hasNetwork,
      localise,
      markPresent,
      profileId,
      reportProgress,
      shareCoverUrl,
      shareDownloadUrl,
      showToast,
      startTransfer,
    ],
  );

  return { download, localise, transferId };
}
