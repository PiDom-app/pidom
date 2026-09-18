import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { assertOwner } from './auth';
import { requireReadable } from './access';
import {
  OUTLINE_DEPTH_MAX,
  OUTLINE_ENTRY_MAX,
  OUTLINE_TITLE_MAX,
  PAGE_COUNT_MAX,
  clamp,
  cleanText,
} from './limits';

/**
 * Everything that happens to a document after its row exists.
 *
 * Two halves that never meet. The **device** half writes `processing`, the page
 * count and the outline, all off one `<Pdf>` load — it is the only place that
 * can, because the file is on the phone. The **cloud** half writes `textStatus`
 * and the text object, and it is the only place that can do *that*, because the
 * copy in R2 is the only one the server can read.
 *
 * A local-only document therefore ends at `processing: 'ready'` with no text
 * status at all, and that is a finished state rather than a stalled one.
 */

/* ── the wire shapes ─────────────────────────────────────────────────── */

export const outlineEntryValidator = v.object({
  title: v.string(),
  page: v.number(),
  depth: v.number(),
});
export type OutlineEntry = { title: string; page: number; depth: number };

export const searchHitValidator = v.object({
  documentId: v.id('documents'),
  title: v.string(),
  page: v.number(),
  snippet: v.string(),
});
export type SearchHit = {
  documentId: Id<'documents'>;
  title: string;
  page: number;
  snippet: string;
};

export const jobValidator = v.object({
  status: v.union(
    v.literal('queued'),
    v.literal('running'),
    v.literal('done'),
    v.literal('failed'),
    v.literal('cancelled'),
  ),
  pagesDone: v.number(),
  pagesTotal: v.union(v.number(), v.null()),
  error: v.union(v.string(), v.null()),
  startedAt: v.number(),
});

/* ── the outline ─────────────────────────────────────────────────────── */

/**
 * Replaces a document's table of contents with what the device read out of it.
 *
 * Every field is checked, because every field came from the client. The viewer
 * hands back whatever the PDF declares and a PDF is a file somebody else wrote:
 * a title can be a megabyte, a page number can be `-1` or `1e9`, and a depth
 * can be forty. `cleanText` is the same normaliser titles go through — control
 * characters out, zero-width run dropped, length checked after stripping.
 *
 * Entries past `OUTLINE_ENTRY_MAX` are dropped rather than refused. A refusal
 * would lose the whole contents list of the one kind of document most likely to
 * have a long one.
 */
export async function setOutline(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  documentId: Id<'documents'>,
  entries: OutlineEntry[],
): Promise<void> {
  const doc = await ctx.db.get('documents', documentId);
  assertOwner(doc, owner);

  const lastPage = doc.pageCount ?? PAGE_COUNT_MAX;
  const cleaned: OutlineEntry[] = [];

  for (const entry of entries.slice(0, OUTLINE_ENTRY_MAX)) {
    // An entry whose title is only whitespace is a bookmark with no label. It
    // would render as a blank row with a page number, so it is skipped rather
    // than cleaned into one.
    if (entry.title.trim() === '') {
      continue;
    }
    cleaned.push({
      title: cleanText(entry.title, OUTLINE_TITLE_MAX, 'Contents entry'),
      // Clamped against the document's own page count: an entry pointing past
      // the end is a jump to a page that does not exist.
      page: Math.round(clamp(entry.page, 1, lastPage)),
      // Flattened rather than refused. A fourth level is a real thing in a real
      // PDF; it just cannot be drawn distinctly on a phone.
      depth: Math.round(clamp(entry.depth, 0, OUTLINE_DEPTH_MAX - 1)),
    });
  }

  const existing = await ctx.db
    .query('documentOutline')
    .withIndex('by_document', (q) => q.eq('documentId', doc._id))
    .unique();

  // No entries means no outline, and the row goes rather than sitting there
  // empty. Both branches write `documents.hasOutline`, which is what every
  // rail item reads instead of looking this table up per tile.
  if (cleaned.length === 0) {
    if (existing !== null) {
      await ctx.db.delete('documentOutline', existing._id);
    }
    await ctx.db.patch('documents', doc._id, { hasOutline: false });
    return;
  }

  const now = Date.now();
  if (existing === null) {
    await ctx.db.insert('documentOutline', {
      ownerId: owner._id,
      documentId: doc._id,
      entries: cleaned,
      updatedAt: now,
    });
  } else {
    await ctx.db.patch('documentOutline', existing._id, { entries: cleaned, updatedAt: now });
  }
  await ctx.db.patch('documents', doc._id, { hasOutline: true });
}

export async function outlineFor(
  ctx: QueryCtx,
  owner: Doc<'users'>,
  documentId: Id<'documents'>,
): Promise<OutlineEntry[]> {
  // The access check is on the document rather than the outline row, so a
  // caller probing ids gets `FORBIDDEN` before anything is read.
  //
  // `requireReadable` rather than `assertOwner`, because a table of contents is
  // the first thing a recipient needs and withholding it would make a shared
  // document navigable only by scrubbing. For an owner the two are the same
  // check — one `get` and one comparison — so nothing about the owner path
  // changed when sharing landed.
  const { doc } = await requireReadable(ctx, owner, documentId);

  const row = await ctx.db
    .query('documentOutline')
    .withIndex('by_document', (q) => q.eq('documentId', doc._id))
    .unique();

  return row?.entries ?? [];
}

/** Drops a document's outline. Called from the delete cascade. */
export async function deleteOutline(ctx: MutationCtx, documentId: Id<'documents'>): Promise<void> {
  const row = await ctx.db
    .query('documentOutline')
    .withIndex('by_document', (q) => q.eq('documentId', documentId))
    .unique();
  if (row !== null) {
    await ctx.db.delete('documentOutline', row._id);
  }
}

/** Drops a document's job row, for the same reason. */
export async function deleteJob(ctx: MutationCtx, documentId: Id<'documents'>): Promise<void> {
  const row = await ctx.db
    .query('documentJobs')
    .withIndex('by_document', (q) => q.eq('documentId', documentId))
    .unique();
  if (row !== null) {
    await ctx.db.delete('documentJobs', row._id);
  }
}

/* ── page text ───────────────────────────────────────────────────────── */

/**
 * Deletes a document's extracted pages, up to a bound. **Legacy.**
 *
 * Page text is one R2 object now (`documents.textStorageKey`), so a document
 * extracted since that change has no rows here at all and deleting it is one
 * object delete. What is left is everything extracted before, and this is how
 * it goes: bounded, because a mutation writes 16,000 documents and a 2,000-page
 * book is past that. Returns how many went, so a caller can keep going until it
 * returns zero.
 */
export async function deletePages(
  ctx: MutationCtx,
  documentId: Id<'documents'>,
  take: number,
): Promise<number> {
  const pages = await ctx.db
    .query('documentPages')
    .withIndex('by_document_and_page', (q) => q.eq('documentId', documentId))
    .take(take);

  for (const page of pages) {
    await ctx.db.delete('documentPages', page._id);
  }
  return pages.length;
}

/**
 * Records that a document still has page text to clear.
 *
 * Called by the two paths that delete pages when they hit their budget and
 * cannot finish. Idempotent: a document already queued is left where it is,
 * because moving it to the back would let a long book starve behind newer ones.
 */
export async function queuePagePrune(ctx: MutationCtx, documentId: Id<'documents'>): Promise<void> {
  const existing = await ctx.db
    .query('pagePruneQueue')
    .withIndex('by_document', (q) => q.eq('documentId', documentId))
    .unique();

  if (existing === null) {
    await ctx.db.insert('pagePruneQueue', { documentId, queuedAt: Date.now() });
  }
}

/**
 * Deletes a batch of a queued document's pages, and dequeues it when empty.
 *
 * Returns how many went, so the caller can tell a finished document from one
 * that needs another pass tomorrow.
 */
export async function drainPagePrune(
  ctx: MutationCtx,
  row: Doc<'pagePruneQueue'>,
  take: number,
): Promise<number> {
  // The cast is safe and narrow: the id was a `documents` id when it was
  // queued, and the only thing done with it is an index lookup that returns
  // nothing when the document is gone — which is the ordinary case here.
  const deleted = await deletePages(ctx, row.documentId as Id<'documents'>, take);

  if (deleted < take) {
    // Fewer than asked for means the table is empty for this document.
    await ctx.db.delete('pagePruneQueue', row._id);
  }
  return deleted;
}

/* ── jobs ────────────────────────────────────────────────────────────── */

/**
 * Records that an extraction has started, replacing any previous record.
 *
 * One row per document rather than a history: the Details sheet asks "what is
 * happening to this document now", and a table of every attempt ever made would
 * be a table that only grows.
 */
export async function startJob(
  ctx: MutationCtx,
  documentId: Id<'documents'>,
  ownerId: Id<'users'>,
  workflowId: string,
): Promise<void> {
  const now = Date.now();
  const existing = await ctx.db
    .query('documentJobs')
    .withIndex('by_document', (q) => q.eq('documentId', documentId))
    .unique();

  const row = {
    ownerId,
    documentId,
    workflowId,
    status: 'queued' as const,
    pagesDone: 0,
    startedAt: now,
    updatedAt: now,
  };

  if (existing === null) {
    await ctx.db.insert('documentJobs', row);
    return;
  }
  await ctx.db.patch('documentJobs', existing._id, {
    ...row,
    // Convex reads an explicit `undefined` in a patch as "delete this field",
    // which is what clearing a previous run's error and totals wants.
    pagesTotal: undefined,
    error: undefined,
  });
}

export async function updateJob(
  ctx: MutationCtx,
  documentId: Id<'documents'>,
  patch: {
    status?: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
    pagesDone?: number;
    pagesTotal?: number;
    error?: string;
  },
): Promise<void> {
  const row = await ctx.db
    .query('documentJobs')
    .withIndex('by_document', (q) => q.eq('documentId', documentId))
    .unique();
  if (row === null) {
    return;
  }
  await ctx.db.patch('documentJobs', row._id, { ...patch, updatedAt: Date.now() });
}

export async function jobFor(
  ctx: QueryCtx,
  owner: Doc<'users'>,
  documentId: Id<'documents'>,
): Promise<Doc<'documentJobs'> | null> {
  // Readable rather than owned: the Details sheet renders this, and a recipient
  // looking at a document still being extracted should see "218 of 499" rather
  // than a permission error.
  const { doc } = await requireReadable(ctx, owner, documentId);

  return await ctx.db
    .query('documentJobs')
    .withIndex('by_document', (q) => q.eq('documentId', doc._id))
    .unique();
}

export function toPublicJob(row: Doc<'documentJobs'>) {
  return {
    status: row.status,
    pagesDone: row.pagesDone,
    pagesTotal: row.pagesTotal ?? null,
    error: row.error ?? null,
    startedAt: row.startedAt,
  };
}
