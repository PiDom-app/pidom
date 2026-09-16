/**
 * Pages in, passages out.
 *
 * A pure function over the text `use-text-mirror.ts` already pulled down, with
 * no database, no native module and no clock in it — which is why it can be
 * tested under Node beside `outcome.test.ts` rather than needing a device. The
 * rest of the indexing pipeline is I/O around this one decision.
 *
 * **A passage is a range, not a string.** It comes out as two pages and two
 * character offsets, because the words are already stored once in the FTS5
 * `pages` table and a second copy of every book is the last thing a phone's
 * disk needs. `sliceOf` below is the inverse, and the two are tested against
 * each other: anything this emits must slice back to the text it was cut from.
 *
 * Three rules, in the order they fight each other:
 *
 * 1. **Break at a sentence, not at a character.** A passage that starts
 *    mid-clause embeds the fragment rather than the thought.
 * 2. **Never span more than `CHUNK_MAX_PAGES`.** A citation the reader cannot
 *    act on is not a citation, and "somewhere in these five pages" is not one.
 * 3. **Overlap by a little.** An argument that straddles a boundary is
 *    otherwise findable by neither half.
 *
 * Rule 2 wins over rule 1 — a page boundary is a hard stop even mid-sentence,
 * because a PDF's page break is very often mid-sentence and refusing to cut
 * there would make every chunk in a flowing book the maximum length.
 */
import {
  CHUNK_MAX_CHARS,
  CHUNK_MAX_PAGES,
  CHUNK_MIN_CHARS,
  CHUNK_OVERLAP_CHARS,
  CHUNK_TARGET_CHARS,
} from '../model';

/** One page of mirrored text, as the `pages` table stores it. */
export type PageText = { page: number; text: string };

/** A passage, addressed rather than copied. */
export type ChunkRange = {
  ordinal: number;
  startPage: number;
  endPage: number;
  /** Characters into `startPage`'s text, inclusive. */
  startOffset: number;
  /** Characters into `endPage`'s text, exclusive. */
  endOffset: number;
  chars: number;
};

/**
 * Where a sentence ends, as far as a page of extracted PDF text can say.
 *
 * Deliberately not a sentence tokeniser. The input is already lossy — a PDF's
 * text layer arrives with hyphens, running heads and ligatures in it — so the
 * ambition is a boundary that is usually right rather than one that is
 * linguistically defensible. A full stop, question mark or exclamation followed
 * by whitespace, and a paragraph break, are the two that survive extraction.
 *
 * The lookbehind for a lone capital is what stops `J. R. R. Tolkien` becoming
 * three passages.
 */
const SENTENCE_END = /[.!?][)"'’”]?\s+(?=[^a-z])|\n\s*\n/g;

/**
 * The last sentence boundary at or before `limit`, or `-1` when there is none.
 *
 * Scans rather than reverse-matching because JavaScript has no reverse regex
 * and a page is at most 8 KiB — the scan is cheaper than the machinery that
 * would avoid it.
 */
function lastBreakBefore(text: string, from: number, limit: number): number {
  SENTENCE_END.lastIndex = from;
  let best = -1;
  let match = SENTENCE_END.exec(text);
  while (match !== null) {
    const end = match.index + match[0].length;
    if (end > limit) {
      break;
    }
    best = end;
    match = SENTENCE_END.exec(text);
  }
  SENTENCE_END.lastIndex = 0;
  return best;
}

/** How far back from `end` to start the next passage, snapped to a boundary. */
function overlapFrom(text: string, start: number, end: number): number {
  const target = Math.max(start, end - CHUNK_OVERLAP_CHARS);
  const snapped = lastBreakBefore(text, target, end - 1);
  // A boundary at or before where we started would not advance; take the raw
  // target instead, which is a worse cut but a cut that terminates.
  return snapped > start ? snapped : target;
}

/**
 * Cuts one document's mirrored pages into passages.
 *
 * Pages need not be contiguous: extraction skips a page with no text on it, and
 * a gap is a hard boundary rather than something to paper over, because two
 * sides of a missing page are not continuous prose.
 *
 * `ordinal` is dense and starts at 1. The job's cursor is an ordinal and
 * `ordinal > cursor` is how a resumed pass finds its place, so a gap in the
 * sequence would be a passage nothing ever embeds.
 */
export function chunkPages(pages: readonly PageText[]): ChunkRange[] {
  const ordered = [...pages]
    .filter((page) => page.text.trim().length > 0)
    .sort((a, b) => a.page - b.page);

  const chunks: ChunkRange[] = [];
  let ordinal = 0;

  // A run is a stretch of consecutive pages. Every run is chunked on its own,
  // so a gap in the extraction never produces a passage that claims to span it.
  let run: PageText[] = [];
  const flush = () => {
    if (run.length > 0) {
      ordinal = chunkRun(run, ordinal, chunks);
      run = [];
    }
  };

  for (const page of ordered) {
    const previous = run[run.length - 1];
    if (previous !== undefined && page.page !== previous.page + 1) {
      flush();
    }
    run.push(page);
  }
  flush();

  return chunks;
}

/**
 * Chunks one consecutive run of pages.
 *
 * Works over a single concatenated string with an index back to the page each
 * character came from, because the alternative — carrying a page and an offset
 * through every boundary decision — turns each of the three rules into three
 * cases. The concatenation is bounded: a run is the pages of one document, and
 * the caller reads them in windows.
 */
function chunkRun(run: readonly PageText[], startOrdinal: number, out: ChunkRange[]): number {
  // Where each page begins in the joined text, and the separator that stands
  // for the page break. A newline, so a mid-sentence page break still reads as
  // whitespace to the boundary regex rather than joining two words.
  const starts: number[] = [];
  let joined = '';
  for (const page of run) {
    starts.push(joined.length);
    joined += page.text;
    joined += '\n';
  }

  const pageAt = (index: number): number => {
    // The last page whose start is at or before `index`. Linear rather than
    // binary: a run is tens of pages and this is called twice per passage.
    let found = 0;
    for (let i = 0; i < starts.length; i += 1) {
      if (starts[i] <= index) {
        found = i;
      } else {
        break;
      }
    }
    return found;
  };

  let ordinal = startOrdinal;
  let start = 0;

  while (start < joined.length) {
    const firstPage = pageAt(start);

    // Rule 2 first: the hard ceiling is whichever comes sooner, the character
    // budget or the end of the last page this passage may reach.
    const lastAllowedPage = Math.min(firstPage + CHUNK_MAX_PAGES - 1, run.length - 1);
    const pageCeiling =
      lastAllowedPage + 1 < starts.length ? starts[lastAllowedPage + 1] : joined.length;
    const ceiling = Math.min(start + CHUNK_MAX_CHARS, pageCeiling, joined.length);

    let end: number;
    if (ceiling >= joined.length) {
      end = joined.length;
    } else {
      // Rule 1: aim for the target, and take the last sentence boundary at or
      // before it. Fall back to the ceiling when the text has none — a table of
      // figures has no sentences in it and still has to be cut somewhere.
      const target = Math.min(start + CHUNK_TARGET_CHARS, ceiling);
      const snapped = lastBreakBefore(joined, start, target);
      end = snapped > start + CHUNK_MIN_CHARS ? snapped : ceiling;
    }

    const text = joined.slice(start, end);
    if (text.trim().length > 0) {
      ordinal += 1;
      const lastPage = pageAt(Math.max(start, end - 1));
      out.push({
        ordinal,
        startPage: run[firstPage].page,
        endPage: run[lastPage].page,
        startOffset: start - starts[firstPage],
        // Exclusive, and clamped to the page's own length: the separator this
        // function added is not part of anybody's page.
        endOffset: Math.min(end - starts[lastPage], run[lastPage].text.length),
        chars: text.length,
      });
    }

    if (end >= joined.length) {
      break;
    }

    // Rule 3, and the guarantee of termination: the next start is strictly
    // after this one. `overlapFrom` can only return something at or after
    // `start`, so the `max` is what makes the loop finite on pathological text.
    start = Math.max(start + 1, overlapFrom(joined, start, end));
  }

  return ordinal;
}

/**
 * The inverse: a passage's text, given the pages it names.
 *
 * Takes a lookup rather than an array because the caller has a window of pages
 * and a passage may reach the page after it. A page the lookup does not have
 * contributes nothing rather than throwing — a mirror trimmed while a job was
 * running should cost one passage, not the pass.
 */
export function sliceOf(chunk: ChunkRange, pageText: (page: number) => string | undefined): string {
  if (chunk.startPage === chunk.endPage) {
    return (pageText(chunk.startPage) ?? '').slice(chunk.startOffset, chunk.endOffset);
  }

  const parts: string[] = [];
  for (let page = chunk.startPage; page <= chunk.endPage; page += 1) {
    const text = pageText(page);
    if (text === undefined) {
      continue;
    }
    if (page === chunk.startPage) {
      parts.push(text.slice(chunk.startOffset));
    } else if (page === chunk.endPage) {
      parts.push(text.slice(0, chunk.endOffset));
    } else {
      parts.push(text);
    }
  }
  return parts.join('\n');
}
