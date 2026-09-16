import { describe, expect, test } from 'vitest';

import { CHUNK_MAX_CHARS, CHUNK_MAX_PAGES } from '../model';
import { chunkPages, sliceOf, type PageText } from './chunker';

/**
 * What the chunker must never do to a book.
 *
 * Four properties, and each one is a way the indexing pipeline can be silently
 * wrong rather than visibly broken — which is the failure mode worth a test.
 * A passage whose offsets do not slice back to the text it was cut from
 * produces an embedding of one thing and a citation pointing at another, and
 * nothing anywhere would say so: the search would simply be a little bit wrong
 * for the life of the index.
 *
 * The ordinals matter for a different reason. The job's cursor is an ordinal
 * and the resume query is `ordinal > cursor`, so a gap in the sequence is a
 * passage nothing will ever embed — on a 1,000-page book, invisibly.
 */

/**
 * A page of plausible extracted text.
 *
 * Twenty sentences at around 120 characters is roughly 2,400, which is what a
 * page of a trade paperback actually extracts to. The first version of this
 * fixture used half that and made the "passages per page" assertion below
 * assert something about the fixture rather than about the chunker.
 */
function page(n: number, sentences: number): PageText {
  const parts: string[] = [];
  for (let i = 0; i < sentences; i += 1) {
    parts.push(
      `On page ${n} the author makes point ${i}, at the length a real sentence in a real book tends to run to before it stops.`,
    );
  }
  return { page: n, text: parts.join(' ') };
}

function book(pages: number, sentencesPerPage = 20): PageText[] {
  return Array.from({ length: pages }, (_, i) => page(i + 1, sentencesPerPage));
}

describe('the ranges a passage is stored as', () => {
  test('slice back to the text they were cut from', () => {
    const pages = book(40);
    const byPage = new Map(pages.map((p) => [p.page, p.text]));
    const chunks = chunkPages(pages);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      const text = sliceOf(chunk, (p) => byPage.get(p));
      expect(text.length).toBeGreaterThan(0);
      // Every passage has to be findable in the pages it claims, or the
      // citation under an answer points somewhere the words are not.
      const source = pages
        .filter((p) => p.page >= chunk.startPage && p.page <= chunk.endPage)
        .map((p) => p.text)
        .join('\n');
      expect(source).toContain(text.trim().slice(0, 60));
    }
  });

  test('never span more pages than a citation can name', () => {
    for (const chunk of chunkPages(book(60, 2))) {
      expect(chunk.endPage - chunk.startPage + 1).toBeLessThanOrEqual(CHUNK_MAX_PAGES);
    }
  });

  test('stay under the ceiling even when the text has no sentence in it', () => {
    // A table of figures: no full stops, so there is no boundary to snap to and
    // the ceiling is the only thing stopping one passage being a whole page.
    const dense: PageText[] = [{ page: 1, text: '41 87 13 '.repeat(4_000) }];
    for (const chunk of chunkPages(dense)) {
      expect(chunk.chars).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    }
  });
});

describe('the ordinals the cursor resumes on', () => {
  test('are dense, start at one, and are in order', () => {
    const chunks = chunkPages(book(80));
    expect(chunks[0].ordinal).toBe(1);
    chunks.forEach((chunk, i) => {
      expect(chunk.ordinal).toBe(i + 1);
    });
  });

  test('are dense across a gap in the extraction', () => {
    // Extraction skips a page with no text on it, so runs of pages are not
    // contiguous. A gap must not cost an ordinal.
    const pages = [page(1, 8), page(2, 8), page(7, 8), page(8, 8)];
    const chunks = chunkPages(pages);
    chunks.forEach((chunk, i) => {
      expect(chunk.ordinal).toBe(i + 1);
    });
  });

  test('never produce a passage that spans the gap', () => {
    const chunks = chunkPages([page(1, 8), page(2, 8), page(7, 8)]);
    for (const chunk of chunks) {
      const spansGap = chunk.startPage <= 2 && chunk.endPage >= 7;
      expect(spansGap).toBe(false);
    }
  });
});

describe('the properties the pipeline depends on', () => {
  test('a thousand pages chunk deterministically, and to the expected size', () => {
    const pages = book(1_000);
    const first = chunkPages(pages);
    const second = chunkPages(pages);
    expect(second).toEqual(first);

    // The storage claim every comment in this feature makes — 388 bytes a
    // passage, about 400 KB a book — rests on this ratio. A page of ~2,400
    // characters cut into ~2,200-character passages that overlap by 240 gives a
    // little over one passage a page, and the index for this book is therefore
    // around half a megabyte. If a change to the target length moves this, the
    // ceiling on the settings screen is wrong too.
    expect(first.length).toBeGreaterThan(1_000);
    expect(first.length).toBeLessThan(1_600);
    expect(first.length * 388).toBeLessThan(700_000);
  });

  test('an empty page contributes nothing and breaks nothing', () => {
    const chunks = chunkPages([page(1, 6), { page: 2, text: '   ' }, page(3, 6)]);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.chars).toBeGreaterThan(0);
    }
  });

  test('no pages at all is no passages, rather than a throw', () => {
    expect(chunkPages([])).toEqual([]);
    expect(chunkPages([{ page: 1, text: '' }])).toEqual([]);
  });

  test('pathological text still terminates', () => {
    // One "sentence" the length of six passages, with nothing to break on.
    const chunks = chunkPages([{ page: 1, text: 'a'.repeat(CHUNK_MAX_CHARS * 6) }]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThan(100);
  });
});
