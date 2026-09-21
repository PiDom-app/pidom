import { useCallback, useMemo } from 'react';
import { useMutation, usePaginatedQuery } from 'convex/react';
import { toast } from 'sonner';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';

export interface Bookmark {
  page: number;
  label: string | null;
}

/**
 * This document's bookmarks, and the toggles the reader drives them with.
 *
 * The account exposes bookmarks across every document in one paginated read
 * (the same one the mobile sync engine drains), so this filters to the open
 * document rather than asking the backend for a per-document slice that does not
 * exist. A reader marks tens of pages in a book, not thousands, so one page of a
 * few hundred rows covers it; the list stays a reactive query, so a bookmark
 * made in the sidebar and one made from the toolbar are the same source.
 */
export function useBookmarks(documentId: Id<'documents'>): {
  bookmarks: Bookmark[];
  isBookmarked: (page: number) => boolean;
  toggle: (page: number, bookmarked: boolean) => void;
  rename: (page: number, label: string) => void;
} {
  const { results } = usePaginatedQuery(api.library.allBookmarks, {}, { initialNumItems: 400 });
  const add = useMutation(api.library.addBookmark);
  const remove = useMutation(api.library.removeBookmark);
  const renameBookmark = useMutation(api.library.renameBookmark);

  const bookmarks = useMemo<Bookmark[]>(
    () =>
      results
        .filter((b) => b.documentId === documentId)
        .map((b) => ({ page: b.page, label: b.label }))
        .sort((a, b) => a.page - b.page),
    [results, documentId],
  );

  const marked = useMemo(() => new Set(bookmarks.map((b) => b.page)), [bookmarks]);
  const isBookmarked = useCallback((page: number) => marked.has(page), [marked]);

  const toggle = useCallback(
    (page: number, bookmarked: boolean) => {
      const call = bookmarked
        ? remove({ documentId, currentPage: page })
        : add({ documentId, currentPage: page });
      void call.catch(() => toast.error("Couldn't update this bookmark"));
    },
    [add, remove, documentId],
  );

  const rename = useCallback(
    (page: number, label: string) => {
      void renameBookmark({
        documentId,
        currentPage: page,
        label: label.trim(),
        clientUpdatedAt: Date.now(),
      }).catch(() => toast.error("Couldn't rename this bookmark"));
    },
    [renameBookmark, documentId],
  );

  return { bookmarks, isBookmarked, toggle, rename };
}
