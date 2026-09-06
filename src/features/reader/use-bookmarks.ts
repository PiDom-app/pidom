import { useMutation, useQuery } from 'convex/react';
import { useCallback, useMemo } from 'react';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { log } from '@/lib/logger';

import { messageOf } from '../library/data/errors';

const SCOPE = 'reader-bookmarks';

export type Bookmark = { id: string; page: number; label: string | null; createdAt: number };

/**
 * The pages marked in the open document.
 *
 * Subscribed for as long as the reader is open rather than only while the sheet
 * is, because the chrome's toggle has to know whether *this* page is marked on
 * every page turn — and the list is at most `BOOKMARKS_PER_DOCUMENT` rows of
 * three small fields.
 *
 * `toggle` is idempotent on the server in both directions: adding a marked page
 * renames it rather than duplicating, and removing an unmarked one is silent.
 * So a double tap costs a wasted mutation and never a wrong list.
 */
export function useBookmarks({
  documentId,
  ready,
}: {
  documentId: Id<'documents'> | undefined;
  ready: boolean;
}) {
  const showToast = useAppToast();
  const rows = useQuery(
    api.library.bookmarks,
    ready && documentId !== undefined ? { documentId } : 'skip',
  );
  const add = useMutation(api.library.addBookmark);
  const remove = useMutation(api.library.removeBookmark);
  const setLabel = useMutation(api.library.renameBookmark);

  const bookmarks = useMemo<readonly Bookmark[]>(
    () =>
      ((rows ?? []) as Bookmark[])
        .map((row) => ({ ...row }))
        // Page order, which is reading order. They are stored in the order they
        // were made, which is the order somebody wandered through the book.
        .sort((a, b) => a.page - b.page),
    [rows],
  );

  const marked = useCallback(
    (page: number) => bookmarks.some((row) => row.page === page),
    [bookmarks],
  );

  const toggle = useCallback(
    (page: number) => {
      if (documentId === undefined) {
        return;
      }
      const on = bookmarks.some((row) => row.page === page);
      const run = on
        ? remove({ documentId, currentPage: page })
        : add({ documentId, currentPage: page });
      run.catch((error: unknown) => {
        log.debug(SCOPE, 'could not change a bookmark', error);
        showToast({
          id: 'bookmark',
          tone: 'error',
          title: on ? "Couldn't remove that bookmark" : "Couldn't add that bookmark",
          description: messageOf(error, 'Try again in a moment.'),
        });
      });
    },
    [documentId, bookmarks, add, remove, showToast],
  );

  /**
   * Names a marked page, or clears the name it has.
   *
   * `label` has been in the schema and honoured by `addBookmark` since bookmarks
   * landed, and nothing ever sent one — the toolbar's control is a toggle, which
   * has no name to give — so every row read `Page 142` however deliberately
   * somebody had stopped there. This is what the list's long press calls.
   *
   * Resolves `false` rather than throwing, because the dialog decides whether to
   * close on the answer.
   */
  const rename = useCallback(
    async (page: number, label: string): Promise<boolean> => {
      if (documentId === undefined) {
        return false;
      }
      try {
        await setLabel({ documentId, currentPage: page, label });
        return true;
      } catch (error: unknown) {
        log.debug(SCOPE, 'could not name that bookmark', error);
        showToast({
          id: 'bookmark',
          tone: 'error',
          title: "Couldn't name that bookmark",
          description: messageOf(error, 'Try again in a moment.'),
        });
        return false;
      }
    },
    [documentId, setLabel, showToast],
  );

  return { bookmarks, marked, toggle, rename };
}
