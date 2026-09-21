import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConvex } from 'convex/react';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';

/**
 * Finding a word inside the open document.
 *
 * The mobile reader searches its offline FTS5 mirror. Desktop has no persistent
 * mirror yet (that is Phase 2), so this fetches the same immutable text object
 * extraction wrote to R2 — `{v:1,pages:[{p,t}]}` — once, keeps it in memory, and
 * scans it. The index is independent of the render path, so search answers the
 * moment the text is fetched whether or not the page it points at has painted.
 *
 * A document that was never extracted has no text object; the bar says so rather
 * than looking broken.
 */

export interface FindHit {
  page: number;
  snippet: string;
}

export type FindAvailability = 'loading' | 'ready' | 'unavailable';

export interface FindState {
  term: string;
  setTerm: (term: string) => void;
  hits: FindHit[];
  /** 0-based index into `hits`, or -1 before a match is chosen. */
  at: number;
  current: FindHit | null;
  next: () => void;
  previous: () => void;
  availability: FindAvailability;
}

/** The shape `convex/node/extract.ts` writes. `v` is checked, not assumed. */
const FORMAT_VERSION = 1;
interface StoredText {
  v: number;
  pages: { p: number; t: string }[];
}

/** How much text either side of a match the snippet keeps. */
const SNIPPET_RADIUS = 40;

function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + length + SNIPPET_RADIUS);
  const core = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${core}${end < text.length ? '…' : ''}`;
}

export function useFindInDocument(documentId: Id<'documents'>, active: boolean): FindState {
  const convex = useConvex();
  const [term, setTerm] = useState('');
  const [at, setAt] = useState(-1);
  const [availability, setAvailability] = useState<FindAvailability>('loading');
  const pages = useRef<{ p: number; t: string }[] | null>(null);

  // Fetch and index once, the first time the bar opens. Nothing runs while it is
  // closed, and a second open reuses what the first one cached.
  useEffect(() => {
    if (!active || pages.current !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const url = await convex.mutation(api.library.textUrl, { documentId });
        if (cancelled) return;
        if (!url) {
          setAvailability('unavailable');
          return;
        }
        const response = await fetch(url);
        const data = (await response.json()) as StoredText;
        if (cancelled) return;
        if (data.v !== FORMAT_VERSION || !Array.isArray(data.pages)) {
          setAvailability('unavailable');
          return;
        }
        pages.current = data.pages;
        setAvailability('ready');
      } catch {
        if (!cancelled) setAvailability('unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, convex, documentId]);

  const hits = useMemo<FindHit[]>(() => {
    const needle = term.trim().toLowerCase();
    if (needle.length < 2 || !pages.current) return [];
    const found: FindHit[] = [];
    for (const { p, t } of pages.current) {
      const haystack = t.toLowerCase();
      let from = haystack.indexOf(needle);
      // One hit per page keeps the step-through about pages, not occurrences —
      // the reader jumps to the page and reads, rather than to a character.
      if (from !== -1) {
        found.push({ page: p, snippet: snippetAround(t, from, needle.length) });
      }
      from = -1;
    }
    return found;
  }, [term]);

  // Reset the cursor to the first match whenever the result set changes.
  useEffect(() => {
    setAt(hits.length > 0 ? 0 : -1);
  }, [hits]);

  const next = useCallback(() => {
    setAt((current) => (hits.length === 0 ? -1 : (current + 1) % hits.length));
  }, [hits.length]);

  const previous = useCallback(() => {
    setAt((current) => (hits.length === 0 ? -1 : (current - 1 + hits.length) % hits.length));
  }, [hits.length]);

  const current = at >= 0 && at < hits.length ? hits[at] : null;

  return { term, setTerm, hits, at, current, next, previous, availability };
}
