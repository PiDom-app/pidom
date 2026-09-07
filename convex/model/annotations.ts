import type { PaginationOptions, PaginationResult } from 'convex/server';
import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { assertOwner } from './auth';
import { annotationByOpId, clientClock, isLocalId, isStale } from './sync';
import {
  ANNOTATIONS_PER_DOCUMENT,
  ANNOTATION_NOTE_MAX,
  ANNOTATION_TEXT_MAX,
  PAGE_COUNT_MAX,
  clamp,
  cleanOptionalText,
  invalid,
} from './limits';

/**
 * Passages kept out of a document, and notes written about its pages.
 *
 * A file of its own rather than more of `model/library.ts`, which is already
 * past a thousand lines and covers the document itself. This covers what a
 * reader adds to one.
 *
 * **What an annotation is here is bounded by what the renderer will say.**
 * `react-native-pdf` 7.0.5 reports the *text* of a selection and no geometry;
 * `onPageSingleTap` reports a touch in view coordinates, which stop describing
 * the page the moment anything scrolls. Its selection is iOS-only besides — the
 * Android view manager has no selection code at all. So an annotation is
 * anchored to a page, not to a rectangle, and the Android path writes one from
 * the reader's overflow rather than from a selection that cannot happen.
 * `documentAnnotations.rect` exists, optional and unwritten, for the day that
 * changes.
 *
 * Two rules from `model/library.ts` hold here unchanged:
 *
 *   1. Reads are `.take(n)`, never `.collect()`.
 *   2. **Ownership is checked on the document before a row is read**, so a
 *      caller probing ids gets `FORBIDDEN` rather than an empty list — an empty
 *      list would confirm the document exists.
 *
 * And one that is specific to this table: the text in it is the reader's own
 * document content, so it is bounded on the way in and never logged. See
 * `docs/security.md`.
 */

/** The caller's document, or `FORBIDDEN`. */
async function requireDocument(
  ctx: QueryCtx | MutationCtx,
  owner: Doc<'users'>,
  documentId: Id<'documents'>,
): Promise<Doc<'documents'>> {
  const doc = await ctx.db.get('documents', documentId);
  assertOwner(doc, owner);
  return doc;
}

/* ── the wire shape ─────────────────────────────────────────────────── */

/** Beside the function that produces it, so the two cannot drift. */
export const annotationValidator = v.object({
  id: v.id('documentAnnotations'),
  page: v.number(),
  kind: v.union(v.literal('passage'), v.literal('note')),
  text: v.union(v.string(), v.null()),
  note: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export type PublicAnnotation = {
  id: Id<'documentAnnotations'>;
  page: number;
  kind: 'passage' | 'note';
  text: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
};

function toPublicAnnotation(row: Doc<'documentAnnotations'>): PublicAnnotation {
  return {
    id: row._id,
    page: row.page,
    kind: row.kind,
    text: row.text ?? null,
    note: row.note ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // `rect` is deliberately not on the wire. Nothing writes it, so putting it
    // there would be a field every client has to decide what to do with in
    // order to always find it absent.
  };
}

/**
 * The same shape with the document named, for the reconcile.
 *
 * `annotationValidator` leaves `documentId` out because every read of it is
 * already scoped to one document — the list in the reader. A device rebuilding
 * its whole library reads them all at once and has to know which book each one
 * belongs to.
 */
export const ownedAnnotationValidator = v.object({
  id: v.id('documentAnnotations'),
  documentId: v.id('documents'),
  page: v.number(),
  kind: v.union(v.literal('passage'), v.literal('note')),
  text: v.union(v.string(), v.null()),
  note: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export type OwnedAnnotation = PublicAnnotation & { documentId: Id<'documents'> };

/* ── reads ──────────────────────────────────────────────────────────── */

/* ── writes ─────────────────────────────────────────────────────────── */

/**
 * The caller's annotation, or `FORBIDDEN`.
 *
 * Both halves are checked, for the reason `model/collections.ts` gives about a
 * membership write naming two ids: the row carries a denormalised `ownerId`, so
 * checking only that would trust a field this table writes rather than the
 * relationship it stands for. The document is fetched too, so an annotation
 * whose document is gone cannot still be read through its own id.
 */
async function requireAnnotation(
  ctx: QueryCtx | MutationCtx,
  owner: Doc<'users'>,
  annotationId: Id<'documentAnnotations'>,
): Promise<Doc<'documentAnnotations'>> {
  const row = await ctx.db.get('documentAnnotations', annotationId);
  assertOwner(row, owner);
  await requireDocument(ctx, owner, row.documentId);
  return row;
}

/**
 * Keeps a passage, or writes a note against a page.
 *
 * **Idempotent on the device's own id, and nothing else.** Two passages kept
 * from the same page are two different sentences, so there is no natural key
 * here the way there is for a bookmark — which is why this used to dedupe
 * nothing at all, and why that was right while every call came from somebody
 * tapping Keep.
 *
 * It is wrong once the call can be queued. A create whose reply is lost after
 * it committed is delivered again, and without the lookup below the reader ends
 * up with the same passage in their list twice with no way to tell which is
 * which. `clientOpId` is the id the device already filed the note under, so the
 * second delivery finds the first and returns it.
 */
export async function add(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  input: {
    documentId: Id<'documents'>;
    page: number;
    kind: 'passage' | 'note';
    text?: string;
    note?: string;
    clientOpId?: string;
    clientUpdatedAt?: number;
  },
): Promise<Id<'documentAnnotations'>> {
  if (input.clientOpId !== undefined) {
    if (!isLocalId(input.clientOpId)) {
      invalid('That note id is not one Pidom writes.');
    }
    const existing = await annotationByOpId(ctx, owner, input.clientOpId);
    if (existing !== null) {
      return existing._id;
    }
  }

  const doc = await requireDocument(ctx, owner, input.documentId);

  // Clamped against the document, like every other page number that crosses
  // this boundary. A note on page 99999 of a 499-page book is a row that
  // renders and can never be reached.
  const lastPage = doc.pageCount === undefined ? PAGE_COUNT_MAX : Math.max(1, doc.pageCount);
  const page = Math.round(clamp(input.page, 1, lastPage));

  const text = cleanOptionalText(input.text, ANNOTATION_TEXT_MAX, 'A kept passage');
  const note = cleanOptionalText(input.note, ANNOTATION_NOTE_MAX, 'A note');

  // A row with neither is a page number with nothing attached to it — a
  // bookmark, and there is already a table for those.
  if (text === undefined && note === undefined) {
    invalid('A note needs either a passage or something written about it.');
  }
  // The kind describes where it came from, so a `passage` without the passage
  // is a claim the row cannot back up.
  if (input.kind === 'passage' && text === undefined) {
    invalid('A kept passage needs the text it was kept from.');
  }

  const count = (
    await ctx.db
      .query('documentAnnotations')
      .withIndex('by_document', (q) => q.eq('documentId', doc._id))
      .take(ANNOTATIONS_PER_DOCUMENT)
  ).length;
  if (count >= ANNOTATIONS_PER_DOCUMENT) {
    invalid(`A document can hold ${ANNOTATIONS_PER_DOCUMENT} notes.`);
  }

  const now = Date.now();
  return await ctx.db.insert('documentAnnotations', {
    ownerId: owner._id,
    documentId: doc._id,
    page,
    kind: input.kind,
    ...(text === undefined ? {} : { text }),
    ...(note === undefined ? {} : { note }),
    ...(input.clientOpId === undefined ? {} : { clientOpId: input.clientOpId }),
    ...clientClock(input.clientUpdatedAt),
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Changes what the reader wrote. The passage itself is never editable.
 *
 * `text` is the document's words, and a field that let a reader rewrite them
 * would turn a quotation into a paraphrase nobody could tell apart from one.
 *
 * An empty note clears the field rather than storing a blank one, which is what
 * a reader deleting everything they typed and saving means. That is the one
 * place in this backend an explicit `undefined` reaches `patch`, and it is
 * meant: Convex reads it as "delete this field".
 */
export async function update(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  annotationId: Id<'documentAnnotations'>,
  note: string,
  clientUpdatedAt: number | undefined,
): Promise<void> {
  const row = await requireAnnotation(ctx, owner, annotationId);

  // An edit that has already been overtaken. Dropped rather than refused: the
  // client has nothing to retry and nothing has gone wrong.
  if (isStale(row.clientUpdatedAt, clientUpdatedAt)) {
    return;
  }

  const cleaned = cleanOptionalText(note, ANNOTATION_NOTE_MAX, 'A note');

  // A passage can lose its note and remain a passage. A note that loses its
  // note is an empty row, so it is refused rather than silently emptied.
  if (cleaned === undefined && row.kind === 'note') {
    invalid('A note cannot be empty. Delete it instead.');
  }

  await ctx.db.patch('documentAnnotations', row._id, {
    note: cleaned,
    ...clientClock(clientUpdatedAt),
    updatedAt: Date.now(),
  });
}

/**
 * Deletes one, and is genuinely silent when it is already gone.
 *
 * It said it was silent and it was not: `requireAnnotation` calls `assertOwner`,
 * which reports "no such row" and "not yours" identically as `FORBIDDEN` — so a
 * second delivery of the same delete threw. That was invisible while the only
 * caller was a list waiting for an answer, and it is a queue that never drains
 * once the caller is an outbox: the operation fails, is retried, fails again,
 * for ever, over a note that is already deleted.
 *
 * The row is looked up directly instead. An id that names nothing answers
 * nothing; an id that names somebody else's note still answers `FORBIDDEN`,
 * because that check has not moved.
 */
export async function remove(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  annotationId: Id<'documentAnnotations'>,
): Promise<void> {
  const row = await ctx.db.get('documentAnnotations', annotationId);
  if (row === null) {
    return;
  }
  assertOwner(row, owner);
  await ctx.db.delete('documentAnnotations', row._id);
}

/**
 * The cascade, called from `removeDocument`.
 *
 * Bounded by the same constant that bounds how many can exist, so one pass is
 * always enough — the same argument `deleteBookmarks` makes, and the reason
 * neither needs the prune queue that page text does.
 *
 * Deliberately **not** called from `detachUpload`. An annotation is made on
 * this device from a file on this device; it has nothing to do with whether
 * there is a copy in the account, and removing one because the reader stopped
 * syncing would delete their own writing over a storage decision. The outline
 * follows the same rule.
 */
export async function deleteAll(ctx: MutationCtx, documentId: Id<'documents'>): Promise<void> {
  const rows = await ctx.db
    .query('documentAnnotations')
    .withIndex('by_document', (q) => q.eq('documentId', documentId))
    .take(ANNOTATIONS_PER_DOCUMENT);
  for (const row of rows) {
    await ctx.db.delete('documentAnnotations', row._id);
  }
}

/**
 * Every note in the account, a page at a time.
 *
 * The annotation half of the reconcile in `model/library.ts`. Ordered by
 * creation through `by_owner`, which is enough to resume from — a device that
 * is interrupted keeps the cursor and asks for the rest later.
 */
export async function allForOwner(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
  paginationOpts: PaginationOptions,
): Promise<PaginationResult<OwnedAnnotation>> {
  const page = await ctx.db
    .query('documentAnnotations')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .paginate(paginationOpts);

  return {
    ...page,
    page: page.page.map((row) => ({ ...toPublicAnnotation(row), documentId: row.documentId })),
  };
}
