import { usePaginatedQuery } from 'convex/react';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';
import type { LibraryEntry } from '@/features/import/data/pseudo-document';
import { isLocalCollectionId } from './collection-id';

/** How many documents to pull per page of a collection. */
const PAGE_SIZE = 60;

/** No documents to page through — a local collection has none the server can
 *  serve until its create syncs. A stable identity keeps effect deps quiet. */
const NOOP = () => {};

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
 *
 * A collection created offline still wears a `col_<hex>` placeholder id until
 * its create syncs; that is not a Convex id, so `collections.documents`
 * (arg-validated `v.id('collections')`) would reject it and the query would
 * throw — which, with no route-level boundary, took down the whole window. The
 * query is skipped until the id is real; the outbox re-keys the placeholder to
 * the Convex id within a drain, after which this runs like any other collection.
 */
export function useCollection(collectionId: string): CollectionDocuments {
  const isLocal = isLocalCollectionId(collectionId);
  const { results, status, isLoading, loadMore } = usePaginatedQuery(
    api.collections.documents,
    isLocal ? 'skip' : { collectionId: collectionId as Id<'collections'> },
    { initialNumItems: PAGE_SIZE },
  );

  if (isLocal) {
    return { documents: [], status: 'Exhausted', isLoading: false, loadMore: NOOP, loadMoreDefault: NOOP };
  }

  return {
    documents: results as LibraryEntry[],
    status,
    isLoading,
    loadMore,
    loadMoreDefault: () => loadMore(PAGE_SIZE),
  };
}
