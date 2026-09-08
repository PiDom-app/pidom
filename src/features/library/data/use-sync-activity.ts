import type { SQLiteDatabase } from 'expo-sqlite';
import { useCallback } from 'react';

import { useSyncStore } from '@/stores/sync-store';
import { useTransferStore, type Transfer } from '@/stores/transfer-store';

import { database } from '../local/db';
import * as Collections from '../local/repository/collections';
import * as Groups from '../local/repository/groups';
import * as Documents from '../local/repository/documents';
import * as Shares from '../local/repository/shares';
import * as Marks from '../local/repository/marks';
import * as Queue from '../local/repository/queue';
import { useLocalQuery } from '../local/use-local-query';
import { useSyncNow } from '../sync/use-sync-engine';
import { useLibraryStatus } from './use-library-status';

/**
 * What is waiting to reach the account, in words.
 *
 * The queue stores an entity and a set of field names, which is the right shape
 * for sending and the wrong one for reading. This turns each row into the
 * sentence a reader would use for it — "where you are in Thinking, Fast and
 * Slow" rather than `document:update[currentPage]` — because a screen that
 * shows a person their own pending work owes them their own vocabulary.
 *
 * Titles are looked up per row rather than joined. A queue is tens of rows at
 * the very worst, they are all indexed reads, and the alternative is a
 * five-table join that would have to be edited every time an entity is added.
 */

export type ActivityKind =
  | 'position'
  | 'favourite'
  | 'title'
  | 'processing'
  | 'import'
  | 'delete'
  | 'bookmark'
  | 'note'
  | 'collection'
  | 'filing'
  | 'share'
  | 'group';

export type ActivityItem = {
  opId: string;
  kind: ActivityKind;
  /** What changed, named the way the reader named it. */
  title: string;
  /** The detail under it. Never a code, never an error the backend wrote. */
  detail: string;
  /** Why it stopped, on a dead letter. `null` on everything else. */
  reason: string | null;
};

export type SyncActivity = {
  phase: ReturnType<typeof useSyncStore.getState>['phase'];
  waiting: ActivityItem[];
  failed: ActivityItem[];
  moving: { documentId: string; title: string; transfer: Transfer }[];
  lastSyncedAt: number | null;
  syncNow: () => Promise<void>;
  retry: (opId: string | null) => Promise<void>;
  discard: (opId: string | null) => Promise<void>;
};

const TABLES = [
  'syncQueue',
  'documents',
  'bookmarks',
  'annotations',
  'collections',
  'shares',
  'groupsLocal',
] as const;

async function titleOf(db: SQLiteDatabase, documentId: string): Promise<string> {
  const document = await Documents.documentById(db, documentId);
  return document?.title ?? 'A document';
}

async function describe(
  db: SQLiteDatabase,
  operation: Queue.QueuedOperation,
): Promise<ActivityItem | null> {
  const base = { opId: operation.opId, reason: operation.lastError };

  switch (operation.entity) {
    case 'document': {
      const title = await titleOf(db, operation.entityId);

      if (operation.op === 'create') {
        return {
          ...base,
          kind: 'import',
          title,
          detail: 'Imported here. Your account has not met it yet.',
        };
      }
      if (operation.op === 'remove') {
        return { ...base, kind: 'delete', title, detail: 'Deleted here.' };
      }

      const changed = new Set(operation.fields);
      // The order is what a reader would notice first, not the order the
      // fields happen to be in.
      if (changed.has('currentPage') || changed.has('progress')) {
        const document = await Documents.documentById(db, operation.entityId);
        return {
          ...base,
          kind: 'position',
          title: `Where you are in ${title}`,
          detail:
            document === null
              ? 'Your reading position.'
              : `Page ${document.currentPage}. However many pages you turned, this is one change to send.`,
        };
      }
      if (changed.has('title') || changed.has('author')) {
        return { ...base, kind: 'title', title, detail: 'Renamed here.' };
      }
      if (changed.has('isFavorite')) {
        const document = await Documents.documentById(db, operation.entityId);
        return {
          ...base,
          kind: 'favourite',
          title,
          detail:
            document?.isFavorite === true ? 'Added to favourites.' : 'Removed from favourites.',
        };
      }
      return {
        ...base,
        kind: 'processing',
        title,
        detail: 'What this device made of it — its cover, its pages, its contents.',
      };
    }

    case 'bookmark': {
      const bookmark = await Marks.bookmarkRow(db, operation.entityId);
      if (bookmark === null) {
        return null;
      }
      const title = await titleOf(db, bookmark.documentId);
      return {
        ...base,
        kind: 'bookmark',
        title: `A bookmark in ${title}`,
        detail: operation.op === 'remove' ? `Page ${bookmark.page}, removed.` : `Page ${bookmark.page}.`,
      };
    }

    case 'annotation': {
      const annotation = await Marks.annotationById(db, operation.entityId);
      if (annotation === null) {
        return null;
      }
      const title = await titleOf(db, annotation.documentId);
      const what = annotation.kind === 'passage' ? 'A passage' : 'A note';
      return {
        ...base,
        kind: 'note',
        // Deliberately not the words themselves. They are the reader's, and a
        // list of pending work is not where somebody's private notes belong on
        // display — the same rule the logger holds to.
        title: `${what} in ${title}`,
        detail:
          operation.op === 'remove'
            ? `Page ${annotation.page}, removed.`
            : `Page ${annotation.page}.`,
      };
    }

    case 'collection': {
      const collection = await Collections.collectionRow(db, operation.entityId);
      const name = collection?.name ?? 'A collection';
      return {
        ...base,
        kind: 'collection',
        title: name,
        detail:
          operation.op === 'create'
            ? 'A new collection.'
            : operation.op === 'remove'
              ? 'Deleted here. The documents in it are untouched.'
              : 'Renamed here.',
      };
    }

    case 'membership': {
      const [collectionId, documentId] = operation.entityId.split(':');
      if (collectionId === undefined || documentId === undefined) {
        return null;
      }
      const collection = await Collections.collectionRow(db, collectionId);
      const title = await titleOf(db, documentId);
      const name = collection?.name ?? 'a collection';
      return {
        ...base,
        kind: 'filing',
        title,
        detail: operation.op === 'remove' ? `Taken out of ${name}.` : `Filed in ${name}.`,
      };
    }

    /**
     * A share waiting to go out.
     *
     * The detail names who it is for and says plainly that they have not been
     * told — a reader who shared something in a tunnel should be able to find
     * out here whether it actually went, rather than assuming it did.
     */
    case 'share': {
      const share = await Shares.shareById(db, operation.entityId);
      if (share === null) {
        return null;
      }
      const who = share.groupName ?? share.counterpartName ?? 'someone';
      const title = share.title ?? (await titleOf(db, share.documentId ?? ''));

      if (operation.op === 'create') {
        return {
          ...base,
          kind: 'share',
          title,
          detail: `To be shared with ${who}. They have not been told yet.`,
        };
      }
      if (operation.op === 'remove' || share.status === 'revoked') {
        return { ...base, kind: 'share', title, detail: `Access for ${who} to be removed.` };
      }
      if (share.direction === 'incoming') {
        return {
          ...base,
          kind: 'share',
          title,
          detail:
            share.status === 'accepted'
              ? `Accepted from ${who}. Not sent yet.`
              : `Declined from ${who}. Not sent yet.`,
        };
      }
      return { ...base, kind: 'share', title, detail: `What ${who} can do is to be changed.` };
    }

    case 'group': {
      const group = await Groups.groupById(db, operation.entityId);
      const name = group?.name ?? 'A group';
      return {
        ...base,
        kind: 'group',
        title: name,
        detail:
          operation.op === 'create'
            ? 'Made here. Your account has not met it yet.'
            : operation.op === 'remove'
              ? 'Deleted here.'
              : 'Renamed here.',
      };
    }
  }
}

export function useSyncActivity(): SyncActivity {
  const { profileId } = useLibraryStatus();
  const phase = useSyncStore((state) => state.phase);
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt);
  const active = useTransferStore((state) => state.active);
  const syncNow = useSyncNow();

  const read = useCallback(async (db: SQLiteDatabase) => {
    const rows = await Queue.claim(db, Number.MAX_SAFE_INTEGER, 200);
    const dead = await Queue.failedOperations(db);

    const waiting: ActivityItem[] = [];
    for (const row of rows) {
      const item = await describe(db, row);
      if (item !== null) {
        waiting.push(item);
      }
    }

    const failed: ActivityItem[] = [];
    for (const row of dead) {
      const item = await describe(db, row);
      if (item !== null) {
        failed.push(item);
      }
    }

    // Every title, so a transfer in progress can be named without this read
    // having to know what the transfer store currently holds — that is memory,
    // it changes several times a second, and it has no business keying a query.
    const titles = new Map(
      (
        await db.getAllAsync<{ id: string; title: string }>(
          'SELECT id, title FROM documents WHERE deletedAt IS NULL',
        )
      ).map((row) => [row.id, row.title]),
    );

    return { waiting, failed, titles };
  }, []);

  const { data } = useLocalQuery(profileId, TABLES, read);

  const retry = useCallback(
    async (opId: string | null) => {
      if (profileId === null) {
        return;
      }
      const db = await database(profileId);
      if (db !== null) {
        await Queue.retryFailed(db, opId);
      }
      await syncNow();
    },
    [profileId, syncNow],
  );

  const discard = useCallback(
    async (opId: string | null) => {
      if (profileId === null) {
        return;
      }
      const db = await database(profileId);
      if (db !== null) {
        await Queue.discardFailed(db, opId);
      }
    },
    [profileId],
  );

  return {
    phase,
    waiting: data?.waiting ?? [],
    failed: data?.failed ?? [],
    moving: [...active].map(([documentId, transfer]) => ({
      documentId,
      title: data?.titles.get(documentId) ?? 'A document',
      transfer,
    })),
    lastSyncedAt,
    syncNow,
    retry,
    discard,
  };
}
