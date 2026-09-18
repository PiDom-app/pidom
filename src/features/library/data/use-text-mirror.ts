import { useConvex } from 'convex/react';
import { useEffect, useMemo, useState } from 'react';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { mayTransfer } from '@/lib/connectivity';
import { log } from '@/lib/logger';
import { wifiOnlyNow } from '@/stores/preferences-store';

import { mirrorPages, mirroredIds } from '../local/text-index';
import { codeOf } from './errors';
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

/** The shape `convex/node/extract.ts` writes. `v` is checked, not assumed. */
const FORMAT_VERSION = 1;
type StoredText = { v: number; pages: { p: number; t: string }[] };

/**
 * Brings a document's extracted text down to the device, once.
 *
 * The shape is `useCoverSync`'s, and for the same reason: something the library
 * needs on disk that only the account has, fetched quietly in the background and
 * never again.
 *
 * **One request per document, and one object.** It used to page a query a
 * hundred rows at a time out of the database's bandwidth allowance, which for a
 * 600-page book was a dozen round trips and a megabyte of the most expensive
 * transfer in the system. Extraction now writes one immutable object to R2, and
 * R2 charges nothing to read it — so this is a signed URL and a `fetch`.
 *
 * **Every synced document, not only the downloaded ones.** The old rule was
 * that mirroring a book the reader would still have to download was spending
 * their data for nothing. Free egress changes the arithmetic: the text of a
 * whole library is a few megabytes, and mirroring all of it is what makes
 * search inside answer for the account rather than for this phone's shelf. On
 * cellular the reader's own download preference still applies, so the widening
 * costs nobody a bill they did not agree to.
 *
 * Sequential, one document at a time, and only while Convex is reachable.
 */
export function useTextMirror(documents: readonly LibraryDocument[]): void {
  const { profileId, offline } = useLibraryStatus();
  const convex = useConvex();
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
   * is a fresh array on every unrelated change, and keying the effect on it
   * would restart the mirror on every favourite toggle.
   *
   * Both ids, joined. The text is asked for by the id the account knows and
   * written under the one this device uses; a document the account has never
   * met has no text to mirror.
   */
  const wanted = useMemo(() => {
    if (mirrored === null) {
      return '';
    }
    return documents
      .filter((doc) => doc.textStatus === 'ready' && doc.remoteId !== null && !mirrored.has(doc.id))
      .map((doc) => `${doc.id}:${doc.remoteId ?? ''}:${doc.fileState === 'available' ? '1' : '0'}`)
      .join(',');
  }, [documents, mirrored]);

  useEffect(() => {
    if (wanted === '' || profileId === null || offline) {
      return;
    }

    let cancelled = false;
    void (async () => {
      for (const triple of wanted.split(',')) {
        if (cancelled) {
          return;
        }
        const [id, remoteId, here] = triple.split(':');
        if (id === undefined || remoteId === undefined || remoteId === '') {
          continue;
        }
        // A book already on this phone is mirrored whatever the connection is:
        // its bytes are paid for and the text is a fraction of a percent of
        // them. One that is not here is a new transfer, so it waits for a
        // network the reader has said they are happy to transfer on — the same
        // rule, and the same setting, the download queue uses.
        if (here !== '1' && !mayTransfer(wifiOnlyNow())) {
          continue;
        }
        if (inFlight.has(id)) {
          continue;
        }
        inFlight.add(id);
        try {
          // A mutation rather than a query, because the URL it mints expires:
          // see `library.textUrl`. `null` means the account has no text object
          // for this document yet — not extracted, a scan, or extracted before
          // the text moved out of the database and not yet migrated.
          const url = await convex.mutation(api.library.textUrl, {
            documentId: remoteId as Id<'documents'>,
          });
          if (url === null || cancelled) {
            continue;
          }

          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`text fetch failed: ${response.status}`);
          }
          const body = (await response.json()) as StoredText;
          if (body.v !== FORMAT_VERSION || !Array.isArray(body.pages)) {
            // A shape this build does not know. Left unmirrored rather than
            // half-parsed, and retried next launch — by then this is either an
            // app that understands it or one the reader has updated.
            log.debug(SCOPE, 'unrecognised text format', body.v);
            continue;
          }

          // Written in one transaction, so a mirror interrupted halfway leaves
          // nothing rather than half a book that answers searches with no way
          // to tell it is incomplete.
          const stored = await mirrorPages(
            profileId,
            id,
            body.pages.map((page) => ({ page: page.p, text: page.t })),
          );

          // **Only on success.** Marking it mirrored regardless is what made
          // every launch re-download the entire library on any build where the
          // local index is unavailable: the set is rebuilt from the table at
          // launch, so a claim the table cannot back is a claim that expires
          // and is paid for again.
          if (stored && !cancelled) {
            setMirrored((current) => new Set([...(current ?? []), id]));
          }
        } catch (error) {
          // Running out of the bucket ends the pass rather than failing four
          // hundred times in a row. Every document after this one would be
          // refused too, and each refusal is a function call — a loop hammering
          // a limit is the thing the limit exists to stop, not a thing to do
          // once per document.
          if (codeOf(error) === 'RATE_LIMITED') {
            log.debug(SCOPE, 'mirror paused; resuming next launch');
            return;
          }
          // Offline search is an improvement, never a prerequisite. A document
          // that fails to mirror is tried again next launch, and the reader can
          // still open it and read it in the meantime.
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
