import { usePaginatedQuery } from 'convex/react';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';
import type { LibraryEntry } from '@/features/import/data/pseudo-document';

/** How many documents to pull per page of a collection. */
const PAGE_SIZE = 60;

export interface CollectionDocuments {
  documents: LibraryEntry[];
  status: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted';
  isLoading: boolean;
  loadMore: (n: number) => void;
  loadMoreDefault: () => void;
}

/**
 * The documents inside one collection, paginated through `collections.documents`
 * — the same reconcile-style read the full library uses (`use-all-library.ts`),
 * so the detail screen feeds the very same grid and list. The caller pulls the
 * next page on scroll.
 *
 * Unlike the full library there are no local-only pseudo-documents to union in:
 * a document has to exist in the account to be a member of a collection, so a
 * still-importing local file is never here.
 */
export function useCollection(collectionId: Id<'collections'>): CollectionDocuments {
  const { results, status, isLoading, loadMore } = usePaginatedQuery(
    api.collections.documents,
    { collectionId },
    { initialNumItems: PAGE_SIZE },
  );

  return {
    documents: results as LibraryEntry[],
    status,
    isLoading,
    loadMore,
    loadMoreDefault: () => loadMore(PAGE_SIZE),
  };
}
