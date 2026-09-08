/**
 * The half of synchronisation that talks to the account.
 *
 * Two jobs, in this order and never the other one:
 *
 * 1. **Drain.** Send what this device has done. Until that is finished the
 *    account's answer is out of date by definition, and reconciling against it
 *    would overwrite a reader's own changes with a version that predates them.
 * 2. **Reconcile.** Read what the account holds and make the device agree —
 *    including working out what was deleted on another phone, which is done by
 *    noticing that a row this device knows about is not in the answer.
 *
 * Neither is on any screen's critical path. A reader opens a document, turns a
 * page, keeps a passage and deletes a book without this file being involved;
 * it runs afterwards, when there is a connection, and the library was already
 * correct before it did.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { log } from '@/lib/logger';

import * as Collections from '../local/repository/collections';
import * as Documents from '../local/repository/documents';
import * as Groups from '../local/repository/groups';
import * as Marks from '../local/repository/marks';
import * as Queue from '../local/repository/queue';
import * as Shares from '../local/repository/shares';
import { sweepDocument } from '../local/sweep';
import { classify, type Outcome } from './outcome';
import { NotYetSynced, send, type Sender } from './operations';

const SCOPE = 'sync';

/** How many operations one drain will send before yielding. */
const DRAIN_BATCH = 25;

/** How many rows one page of the reconcile asks for. */
const PAGE_SIZE = 200;

/** How long an operation waits on a create it depends on. */
const DEPENDENCY_MS = 2_000;

/**
 * How many missing tables of contents one reconcile fetches.
 *
 * One round trip per document, so this is the ceiling on how long a second
 * device spends catching up on outlines in a single pass. The rest arrive on
 * the next one; nothing is lost, because a document with no local outline is
 * still in the list until it has one.
 */
const OUTLINE_BATCH = 12;

/**
 * Walks a paginated query to the end.
 *
 * A loop that reassigns a cursor from the answer it is about to ask for makes
 * TypeScript give up on inferring the answer's type, and four copies of it
 * would be four places to get the termination wrong. One generic instead: the
 * caller says how to ask and what to do with a row, and this owns the cursor.
 */
async function eachRow<T>(
  ask: (cursor: string | null) => Promise<{ page: T[]; isDone: boolean; continueCursor: string }>,
  onRow: (row: T) => Promise<void>,
): Promise<void> {
  let cursor: string | null = null;
  for (;;) {
    const answer = await ask(cursor);
    for (const row of answer.page) {
      await onRow(row);
    }
    if (answer.isDone) {
      return;
    }
    cursor = answer.continueCursor;
  }
}

export type DrainResult = { sent: number; deferred: number; failed: number };

/**
 * Sends everything that is due.
 *
 * Sequential rather than parallel, and that is not timidity: the queue has
 * order in it. A note cannot be created before the document it is on, a
 * membership cannot be added before the collection exists, and `claim` returns
 * oldest first precisely so those land in the order they were made. Sending
 * four at once would be four chances to get that wrong for no gain a reader
 * could perceive.
 */
export async function drain(sender: Sender, profileId: string): Promise<DrainResult> {
  const result: DrainResult = { sent: 0, deferred: 0, failed: 0 };
  const operations = await Queue.claim(sender.db, Date.now(), DRAIN_BATCH);

  for (const operation of operations) {
    let outcome: Outcome;

    try {
      await send(sender, operation);
      outcome = { kind: 'done' };
    } catch (error) {
      if (error instanceof NotYetSynced) {
        // The create it depends on is in this same queue and earlier in it, so
        // this is a matter of waiting rather than of failing. Not counted as an
        // attempt: an operation should not exhaust its retries because something
        // ahead of it was slow.
        await Queue.defer(
          sender.db,
          operation.opId,
          Date.now() + DEPENDENCY_MS,
          'Waiting for something else to sync first.',
          false,
        );
        result.deferred += 1;
        continue;
      }
      outcome = classify(error, operation.op, operation.attempts);
    }

    if (outcome.kind === 'retry') {
      await Queue.defer(
        sender.db,
        operation.opId,
        Date.now() + outcome.afterMs,
        outcome.reason,
        outcome.counts,
      );
      result.deferred += 1;
      continue;
    }

    if (outcome.kind === 'failed') {
      log.warn(SCOPE, `an operation will not go: ${operation.entity} ${operation.op}`);
      await Queue.markFailed(sender.db, operation.opId, outcome.reason);
      result.failed += 1;
      continue;
    }

    await Queue.acknowledge(sender.db, operation.opId);
    await settle(sender.db, profileId, operation, outcome.kind === 'dropped');
    result.sent += 1;
  }

  return result;
}

/**
 * What happens on this device once the account has agreed.
 *
 * A delete that was waiting to be sent can finally take its row with it; an
 * edit is marked as matching again — but only if nothing has been queued for it
 * since, because a reader who turned another page while the last one was in
 * flight has not been caught up with.
 */
async function settle(
  db: SQLiteDatabase,
  profileId: string,
  operation: Queue.QueuedOperation,
  dropped: boolean,
): Promise<void> {
  const gone = operation.op === 'remove' || dropped;

  switch (operation.entity) {
    case 'document': {
      if (gone) {
        sweepDocument(profileId, operation.entityId, 'document');
        await Documents.purge(db, operation.entityId);
        return;
      }
      if (!(await Queue.isPending(db, 'document', operation.entityId))) {
        await Documents.markSynced(db, operation.entityId, null);
      }
      return;
    }
    case 'bookmark':
    case 'annotation': {
      if (gone) {
        await Marks.purgeMarks(db, [operation.entityId]);
      }
      return;
    }
    case 'collection': {
      if (gone) {
        await Collections.purgeCollection(db, operation.entityId);
      }
      return;
    }
    case 'membership': {
      if (gone) {
        await Collections.purgeMembership(db, operation.entityId);
      }
      return;
    }
  }
}

/**
 * Brings the account's answer down, and works out what is no longer in it.
 *
 * Only run with an empty queue. With operations still waiting, a row this
 * device holds and the account does not is a row the account has not been told
 * about yet — deleting it here would throw away the reader's own import.
 */
export async function reconcile(sender: Sender, profileId: string): Promise<void> {
  const { client, db } = sender;

  const seenDocuments = new Set<string>();

  await eachRow(
    (cursor) => client.query(api.library.snapshot, { paginationOpts: { numItems: PAGE_SIZE, cursor } }),
    async (remote) => {
      seenDocuments.add(remote.id);
      await Documents.upsertFromRemote(db, remote);
    },
  );

  // Deletion by absence. A row with an id in the account, nothing waiting to be
  // sent, and no place in the answer was deleted on another device — so the
  // file, the cover, the page pictures, the mirrored text and the stored
  // password all go with it here too.
  for (const [remoteId, localId] of await Documents.knownRemoteIds(db)) {
    if (seenDocuments.has(remoteId)) {
      continue;
    }
    if (await Queue.isPending(db, 'document', localId)) {
      continue;
    }
    log.debug(SCOPE, 'a document was deleted elsewhere');
    sweepDocument(profileId, localId, 'document');
    await Documents.purge(db, localId);
  }

  await reconcileBookmarks(sender);
  await reconcileAnnotations(sender);
  await reconcileCollections(sender);
  await reconcileShares(sender);
  await reconcileGroups(sender);
  await reconcileEvents(sender);
  await reconcileOutlines(sender);

  await db.runAsync(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('lastSyncedAt', ?)",
    String(Date.now()),
  );
}

/**
 * Fetches the tables of contents this device is missing.
 *
 * The one part of the reconcile that is not a diff. Everything else pages the
 * whole account down and works out what is no longer in it; an outline is
 * fetched one document at a time, only for documents the account says have one
 * and this device does not, and never again once it has landed.
 *
 * Sequential and bounded, on the same quiet footing as the cover sync and the
 * text mirror beside it: a reader who signs in on a second phone with two
 * hundred books should not spend two hundred round trips before the library
 * settles. Newest-opened first, so the document somebody is most likely to
 * open next is the one that gets its Contents back first.
 *
 * A failure is skipped rather than retried. Nothing is lost — the document is
 * still in the list next time, because the local row still has no outline.
 */
async function reconcileOutlines({ client, db }: Sender): Promise<void> {
  const missing = await Documents.documentsMissingOutline(db);

  for (const document of missing.slice(0, OUTLINE_BATCH)) {
    try {
      const entries = await client.query(api.library.outline, {
        documentId: document.remoteId as Id<'documents'>,
      });
      if (entries.length === 0) {
        continue;
      }
      await Documents.saveOutline(db, document.id, entries);
    } catch (error) {
      log.debug(SCOPE, 'could not fetch an outline', error);
    }
  }
}

async function reconcileBookmarks({ client, db }: Sender): Promise<void> {
  const seen = new Set<string>();

  await eachRow(
    (cursor) =>
      client.query(api.library.allBookmarks, { paginationOpts: { numItems: PAGE_SIZE, cursor } }),
    async (remote) => {
      const localId = await Documents.localIdFor(db, remote.documentId);
      if (localId === null) {
        return;
      }
      seen.add(await Marks.upsertRemoteBookmark(db, localId, remote));
    },
  );

  await Marks.pruneBookmarks(db, seen);
}

async function reconcileAnnotations({ client, db }: Sender): Promise<void> {
  const seen = new Set<string>();

  await eachRow(
    (cursor) =>
      client.query(api.library.allAnnotations, { paginationOpts: { numItems: PAGE_SIZE, cursor } }),
    async (remote) => {
      const localId = await Documents.localIdFor(db, remote.documentId);
      if (localId === null) {
        return;
      }
      seen.add(remote.id);
      await Marks.upsertRemoteAnnotation(db, { ...remote, documentId: localId });
    },
  );

  await Marks.pruneAnnotations(db, seen);
}

async function reconcileCollections({ client, db }: Sender): Promise<void> {
  const collections = await client.query(api.collections.list, {});
  const seen = new Set<string>();

  for (const remote of collections) {
    seen.add(remote.id);
    await Collections.upsertRemoteCollection(db, remote);
  }
  await Collections.pruneCollections(db, seen);

  // Membership arrives as one flat relation rather than a list per folder, so
  // it is gathered first and written per collection — `replaceRemoteMembership`
  // replaces only the rows that already agreed with the account, which is what
  // protects a move the reader made while offline.
  const grouped = new Map<string, string[]>();

  await eachRow(
    (cursor) =>
      client.query(api.collections.membership, { paginationOpts: { numItems: PAGE_SIZE, cursor } }),
    async (row) => {
      const collectionId = await Collections.localIdFor(db, row.collectionId);
      const documentId = await Documents.localIdFor(db, row.documentId);
      if (collectionId === null || documentId === null) {
        return;
      }
      const existing = grouped.get(collectionId);
      if (existing === undefined) {
        grouped.set(collectionId, [documentId]);
      } else {
        existing.push(documentId);
      }
    },
  );

  for (const [collectionId, documentIds] of grouped) {
    await Collections.replaceRemoteMembership(db, collectionId, documentIds);
  }
  // A collection the account still has but that now holds nothing needs its
  // rows cleared too, and it is not in `grouped` — an empty group is exactly
  // the case a loop over the answer cannot see.
  for (const collectionId of await Collections.localIdsOf(db)) {
    if (!grouped.has(collectionId)) {
      await Collections.replaceRemoteMembership(db, collectionId, []);
    }
  }
}

/* ── sharing ────────────────────────────────────────────────────────── */

/**
 * Grants, both directions.
 *
 * Two queries rather than one, because the two sides are indexed differently on
 * the account and merging them there would mean a scan: `inbox` walks the
 * recipient's own index and `outbox` walks the owner's. Locally they are one
 * table separated by `direction`, which is what lets the Shared screen show
 * both with one read.
 *
 * The prune is by absence, like documents — with one important exception. A
 * **revoked** share is still in the answer, because the row is what tells the
 * recipient who removed their access and when. What disappears is a share whose
 * document was deleted, and that one should disappear: there is nothing left
 * for it to describe.
 */
async function reconcileShares({ client, db }: Sender): Promise<void> {
  const [incoming, outgoing] = await Promise.all([
    client.query(api.sharing.inbox, { filter: 'all' }),
    client.query(api.sharing.outbox, {}),
  ]);

  const seen = new Set<string>();

  for (const remote of [...incoming, ...outgoing]) {
    seen.add(remote.id);
    await Shares.upsertRemoteShare(db, {
      id: remote.id,
      remoteId: remote.id,
      documentId: remote.document?.id ?? null,
      direction: remote.direction,
      subject: remote.subject,
      counterpartId: remote.counterpart?.id ?? null,
      counterpartName: remote.counterpart?.displayName ?? null,
      counterpartHandle: remote.counterpart?.handle ?? null,
      counterpartPictureUrl: remote.counterpart?.pictureUrl ?? null,
      groupId: remote.group?.id ?? null,
      groupName: remote.group?.name ?? null,
      title: remote.document?.title ?? null,
      author: remote.document?.author ?? null,
      pageCount: remote.document?.pageCount ?? null,
      byteSize: remote.document?.byteSize ?? 0,
      hasCover: remote.document?.hasCover ?? false,
      role: remote.role,
      canDownload: remote.canDownload,
      canReshare: remote.canReshare,
      status: remote.status,
      message: remote.message,
      expiresAt: remote.expiresAt,
      revokedAt: remote.revokedAt,
      createdAt: remote.createdAt,
      updatedAt: remote.updatedAt,
      clientUpdatedAt: 0,
      syncState: 'synced',
    });
  }

  const dropped = await Shares.pruneShares(db, seen);
  for (const localId of dropped) {
    await Queue.dropOperationsFor(db, 'share', [localId]);
  }
}

/**
 * Groups and who is in them.
 *
 * Membership is replaced wholesale per group rather than diffed, and
 * `replaceMembers` says why: membership decides what somebody can open, so a
 * member this device failed to notice leaving is a name still shown in a list
 * of who can read the reader's document.
 */
async function reconcileGroups({ client, db }: Sender): Promise<void> {
  const groups = await client.query(api.groups.list, {});
  const seen = new Set<string>();

  for (const remote of groups) {
    seen.add(remote.id);
    await Groups.upsertRemoteGroup(db, {
      id: remote.id,
      name: remote.name,
      memberCount: remote.memberCount,
      role: remote.role,
      createdAt: remote.createdAt,
      updatedAt: remote.updatedAt,
    });

    const detail = await client.query(api.groups.detail, {
      groupId: remote.id as Id<'groups'>,
    });
    await Groups.replaceMembers(
      db,
      remote.id,
      detail.members
        .filter((member) => member.profile !== null)
        .map((member) => ({
          groupId: remote.id,
          userId: member.profile!.id,
          name: member.profile!.displayName,
          handle: member.profile!.handle,
          pictureUrl: member.profile!.pictureUrl,
          role: member.role,
          isOwner: member.isOwner,
          addedAt: member.addedAt,
        })),
    );
  }

  await Groups.pruneGroups(db, seen);
}

/**
 * The inbox of things that happened.
 *
 * Mirrored so the Shared screen has something to show on a cold launch with no
 * connection, and replaced rather than merged: an event is immutable except for
 * whether it has been read, and the account is the authority on both.
 *
 * Bounded to what the screen renders. This is a feed, not an archive — a device
 * that kept every event forever would be keeping a log nobody reads.
 */
async function reconcileEvents({ client, db }: Sender): Promise<void> {
  const events = await client.query(api.sharing.events, { limit: 50 });

  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM shareEvents');
    for (const event of events) {
      await txn.runAsync(
        `INSERT INTO shareEvents (id, kind, shareId, documentId, groupId, actorName, actorHandle, actorPicture, readAt, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.id,
          event.kind,
          event.shareId,
          event.documentId,
          event.groupId,
          event.actor?.displayName ?? null,
          event.actor?.handle ?? null,
          event.actor?.pictureUrl ?? null,
          event.read ? event.createdAt : null,
          event.createdAt,
        ],
      );
    }
  });
}
