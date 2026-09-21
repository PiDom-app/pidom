import { usePaginatedQuery } from 'convex/react';
import { api } from '@convex/api';
import type { LibraryDocument } from './types';

/** How many documents to pull per page of the full library. */
const PAGE_SIZE = 60;

export interface AllLibrary {
  documents: LibraryDocument[];
  status: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted';
  isLoading: boolean;
  loadMore: (n: number) => void;
  loadMoreDefault: () => void;
}

/**
 * The whole account library, paginated through the `snapshot` reconcile query
 * rather than an unbounded read. Backs both the full Library view (grid/list)
 * and the command search. The caller decides when to pull the next page — the
 * grid on scroll, the table on demand.
 */
export function useAllLibrary(): AllLibrary {
  const { results, status, isLoading, loadMore } = usePaginatedQuery(
    api.library.snapshot,
    {},
    { initialNumItems: PAGE_SIZE },
  );

  return {
    documents: results,
    status,
    isLoading,
    loadMore,
    loadMoreDefault: () => loadMore(PAGE_SIZE),
  };
}
