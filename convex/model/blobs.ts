import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

/**
 * Shared PDF content, and the counting that makes sharing safe to delete.
 *
 * One file imported by forty people is one object in the bucket and one run of
 * pdf.js, rather than forty of each. The saving is real — a set text goes round
 * a class, and a course reader is the same three hundred megabytes on every
 * device in it — but sharing an object between accounts means **no account may
 * delete it alone**, and that is the whole of what this file exists to enforce.
 *
 * Three rules, and nothing here is correct without all three:
 *
 *   1. A blob is addressed only by a hash **R2 reported**, never by anything a
 *      client sent. `attachUpload` reads it out of object metadata after the
 *      bytes are already stored. The client's `fingerprint` covers 128 KB of
 *      the file and is forgeable; it gates same-account reuse and nothing else.
 *   2. Nothing asks this table a question on a caller's behalf. There is no
 *      path, public or otherwise, by which a request answers "does anyone have
 *      this file" — dedupe happens after an upload the client would have made
 *      anyway. R2 charges nothing either way, so the silence is free.
 *   3. `refCount` moves in the same mutation as the pointer that caused it, and
 *      **nothing deletes an object here**. Reaching zero only marks the blob
 *      collectable; the nightly pass does the deleting. An R2 call that failed
 *      inside a delete mutation would roll back a document the reader has
 *      already watched disappear.
 */

/** A blob holding these exact bytes, if one already does. Server-side only. */
export async function byHash(
  ctx: QueryCtx,
  contentHash: string,
): Promise<Doc<'contentBlobs'> | null> {
  return await ctx.db
    .query('contentBlobs')
    .withIndex('by_hash', (q) => q.eq('contentHash', contentHash))
    .first();
}

/** Whichever blob claims this object key, for the sweep's allowlist. */
export async function byKey(ctx: QueryCtx, key: string): Promise<Doc<'contentBlobs'> | null> {
  return await ctx.db
    .query('contentBlobs')
    .withIndex('by_key', (q) => q.eq('storageKey', key))
    .first();
}

/**
 * Whether any blob still needs this object, by either of the names it holds.
 *
 * Two point lookups rather than one, because a blob names a PDF and a text
 * object and both are keys some document originally minted under its own owner.
 * The first uploader deleting their document must not take either away from
 * everybody else, and `keyParts` cannot tell that from the key alone — it
 * recovers a document id that no longer exists, which reads as an orphan.
 *
 * `refCount > 0` rather than mere existence: a released blob is exactly what
 * the sweep is there to collect.
 */
export async function referencedKey(ctx: QueryCtx, key: string): Promise<boolean> {
  const owner = await byKey(ctx, key);
  if (owner !== null) {
    return owner.refCount > 0;
  }
  const text = await ctx.db
    .query('contentBlobs')
    .withIndex('by_text_key', (q) => q.eq('textStorageKey', key))
    .first();
  return text !== null && text.refCount > 0;
}

/**
 * Whether an object at this key is content more than one document points at.
 *
 * Asked before anything overwrites or deletes a key in place. The bytes live
 * wherever the first uploader put them, so a document's own
 * `<owner>/<doc>.pdf` can be the canonical copy for accounts that will never
 * know each other — and re-uploading over it would silently hand them a
 * different book.
 */
export async function sharedKey(ctx: QueryCtx, key: string): Promise<boolean> {
  const owner = await byKey(ctx, key);
  return owner !== null && owner.refCount > 1;
}

/**
 * Starts counting an object that until now belonged to one document.
 *
 * The bytes stay exactly where the first uploader put them — `<owner>/<doc>.pdf`
 * — and are not copied to a canonical name. Copying means an S3 call from
 * inside a mutation, and what an object is *called* matters far less than how
 * many documents point at it. The sweep asks `by_key` before it asks anything
 * about owners, so a first uploader deleting their document leaves the object
 * alone while anyone else still holds it.
 */
export async function create(
  ctx: MutationCtx,
  input: {
    contentHash: string;
    storageKey: string;
    byteSize: number;
    pageCount?: number;
  },
): Promise<Id<'contentBlobs'>> {
  return await ctx.db.insert('contentBlobs', {
    contentHash: input.contentHash,
    storageKey: input.storageKey,
    byteSize: input.byteSize,
    ...(input.pageCount === undefined ? {} : { pageCount: input.pageCount }),
    refCount: 1,
    createdAt: Date.now(),
  });
}

/** One more document points here. */
export async function retain(ctx: MutationCtx, blobId: Id<'contentBlobs'>): Promise<void> {
  const blob = await ctx.db.get('contentBlobs', blobId);
  if (blob === null) {
    return;
  }
  await ctx.db.patch('contentBlobs', blob._id, { refCount: blob.refCount + 1 });
}

/**
 * One fewer document points here.
 *
 * Clamped at zero rather than allowed to go negative, because a negative count
 * is a bug whose only possible consequence should be an object kept too long.
 * Deleting on a count that has already been double-decremented would be data
 * loss in somebody else's library.
 */
export async function release(ctx: MutationCtx, blobId: Id<'contentBlobs'>): Promise<void> {
  const blob = await ctx.db.get('contentBlobs', blobId);
  if (blob === null) {
    return;
  }
  await ctx.db.patch('contentBlobs', blob._id, { refCount: Math.max(0, blob.refCount - 1) });
}

/**
 * Records the text object extraction produced, so the next account to import
 * the same PDF inherits it and pdf.js never runs on those pages again.
 */
export async function setText(
  ctx: MutationCtx,
  blobId: Id<'contentBlobs'>,
  input: {
    textStorageKey?: string;
    textBytes?: number;
    pageCount?: number;
    textStatus: Doc<'documents'>['textStatus'];
  },
): Promise<void> {
  const blob = await ctx.db.get('contentBlobs', blobId);
  if (blob === null) {
    return;
  }
  await ctx.db.patch('contentBlobs', blob._id, {
    ...(input.textStorageKey === undefined ? {} : { textStorageKey: input.textStorageKey }),
    ...(input.textBytes === undefined ? {} : { textBytes: input.textBytes }),
    ...(input.pageCount === undefined ? {} : { pageCount: input.pageCount }),
    ...(input.textStatus === undefined ? {} : { textStatus: input.textStatus }),
  });
}

/**
 * What a document inherits when it points at a blob somebody already extracted.
 *
 * Returns the fields to patch onto the document, and whether extraction still
 * needs to run. `'ready'` with a text object is the case worth having: the new
 * document is searchable the moment it is created, with no action, no pdf.js
 * run and no second copy of the text.
 */
export function inherit(blob: Doc<'contentBlobs'>): {
  patch: Partial<Doc<'documents'>>;
  needsExtraction: boolean;
} {
  const usable = blob.textStatus === 'ready' && blob.textStorageKey !== undefined;
  const settled = usable || blob.textStatus === 'none';
  return {
    patch: {
      ...(blob.pageCount === undefined ? {} : { pageCount: blob.pageCount }),
      ...(usable
        ? {
            textStorageKey: blob.textStorageKey,
            ...(blob.textBytes === undefined ? {} : { textBytes: blob.textBytes }),
          }
        : {}),
      ...(settled ? { textStatus: blob.textStatus } : {}),
    },
    // A blob mid-extraction is not waited on: the document that started it will
    // finish it, and `finalizeText` writes the result back here for everyone
    // pointing at it. Queuing a second run would parse the same pages twice.
    needsExtraction: !settled && blob.textStatus !== 'queued' && blob.textStatus !== 'extracting',
  };
}
