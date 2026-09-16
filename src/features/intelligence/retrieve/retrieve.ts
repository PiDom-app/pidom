/**
 * One question, asked of both indexes, answered in passages.
 *
 * The device has had an FTS5 index over page text since offline search existed,
 * and now it has vectors as well. Neither replaces the other and the fusion is
 * the point: exact terms, names, numbers, equations and citations are where
 * keyword search beats embeddings outright, and "the argument about small
 * samples" is where it returns nothing at all.
 *
 * **Two stages, for the library-wide case.** A hundred books is three hundred
 * thousand passages and scanning all of them per keystroke is seconds. So one
 * vector a document decides which handful are worth opening, and only those are
 * scanned passage by passage. Inside one document there is no first stage,
 * because a thousand passages is already milliseconds.
 *
 * **Reciprocal-rank fusion, not score addition.** The two rankings are not on
 * the same scale — a cosine is bounded and a BM25 rank is not — and normalising
 * them against each other requires knowing the distribution of both, which
 * varies per query. Rank is the thing they do share. `RRF_K` is the standard 60
 * and stops the top hit of one ranking burying a result the other also found
 * three places down, which is the entire reason to fuse rather than concatenate.
 */
import { database } from '@/features/library/local/db';
import * as Chunks from '@/features/library/local/repository/chunks';
import * as Documents from '@/features/library/local/repository/documents';
import { pageTextOf, searchLocally } from '@/features/library/local/text-index';
import { log } from '@/lib/logger';

import { onnxEngine } from '../engine/onnx-engine';
import { modelPresent } from '../engine/model-store';
import {
  CHUNK_VERSION,
  LIBRARY_CANDIDATES,
  MODEL_VERSION,
  NEAR_PAGES,
  NEAR_WEIGHT,
  RETRIEVE_POOL,
  RRF_K,
} from '../model';
import { dequantise, score, topK } from './vectors';

const SCOPE = 'intelligence-retrieve';

/**
 * Why a passage is in the results.
 *
 * Shown on the row, and not as decoration. The one surprising hit of a search —
 * the page that does not contain any of the words typed — looks like a bug
 * without it, and it is the single best demonstration that the feature works.
 */
export type Found = 'meaning' | 'words' | 'both';

export type Passage = {
  documentId: string;
  title: string;
  startPage: number;
  endPage: number;
  text: string;
  score: number;
  found: Found;
};

export type RetrieveOptions = {
  /** One document's id, or `null` for the whole library. */
  scope: string | null;
  /** The page the reader is on, when there is one. Breaks ties. */
  near: number | null;
  limit: number;
};

/** Whether asking is worth anything on this device right now. */
export function semanticSearchAvailable(profileId: string): boolean {
  return modelPresent(profileId);
}

type Ranked = { key: string; documentId: string; startPage: number; endPage: number };

/**
 * Reciprocal-rank fusion over two ranked lists.
 *
 * `1 / (k + rank)` summed across the lists an item appears in. An item in both
 * outranks an item at the same position in one, which is the behaviour wanted:
 * a passage that the words and the meaning both point at is the best answer
 * there is.
 */
function fuse(
  meaning: readonly Ranked[],
  words: readonly Ranked[],
): Map<string, { item: Ranked; score: number; found: Found }> {
  const out = new Map<string, { item: Ranked; score: number; found: Found }>();

  const add = (list: readonly Ranked[], found: Found) => {
    list.forEach((item, rank) => {
      const existing = out.get(item.key);
      const contribution = 1 / (RRF_K + rank + 1);
      if (existing === undefined) {
        out.set(item.key, { item, score: contribution, found });
        return;
      }
      existing.score += contribution;
      existing.found = 'both';
    });
  };

  add(meaning, 'meaning');
  add(words, 'words');
  return out;
}

/** A small, explicit nudge towards where the reader already is. */
function nearBoost(page: number, near: number | null): number {
  if (near === null) {
    return 0;
  }
  const distance = Math.abs(page - near);
  if (distance > NEAR_PAGES) {
    return 0;
  }
  return NEAR_WEIGHT * (1 - distance / NEAR_PAGES);
}

/**
 * The passages that answer a question, best first.
 *
 * Returns `[]` rather than throwing for every reason it can fail — no model, no
 * index, an empty query, a database that would not open. A search that returns
 * nothing is a search that found nothing, which the screen already has a state
 * for; an exception here would take down whatever rendered it.
 */
export async function retrieve(
  profileId: string,
  query: string,
  options: RetrieveOptions,
): Promise<Passage[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  try {
    const db = await database(profileId);
    if (db === null) {
      return [];
    }

    // The keyword half runs whatever else is true. It is the half that has
    // always worked and the half that works without the model.
    const keyword = await searchLocally(profileId, trimmed, options.scope, RETRIEVE_POOL);

    const meaning = modelPresent(profileId)
      ? await semanticHits(db, profileId, trimmed, options)
      : [];

    // A keyword hit is a page, not a passage. It is matched to the chunk that
    // covers it so the two lists rank the same kind of thing — without this the
    // fusion would compare a page against a range and count a document twice.
    const words: Ranked[] = [];
    for (const hit of keyword) {
      const covering = await Chunks.chunksOnPage(db, hit.documentId, CHUNK_VERSION, hit.page);
      const chunk = covering[0];
      words.push(
        chunk === undefined
          ? {
              key: `${hit.documentId}:p${hit.page}`,
              documentId: hit.documentId,
              startPage: hit.page,
              endPage: hit.page,
            }
          : {
              key: chunk.id,
              documentId: hit.documentId,
              startPage: chunk.startPage,
              endPage: chunk.endPage,
            },
      );
    }

    const fused = [...fuse(meaning, words).values()]
      .map((entry) => ({
        ...entry,
        score: entry.score + nearBoost(entry.item.startPage, options.near),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit);

    return await hydrate(db, profileId, fused);
  } catch (error) {
    log.debug(SCOPE, 'a search failed', error);
    return [];
  }
}

/** The vector half: one query embedding, then one or two scans. */
async function semanticHits(
  db: Parameters<typeof Chunks.vectorsOf>[0],
  profileId: string,
  query: string,
  options: RetrieveOptions,
): Promise<Ranked[]> {
  const [embedded] = await onnxEngine(profileId).embed([query], 'query');
  if (embedded === undefined) {
    return [];
  }
  const vector = dequantise(embedded);

  const documentIds =
    options.scope !== null
      ? [options.scope]
      : topK(await Chunks.documentVectors(db, MODEL_VERSION), LIBRARY_CANDIDATES, (candidate) =>
          score(vector, candidate),
        ).map((candidate) => candidate.documentId);

  const scored: (Ranked & { value: number })[] = [];
  for (const documentId of documentIds) {
    for (const stored of await Chunks.vectorsOf(db, documentId, MODEL_VERSION)) {
      scored.push({
        key: stored.chunkId,
        documentId,
        startPage: stored.startPage,
        endPage: stored.endPage,
        value: score(vector, stored),
      });
    }
  }

  return topK(scored, RETRIEVE_POOL, (hit) => hit.value);
}

/**
 * Turns ranked ranges back into something a row can render.
 *
 * The text comes out of the `pages` mirror here and nowhere earlier, which is
 * the whole reason chunks store offsets: scanning three hundred thousand
 * passages would have meant reading three hundred thousand strings, and only
 * ten of them are ever shown.
 */
async function hydrate(
  db: Parameters<typeof Documents.documentById>[0],
  profileId: string,
  entries: readonly { item: Ranked; score: number; found: Found }[],
): Promise<Passage[]> {
  const titles = new Map<string, string>();
  const out: Passage[] = [];

  for (const entry of entries) {
    let title = titles.get(entry.item.documentId);
    if (title === undefined) {
      const document = await Documents.documentById(db, entry.item.documentId);
      if (document === null) {
        continue;
      }
      title = document.title;
      titles.set(entry.item.documentId, title);
    }

    const wanted: number[] = [];
    for (let page = entry.item.startPage; page <= entry.item.endPage; page += 1) {
      wanted.push(page);
    }
    const text = await pageTextOf(profileId, entry.item.documentId, wanted);

    const chunk = await Chunks.chunksOnPage(
      db,
      entry.item.documentId,
      CHUNK_VERSION,
      entry.item.startPage,
    );
    const range = chunk.find((candidate) => candidate.id === entry.item.key) ?? chunk[0];

    const body =
      range === undefined ? (text.get(entry.item.startPage) ?? '') : sliceRange(range, text);

    out.push({
      documentId: entry.item.documentId,
      title,
      startPage: entry.item.startPage,
      endPage: entry.item.endPage,
      text: body.trim(),
      score: entry.score,
      found: entry.found,
    });
  }

  return out;
}

function sliceRange(range: Chunks.Chunk, text: Map<number, string>): string {
  if (range.startPage === range.endPage) {
    return (text.get(range.startPage) ?? '').slice(range.startOffset, range.endOffset);
  }
  const parts: string[] = [];
  for (let page = range.startPage; page <= range.endPage; page += 1) {
    const body = text.get(page);
    if (body === undefined) {
      continue;
    }
    parts.push(
      page === range.startPage
        ? body.slice(range.startOffset)
        : page === range.endPage
          ? body.slice(0, range.endOffset)
          : body,
    );
  }
  return parts.join('\n');
}

/**
 * The pages to send with a question, and nothing else.
 *
 * What the Ask screen hands the account: integers. The passages themselves stay
 * on the phone — the server re-reads its own `documentPages` rows after the
 * same ownership check the reader passed — so a client cannot attribute
 * invented text to a book, and a 600-page document sends at most the handful of
 * page numbers its own index selected.
 *
 * De-duplicated and sorted, because two passages on one page is one page and
 * the account reads them in order.
 */
export function pagesFor(passages: readonly Passage[], limit: number): number[] {
  const pages = new Set<number>();
  for (const passage of passages) {
    for (let page = passage.startPage; page <= passage.endPage; page += 1) {
      pages.add(page);
      if (pages.size >= limit) {
        return [...pages].sort((a, b) => a - b);
      }
    }
  }
  return [...pages].sort((a, b) => a - b);
}
