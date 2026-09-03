import { useEffect, useMemo } from 'react';

import { useMutation } from 'convex/react';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useLocalLibraryStore } from '@/stores/local-library-store';

import { localCoverUri } from '../local/paths';
import { downloadCover } from '../local/transfer';
import type { LibraryDocument } from './types';
import { useLibraryStatus } from './use-library-status';

/**
 * Fetches covers this device has not seen.
 *
 * A document imported on another phone arrives as metadata with its cover
 * sitting in the account, so without this every surface draws the tinted
 * fallback until the reader happens to visit whichever screen was doing the
 * fetching. Covers are around 40 KB and land on disk once, so the cost is a
 * handful of requests the first time a device meets a library and nothing
 * afterwards.
 *
 * Call it from any screen that renders documents. Home, All Library and a
 * collection all do.
 */
export function useCoverSync(documents: readonly LibraryDocument[]): void {
  const { profileId, offline } = useLibraryStatus();
  const downloadUrl = useMutation(api.library.downloadUrl);
  const bumpCoverEpoch = useLocalLibraryStore((state) => state.bumpCoverEpoch);
  const coverEpoch = useLocalLibraryStore((state) => state.coverEpoch);

  /**
   * The ids still wanted, as a string.
   *
   * A string rather than an array so the effect below compares by value: the
   * documents array is a fresh Convex result on every unrelated change — a
   * favourite toggled, a rename — and keying the effect on it would restat the
   * whole library each time.
   */
  const wanted = useMemo(() => {
    if (profileId === null) {
      return '';
    }
    return documents
      .filter((doc) => doc.hasCover && localCoverUri(profileId, doc.id) === null)
      .map((doc) => doc.id)
      .join(',');
    // `coverEpoch` is the subscription to a filesystem React cannot watch: it
    // changes when covers land, which is exactly when this list shrinks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, profileId, coverEpoch]);

  useEffect(() => {
    if (wanted === '' || profileId === null || offline) {
      return;
    }

    let cancelled = false;
    void (async () => {
      let landed = false;
      // Sequential on purpose. Twelve parallel downloads on a cold library
      // start is a burst nobody asked for, and covers are not urgent. It also
      // means one signed URL is in flight at a time rather than twelve, each
      // with five minutes of life.
      for (const id of wanted.split(',')) {
        if (cancelled) {
          return;
        }
        const url = await downloadUrl({
          documentId: id as Id<'documents'>,
          what: 'cover',
        }).catch(() => null);
        if (url !== null && (await downloadCover(profileId, id, url))) {
          landed = true;
        }
      }

      if (landed && !cancelled) {
        // The covers arrived after every `DocumentCover` already looked.
        bumpCoverEpoch();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wanted, profileId, offline, downloadUrl, bumpCoverEpoch]);
}
