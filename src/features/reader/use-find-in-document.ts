import { useCallback, useEffect, useMemo, useState } from 'react';

import { SEARCH_LIMIT, SEARCH_TERM_MAX } from '@convex/model/limits';
import { log } from '@/lib/logger';

import { searchLocally } from '../library/local/text-index';

const SCOPE = 'reader-find';

/**
 * Finding a word inside the document that is open.
 *
 * **No new backend.** The page text is already mirrored into this phone's FTS5
 * database by the offline-search capability, and that index is already scoped by
 * document id — `searchLocally` takes one positionally — so finding inside one
 * document is the search that was already built, asked a narrower question.
 *
 * The reader's search button used to push to `/search`, which meant leaving the
 * document to look inside it and coming back through a `?page=` deep link. This
 * is the same answers without the round trip.
 *
 * **One source, and it is the one on this phone.** There used to be a second:
 * a Convex search index over a table holding every page of every synced book,
 * consulted whenever the socket was up. Retiring it is not a loss here — the
 * mirror now covers every document in the account rather than only the
 * downloaded ones, and a reader with this document open has by definition
 * downloaded it. What it buys is an answer in a frame instead of a round trip,
 * one that works in a tunnel, and a deployment that is not paying to store the
 * same text twice. A document that was never synced has no text on either side,
 * and the bar says so rather than looking broken.
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
  active,
}: {
  documentId: string | undefined;
  profileId: string | null;
  /** False while the bar is closed, so nothing runs. */
  active: boolean;
}): FindState {
  const [term, setTerm] = useState('');
  const [at, setAt] = useState(-1);
  const [local, setLocal] = useState<readonly FindHit[] | null>(null);

  // Bounded before it is used, not after. `SEARCH_TERM_MAX` was the server's
  // rule and stays the rule: the FTS5 query is built from this string, and a
  // bound the whole app shares is one fewer place for the two to disagree.
  const trimmed = term.trim().slice(0, SEARCH_TERM_MAX);
  const enough = trimmed.length >= 2;

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
    const rows = local ?? [];
    // In page order, which is reading order. The index returns by relevance,
    // and stepping through a document backwards and forwards by relevance is
    // not something a reader can follow.
    return [...rows]
      .map((row) => ({ page: row.page, snippet: row.snippet }))
      .sort((a, b) => a.page - b.page);
  }, [enough, local]);

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
    searching: enough && local === null,
    next: () => step(1),
    previous: () => step(-1),
    current: at >= 0 && at < hits.length ? hits[at] : null,
  };
}
