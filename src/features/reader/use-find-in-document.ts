import { useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { SEARCH_LIMIT, SEARCH_TERM_MAX } from '@convex/model/limits';
import { log } from '@/lib/logger';

import { searchLocally } from '../library/local/text-index';

const SCOPE = 'reader-find';

/**
 * Finding a word inside the document that is open.
 *
 * **No new backend.** The page text is already extracted into `documentPages`
 * for every synced document, and already mirrored into this phone's FTS5
 * database by the offline-search capability. Both are already scoped by
 * document id — `api.library.searchInside` takes an optional `documentId` and
 * `searchLocally` takes one positionally — so finding inside one document is
 * the search that was already built, asked a narrower question.
 *
 * The reader's search button used to push to `/search`, which meant leaving the
 * document to look inside it and coming back through a `?page=` deep link. This
 * is the same answers without the round trip.
 *
 * Online and offline are the same fallback the search screen uses: the server
 * when the socket is up, the mirror when it is not. A document that was never
 * synced has no text on either side, and the bar says so rather than looking
 * broken.
 */

export type FindHit = { page: number; snippet: string };

export type FindState = {
  term: string;
  setTerm: (term: string) => void;
  hits: readonly FindHit[];
  /** 0-based index into `hits`, or -1 before anything is chosen. */
  at: number;
  /** True while an answer is still being waited on. */
  searching: boolean;
  next: () => void;
  previous: () => void;
  /** The page of the currently selected hit, or `null`. */
  current: FindHit | null;
};

export function useFindInDocument({
  documentId,
  profileId,
  ready,
  isSynced,
  active,
}: {
  documentId: Id<'documents'> | undefined;
  profileId: string | null;
  ready: boolean;
  /** Only a synced document has text on the server. */
  isSynced: boolean;
  /** False while the bar is closed, so nothing subscribes. */
  active: boolean;
}): FindState {
  const [term, setTerm] = useState('');
  const [at, setAt] = useState(-1);
  const [local, setLocal] = useState<readonly FindHit[] | null>(null);

  // Bounded before it is sent, not after. `SEARCH_TERM_MAX` is the server's
  // rule and this is the same rule applied a round trip earlier.
  const trimmed = term.trim().slice(0, SEARCH_TERM_MAX);
  const enough = trimmed.length >= 2;

  const online = useQuery(
    api.library.searchInside,
    ready && active && enough && documentId !== undefined && isSynced
      ? { term: trimmed, documentId }
      : 'skip',
  );

  // The mirror. Runs whatever the connection is doing: it is the same rows the
  // server would return, and having them already is the point of the mirror.
  useEffect(() => {
    if (!active || !enough || profileId === null || documentId === undefined) {
      setLocal(null);
      return;
    }
    let live = true;
    void searchLocally(profileId, trimmed, documentId, SEARCH_LIMIT)
      .then((rows) => {
        if (live) {
          setLocal(rows.map((row) => ({ page: row.page, snippet: row.snippet })));
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setLocal([]);
        }
        log.debug(SCOPE, 'could not search the local mirror', error);
      });
    return () => {
      live = false;
    };
  }, [active, enough, profileId, documentId, trimmed]);

  const hits = useMemo<readonly FindHit[]>(() => {
    if (!enough) {
      return [];
    }
    // The server's answer wins when there is one — it searches the whole
    // document rather than whatever this phone has mirrored so far — and the
    // mirror stands in when there is not.
    const rows = online ?? local ?? [];
    // In page order, which is reading order. The search index returns by
    // relevance, and stepping through a document backwards and forwards by
    // relevance is not something a reader can follow.
    return [...rows]
      .map((row) => ({ page: row.page, snippet: row.snippet }))
      .sort((a, b) => a.page - b.page);
  }, [enough, online, local]);

  // A new term is a new search: start before the first hit rather than at
  // whatever index the last one happened to leave behind.
  useEffect(() => {
    setAt(hits.length > 0 ? 0 : -1);
  }, [hits]);

  const step = useCallback(
    (by: number) => {
      setAt((index) => {
        if (hits.length === 0) {
          return -1;
        }
        // Wraps, because the alternative is a Next button that stops working
        // at the bottom of a document with no explanation.
        return (index + by + hits.length) % hits.length;
      });
    },
    [hits.length],
  );

  return {
    term,
    setTerm,
    hits,
    at,
    searching: enough && online === undefined && local === null,
    next: () => step(1),
    previous: () => step(-1),
    current: at >= 0 && at < hits.length ? hits[at] : null,
  };
}
