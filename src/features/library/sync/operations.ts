/**
 * Turning a queued operation into a call on the account.
 *
 * One function per entity, and each of them reads the current local row rather
 * than a payload captured when the reader acted. That is what makes the queue's
 * coalescing work: a hundred page turns are one row, and when it is finally
 * sent it carries where the reader ended up rather than the first page they
 * left. `payload` records only *which* fields moved, so a favourite and a
 * rename queued together become two mutations rather than four.
 *
 * **Transfers are not here, and that is deliberate.** `library.uploadUrl`
 * deletes the object currently at the key before it signs a new URL, so
 * replaying it against an already-synced document destroys the copy in the
 * account while the row goes on claiming there is one. Nothing that moves bytes
 * belongs in a queue that retries; a reader who asks for a cloud copy with no
 * connection gets an intent on the row, and the engine performs it as a live,
 * foreground transfer when there is a connection to perform it over.
 */
import type { ConvexReactClient } from 'convex/react';
import type { SQLiteDatabase } from 'expo-sqlite';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';

import * as Collections from '../local/repository/collections';
import * as Documents from '../local/repository/documents';
import * as Marks from '../local/repository/marks';
import type { QueuedOperation } from '../local/repository/queue';

/**
 * The one place a local id becomes an account id.
 *
 * Everything under `local/` treats ids as opaque strings, and everything under
 * `convex/` types them as branded ids. The cast lives here rather than at
 * twenty call sites, and it is safe in the only way that matters: the server
 * checks ownership on every one regardless, so the worst a wrong string can do
 * is come back `FORBIDDEN`.
 */
function asDocumentId(id: string): Id<'documents'> {
  return id as Id<'documents'>;
}

/** Thrown when an operation depends on a create that has not landed yet. */
export class NotYetSynced extends Error {
  constructor(what: string) {
    super(`${what} has no id in the account yet.`);
    this.name = 'NotYetSynced';
  }
}

export type Sender = {
  client: ConvexReactClient;
  db: SQLiteDatabase;
};

/**
 * Sends one operation.
 *
 * Throws whatever the account threw, for `classify` to read. Returns nothing:
 * what to do about a success is the caller's, because it depends on whether the
 * row was a delete waiting to be purged or an edit waiting to be marked synced.
 */
export async function send(sender: Sender, operation: QueuedOperation): Promise<void> {
  switch (operation.entity) {
    case 'document':
      return await sendDocument(sender, operation);
    case 'bookmark':
      return await sendBookmark(sender, operation);
    case 'annotation':
      return await sendAnnotation(sender, operation);
    case 'collection':
      return await sendCollection(sender, operation);
    case 'membership':
      return await sendMembership(sender, operation);
  }
}

/* ── documents ──────────────────────────────────────────────────────── */

async function sendDocument(
  { client, db }: Sender,
  operation: QueuedOperation,
): Promise<void> {
  const document = await Documents.documentById(db, operation.entityId);
  if (document === null) {
    // The row went away underneath the queue. There is nothing to send and
    // nothing wrong; the operation is finished.
    return;
  }

  if (operation.op === 'remove') {
    if (document.remoteId !== null) {
      await client.mutation(api.library.remove, {
        documentId: asDocumentId(document.remoteId),
      });
    }
    return;
  }

  if (operation.op === 'create') {
    const remoteId = await client.mutation(api.library.importDocument, {
      title: document.title,
      byteSize: document.byteSize,
      localId: document.id,
      clientUpdatedAt: document.clientUpdatedAt,
      ...(document.author === null ? {} : { author: document.author }),
      ...(document.pageCount === null ? {} : { pageCount: document.pageCount }),
      ...(document.originalFileName === null
        ? {}
        : { originalFileName: document.originalFileName }),
      ...(document.mimeType === null ? {} : { mimeType: document.mimeType }),
      ...(document.fingerprint === null ? {} : { fingerprint: document.fingerprint }),
    });

    await Documents.markSynced(db, document.id, remoteId);

    // The probe usually finishes before the account has ever heard of the
    // document, so its outcome and the table of contents ride along right
    // after the create rather than waiting for a second operation.
    if (document.processing !== 'probing') {
      await sendProcessed(client, db, remoteId, document.id);
    }
    return;
  }

  if (document.remoteId === null) {
    throw new NotYetSynced('That document');
  }
  const documentId = asDocumentId(document.remoteId);
  // When the reader acted, not when the queue got round to it. The values above
  // are deliberately read fresh off the row — the account is told where somebody
  // ended up rather than replayed through every page they passed — but the clock
  // is the one field that must be the row's own. Stamped with `Date.now()` here,
  // a phone that has been in a tunnel since Tuesday would land today and beat a
  // rename another device made yesterday, and `isStale()` on the server could
  // never fire in the one direction it exists for.
  const clientUpdatedAt = document.clientUpdatedAt;
  const changed = new Set(operation.fields);

  if (
    changed.has('currentPage') ||
    changed.has('progress') ||
    changed.has('isFinished') ||
    changed.has('readingMode') ||
    changed.has('lastOpenedAt')
  ) {
    await client.mutation(api.library.recordProgress, {
      documentId,
      currentPage: document.currentPage,
      clientUpdatedAt,
      ...(document.pageCount === null ? {} : { pageCount: document.pageCount }),
      isFinished: document.isFinished,
      ...(document.readingMode === null ? {} : { readingMode: document.readingMode }),
    });
  }

  if (changed.has('isFavorite')) {
    await client.mutation(api.library.setFavorite, {
      documentId,
      isFavorite: document.isFavorite,
      clientUpdatedAt,
    });
  }

  if (changed.has('title') || changed.has('author')) {
    await client.mutation(api.library.rename, {
      documentId,
      title: document.title,
      clientUpdatedAt,
      ...(document.author === null ? {} : { author: document.author }),
    });
  }

  if (changed.has('processing') || changed.has('hasOutline')) {
    await sendProcessed(client, db, documentId, document.id);
  }
}

/** The probe's outcome and, when there is one, the document's own contents. */
async function sendProcessed(
  client: ConvexReactClient,
  db: SQLiteDatabase,
  documentId: Id<'documents'>,
  localId: string,
): Promise<void> {
  const document = await Documents.documentById(db, localId);
  if (document === null || document.processing === 'probing') {
    return;
  }

  const outline = await Documents.outlineOf(db, localId);

  await client.mutation(api.library.setProcessed, {
    documentId,
    processing: document.processing,
    ...(document.pageCount === null ? {} : { pageCount: document.pageCount }),
    ...(outline.length === 0 ? {} : { outline }),
  });
}

/* ── bookmarks ──────────────────────────────────────────────────────── */

async function sendBookmark({ client, db }: Sender, operation: QueuedOperation): Promise<void> {
  const bookmark = await Marks.bookmarkRow(db, operation.entityId);
  if (bookmark === null) {
    return;
  }

  const document = await Documents.documentById(db, bookmark.documentId);
  if (document === null) {
    return;
  }
  if (document.remoteId === null) {
    throw new NotYetSynced('That document');
  }
  const documentId = asDocumentId(document.remoteId);

  if (operation.op === 'remove') {
    await client.mutation(api.library.removeBookmark, {
      documentId,
      currentPage: bookmark.page,
    });
    return;
  }

  // A rename goes through `renameBookmark` rather than `addBookmark`, and the
  // difference is a staleness guard. Both are idempotent — `addBookmark` renames
  // the row already on the page rather than adding a second, which is why a
  // bookmark needs no id in the account — but only `renameBookmark` takes a
  // clock, so only it can refuse a label that has been sitting in this queue
  // since Tuesday when another device named the same page yesterday. Every other
  // renameable thing here already works that way; the mark was the exception.
  //
  // `create` covers a mark made offline and named before it ever synced, because
  // the queue coalesces `create` + `update` down to `create` — so the label
  // rides along on the insert and there is nothing stale to arbitrate yet.
  if (operation.op === 'update') {
    await client.mutation(api.library.renameBookmark, {
      documentId,
      currentPage: bookmark.page,
      label: bookmark.label ?? '',
      clientUpdatedAt: bookmark.clientUpdatedAt,
    });
    return;
  }

  await client.mutation(api.library.addBookmark, {
    documentId,
    currentPage: bookmark.page,
    ...(bookmark.label === null ? {} : { label: bookmark.label }),
  });
}

/* ── notes ──────────────────────────────────────────────────────────── */

async function sendAnnotation({ client, db }: Sender, operation: QueuedOperation): Promise<void> {
  const annotation = await Marks.annotationById(db, operation.entityId);
  if (annotation === null) {
    return;
  }

  if (operation.op === 'remove') {
    if (annotation.remoteId !== null) {
      await client.mutation(api.library.removeAnnotation, {
        annotationId: annotation.remoteId as Id<'documentAnnotations'>,
      });
    }
    return;
  }

  if (operation.op === 'create') {
    const document = await Documents.documentById(db, annotation.documentId);
    if (document === null) {
      return;
    }
    if (document.remoteId === null) {
      throw new NotYetSynced('That document');
    }

    const remoteId = await client.mutation(api.library.addAnnotation, {
      documentId: asDocumentId(document.remoteId),
      currentPage: annotation.page,
      kind: annotation.kind,
      clientOpId: annotation.id,
      clientUpdatedAt: annotation.clientUpdatedAt,
      ...(annotation.text === null ? {} : { text: annotation.text }),
      ...(annotation.note === null ? {} : { note: annotation.note }),
    });

    await Marks.attachAnnotationRemoteId(db, annotation.id, remoteId);
    return;
  }

  if (annotation.remoteId === null) {
    throw new NotYetSynced('That note');
  }
  await client.mutation(api.library.updateAnnotation, {
    annotationId: annotation.remoteId as Id<'documentAnnotations'>,
    note: annotation.note ?? '',
    clientUpdatedAt: annotation.clientUpdatedAt,
  });
}

/* ── collections ────────────────────────────────────────────────────── */

async function sendCollection({ client, db }: Sender, operation: QueuedOperation): Promise<void> {
  const collection = await Collections.collectionRow(db, operation.entityId);
  if (collection === null) {
    return;
  }

  if (operation.op === 'remove') {
    if (collection.remoteId !== null) {
      await client.mutation(api.collections.remove, {
        collectionId: collection.remoteId as Id<'collections'>,
      });
    }
    return;
  }

  if (operation.op === 'create') {
    const remoteId = await client.mutation(api.collections.create, {
      name: collection.name,
      clientOpId: collection.id,
      clientUpdatedAt: collection.clientUpdatedAt,
    });
    await Collections.attachCollectionRemoteId(db, collection.id, remoteId);
    return;
  }

  if (collection.remoteId === null) {
    throw new NotYetSynced('That collection');
  }
  await client.mutation(api.collections.rename, {
    collectionId: collection.remoteId as Id<'collections'>,
    name: collection.name,
    clientUpdatedAt: collection.clientUpdatedAt,
  });
}

/* ── membership ─────────────────────────────────────────────────────── */

async function sendMembership({ client, db }: Sender, operation: QueuedOperation): Promise<void> {
  // `<collectionId>:<documentId>`. Both halves are alphanumeric, here and in
  // `paths.ts`, so the colon cannot appear inside either one.
  const [collectionLocalId, documentLocalId] = operation.entityId.split(':');
  if (collectionLocalId === undefined || documentLocalId === undefined) {
    return;
  }

  const collection = await Collections.collectionRow(db, collectionLocalId);
  const document = await Documents.documentById(db, documentLocalId);
  if (collection === null || document === null) {
    return;
  }
  if (collection.remoteId === null) {
    throw new NotYetSynced('That collection');
  }
  if (document.remoteId === null) {
    throw new NotYetSynced('That document');
  }

  const args = {
    collectionId: collection.remoteId as Id<'collections'>,
    documentId: asDocumentId(document.remoteId),
  };

  if (operation.op === 'remove') {
    await client.mutation(api.collections.removeDocument, args);
    return;
  }
  await client.mutation(api.collections.addDocument, args);
}
