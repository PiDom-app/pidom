import { useCallback } from 'react';

import { log } from '@/lib/logger';

import { database } from '../local/db';
import * as Collections from '../local/repository/collections';
import * as Queue from '../local/repository/queue';
import { useLibraryStatus } from './use-library-status';

const SCOPE = 'collection-actions';

/**
 * Making, naming and filling collections.
 *
 * Local first, like every other write. A collection is the cheapest thing in
 * the app to create and the one most likely to be created in a moment of
 * tidying — on a train, in a queue — so having it fail for want of a connection
 * was always the wrong answer.
 *
 * **Membership is a set operation**, here and at the account: adding a document
 * twice adds it once, and removing one that is not in the collection is silent.
 * That is what makes both safe to send again, which a queue that retries needs
 * them to be.
 */
export function useCollectionActions() {
  const { profileId } = useLibraryStatus();

  const withDb = useCallback(
    async (work: (db: Awaited<ReturnType<typeof database>>) => Promise<void>): Promise<boolean> => {
      if (profileId === null) {
        return false;
      }
      try {
        const db = await database(profileId);
        if (db === null) {
          return false;
        }
        await work(db);
        return true;
      } catch (error) {
        log.debug(SCOPE, 'a local collection write failed', error);
        return false;
      }
    },
    [profileId],
  );

  const create = useCallback(
    async (name: string): Promise<string | null> => {
      if (profileId === null) {
        return null;
      }
      try {
        const db = await database(profileId);
        if (db === null) {
          return null;
        }
        const id = await Collections.createCollection(db, name);
        await Queue.enqueue(db, 'collection', id, 'create');
        return id;
      } catch (error) {
        log.debug(SCOPE, 'could not create a collection', error);
        return null;
      }
    },
    [profileId],
  );

  const renameCollection = useCallback(
    async (collectionId: string, name: string): Promise<boolean> =>
      await withDb(async (db) => {
        if (db === null) {
          return;
        }
        await Collections.renameCollection(db, collectionId, name);
        await Queue.enqueue(db, 'collection', collectionId, 'update', ['name']);
      }),
    [withDb],
  );

  /**
   * Deletes the collection and its memberships. **The documents survive.**
   *
   * The membership rows are dropped outright rather than queued: the account
   * cascades its own when the delete lands, so sending them would be work that
   * cascade is about to undo — and each one would come back from a collection
   * that is no longer there.
   */
  const removeCollection = useCallback(
    async (collectionId: string): Promise<boolean> =>
      await withDb(async (db) => {
        if (db === null) {
          return;
        }
        await Collections.removeCollection(db, collectionId);
        const outcome = await Queue.enqueue(db, 'collection', collectionId, 'remove');
        if (outcome === 'annihilated') {
          await Collections.purgeCollection(db, collectionId);
        }
      }),
    [withDb],
  );

  const addDocument = useCallback(
    async (collectionId: string, documentId: string): Promise<boolean> =>
      await withDb(async (db) => {
        if (db === null) {
          return;
        }
        await Collections.addToCollection(db, collectionId, documentId);
        await Queue.enqueue(db, 'membership', `${collectionId}:${documentId}`, 'create');
      }),
    [withDb],
  );

  const removeDocument = useCallback(
    async (collectionId: string, documentId: string): Promise<boolean> =>
      await withDb(async (db) => {
        if (db === null) {
          return;
        }
        await Collections.removeFromCollection(db, collectionId, documentId);
        const outcome = await Queue.enqueue(
          db,
          'membership',
          `${collectionId}:${documentId}`,
          'remove',
        );
        if (outcome === 'annihilated') {
          await Collections.purgeMembership(db, `${collectionId}:${documentId}`);
        }
      }),
    [withDb],
  );

  return { create, renameCollection, removeCollection, addDocument, removeDocument };
}
