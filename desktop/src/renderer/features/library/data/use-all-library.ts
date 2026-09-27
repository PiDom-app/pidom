import { useMemo } from 'react';
import { usePaginatedQuery } from 'convex/react';
import { api } from '@convex/api';
import { useImports } from '@/features/import/data/use-imports';
import { pseudoDocument, type LibraryEntry } from '@/features/import/data/pseudo-document';

/** How many documents to pull per page of the full library. */
const PAGE_SIZE = 60;

export interface AllLibrary {
  documents: LibraryEntry[];
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
 *
 * Local-only imports — files staged on this device whose cloud registration is
 * still pending — are unioned in as pseudo-documents keyed by their `localId`,
 * so a just-imported PDF is visible and readable immediately. Once an import
 * reconciles it carries a Convex id, drops out of the local-only list, and the
 * real document arrives through `snapshot`; de-duplicating by id keeps a
 * reconciling document from flashing twice.
 */
export function useAllLibrary(): AllLibrary {
  const { results, status, isLoading, loadMore } = usePaginatedQuery(
    api.library.snapshot,
    {},
    { initialNumItems: PAGE_SIZE },
  );
  const { jobs } = useImports();

  const documents = useMemo<LibraryEntry[]>(() => {
    const synced = results as LibraryEntry[];
    // Only jobs still without a Convex id are local-only; a reconciled job's
    // real document is already in `results`.
    const localOnly = jobs.filter((job) => job.documentId === null);
    if (localOnly.length === 0) return synced;

    const seen = new Set(synced.map((doc) => doc.id as string));
    const extras = localOnly
      .filter((job) => !seen.has(job.localId))
      .map((job) => pseudoDocument(job));
    // Newest imports first, ahead of the synced page.
    return [...extras, ...synced];
  }, [results, jobs]);

  return {
    documents,
    status,
    isLoading,
    loadMore,
    loadMoreDefault: () => loadMore(PAGE_SIZE),
  };
}
