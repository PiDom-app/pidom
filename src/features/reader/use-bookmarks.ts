import type { SQLiteDatabase } from 'expo-sqlite';
import { useCallback } from 'react';

import { useAppToast } from '@/components/feedback/use-app-toast';
import { log } from '@/lib/logger';

import { useLibraryStatus } from '../library/data/use-library-status';
import { database } from '../library/local/db';
import * as Marks from '../library/local/repository/marks';
import * as Queue from '../library/local/repository/queue';
import { useLocalQuery } from '../library/local/use-local-query';

const SCOPE = 'reader-bookmarks';

export type Bookmark = { id: string; page: number; label: string | null; createdAt: number };

const TABLES = ['bookmarks'] as const;

/**
 * The pages marked in the open document.
 *
 * Read from this device rather than subscribed from the account, which is what
 * makes marking a page in a tunnel work at all — and what makes the toolbar's
 * filled-or-not icon correct on every page turn without a round trip.
 *
 * **The id of a bookmark is its page**, derived rather than minted, so the same
 * page marked twice is one row here and one row there. That is what makes both
 * directions safe to send again: adding a marked page renames it rather than
 * duplicating, and removing an unmarked one is silent. A double tap costs
 * nothing and can never produce a list with duplicates in it.
 */
export function useBookmarks({ documentId }: { documentId: string | undefined }) {
  const showToast = useAppToast();
  const { profileId } = useLibraryStatus();

  const read = useCallback(
    async (db: SQLiteDatabase): Promise<Bookmark[]> =>
      documentId === undefined ? [] : await Marks.bookmarksOf(db, documentId),
    [documentId],
  );

  const { data } = useLocalQuery(profileId, TABLES, read);
  // Page order, which is reading order. They are stored in the order they were
  // made, which is the order somebody wandered through the book.
  const bookmarks: readonly Bookmark[] = data ?? [];

  const marked = useCallback(
    (page: number) => bookmarks.some((row) => row.page === page),
    [bookmarks],
  );

  const toggle = useCallback(
    (page: number) => {
      if (documentId === undefined || profileId === null) {
        return;
      }
      const on = bookmarks.some((row) => row.page === page);

      void (async () => {
        try {
          const db = await database(profileId);
          if (db === null) {
            return;
          }
          if (on) {
            await Marks.removeBookmark(db, documentId, page);
            const outcome = await Queue.enqueue(
              db,
              'bookmark',
              Marks.idOfBookmark(documentId, page),
              'remove',
            );
            if (outcome === 'annihilated') {
              await Marks.purgeMarks(db, [Marks.idOfBookmark(documentId, page)]);
            }
          } else {
            const id = await Marks.addBookmark(db, documentId, page, null);
            await Queue.enqueue(db, 'bookmark', id, 'create');
          }
        } catch (error) {
          log.debug(SCOPE, 'could not change a bookmark', error);
          showToast({
            id: 'bookmark',
            tone: 'error',
            title: on ? "Couldn't remove that bookmark" : "Couldn't add that bookmark",
            description: 'Something went wrong on this device. Try again.',
          });
        }
      })();
    },
    [documentId, profileId, bookmarks, showToast],
  );

  /**
   * Names a marked page, or clears the name it has.
   *
   * `label` had been in the schema and honoured by the account since bookmarks
   * landed, and nothing ever sent one — the toolbar's control is a toggle,
   * which has no name to give — so every row read `Page 142` however
   * deliberately somebody had stopped there. This is what the list's long press
   * calls.
   *
   * Resolves `false` rather than throwing, because the dialog decides whether
   * to close on the answer.
   */
  const rename = useCallback(
    async (page: number, label: string): Promise<boolean> => {
      if (documentId === undefined || profileId === null) {
        return false;
      }
      try {
        const db = await database(profileId);
        if (db === null) {
          return false;
        }
        const id = await Marks.addBookmark(
          db,
          documentId,
          page,
          label.trim() === '' ? null : label,
        );
        await Queue.enqueue(db, 'bookmark', id, 'create');
        return true;
      } catch (error: unknown) {
        log.debug(SCOPE, 'could not name that bookmark', error);
        showToast({
          id: 'bookmark',
          tone: 'error',
          title: "Couldn't name that bookmark",
          description: 'Something went wrong on this device. Try again.',
        });
        return false;
      }
    },
    [documentId, profileId, showToast],
  );

  return { bookmarks, marked, toggle, rename };
}
