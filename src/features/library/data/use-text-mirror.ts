import { useConvex } from 'convex/react';
import { useEffect, useMemo, useState } from 'react';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { log } from '@/lib/logger';
import { useLocalLibraryStore } from '@/stores/local-library-store';

import { mirrorPages, mirroredIds } from '../local/text-index';
import type { LibraryDocument } from './types';
import { useLibraryStatus } from './use-library-status';

const SCOPE = 'mirror';

/**
 * Documents being mirrored right now, across every mount of this hook.
 *
 * Module-level rather than a ref, because the guard has to hold between
 * *components*: `useHome` mounts this, and the search screen calls `useHome`
 * too, so home and search can be on screen with two copies of this hook looking
 * at the same list. Two transactions deleting and re-inserting one document's
 * pages is a book that is briefly half in the index and a request paid for
 * twice.
 *
 * Not state: nothing renders from it, and a set that triggered a re-render on
 * every document would restart the very effect it is guarding.
 */
const inFlight = new Set<string>();

/**
 * Brings a document's extracted text down to the device, once.
 *
 * The shape is `useCoverSync`'s, and for the same reason: something the library
 * needs on disk that only the account has, fetched quietly in the background and
 * never again. What is different is the size — a book's text is a megabyte where
 * a cover is forty kilobytes — so this is stricter about who qualifies.
 *
 * **Only documents that are on this device.** The text is for searching offline,
 * and a document that is not here cannot be read offline either; mirroring it
 * would be spending a reader's data on a book they would still have to download.
 *
 * Sequential, one document at a time, and only while Convex is reachable. There
 * is no urgency: until the mirror completes, search inside still works online.
 */
export function useTextMirror(documents: readonly LibraryDocument[]): void {
  const { profileId, offline } = useLibraryStatus();
  const convex = useConvex();
  const localIds = useLocalLibraryStore((state) => state.ids);
  const [mirrored, setMirrored] = useState<ReadonlySet<string> | null>(null);

  // Read once per profile. It is a filesystem question, so React cannot watch
  // it; the in-memory set below is kept current by the loop that fills it.
  useEffect(() => {
    if (profileId === null) {
      setMirrored(null);
      return;
    }
    let cancelled = false;
    void mirroredIds(profileId).then((ids) => {
      if (!cancelled) {
        setMirrored(ids);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  /**
   * The ids still wanted, as a string.
   *
   * A string rather than an array so the effect compares by value: `documents`
   * is a fresh Convex result on every unrelated change, and keying the effect on
   * it would restart the mirror on every favourite toggle.
   */
  const wanted = useMemo(() => {
    if (mirrored === null) {
      return '';
    }
    return documents
      .filter(
        (doc) =>
          doc.textStatus === 'ready' && localIds.has(doc.id) && !mirrored.has(doc.id),
      )
      .map((doc) => doc.id)
      .join(',');
  }, [documents, localIds, mirrored]);

  useEffect(() => {
    if (wanted === '' || profileId === null || offline) {
      return;
    }

    let cancelled = false;
    void (async () => {
      for (const id of wanted.split(',')) {
        if (cancelled) {
          return;
        }
        if (inFlight.has(id)) {
          continue;
        }
        inFlight.add(id);
        try {
          // Paged, because a 600-page book is past a function's return limit.
          // Accumulated whole and written in one transaction, so a mirror
          // interrupted halfway leaves nothing rather than half a book that
          // answers searches with no way to tell it is incomplete.
          const pages: { page: number; text: string }[] = [];
          let after = 0;
          for (;;) {
            const batch = await convex.query(api.library.pagesOf, {
              documentId: id as Id<'documents'>,
              after,
            });
            pages.push(...batch.pages);
            if (batch.isDone || batch.pages.length === 0) {
              break;
            }
            after = batch.pages[batch.pages.length - 1]?.page ?? after;
            if (cancelled) {
              return;
            }
          }

          await mirrorPages(profileId, id, pages);
          if (!cancelled) {
            setMirrored((current) => new Set([...(current ?? []), id]));
          }
        } catch (error) {
          // Offline search is an improvement on online search, never a
          // prerequisite for it. A document that fails to mirror is tried again
          // next launch and searchable online in the meantime.
          log.debug(SCOPE, 'could not mirror a document', error);
        } finally {
          inFlight.delete(id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wanted, profileId, offline, convex]);
}
