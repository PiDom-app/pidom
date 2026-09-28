import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { CollectionSummary, CollectionsSnapshot } from '../../../../shared/ipc';

/**
 * The renderer's live view of the local-first organization mirror.
 *
 * Main owns the SQLite mirror + outbox (`main/collections`): every collection
 * create/rename/remove, membership change, and favorite/finished toggle lands
 * there instantly and is replayed to the same owner-checked Convex functions on
 * reconnect. This context mirrors main's `collections.snapshot()` into React —
 * seeded once from `collections.list()` + `pending()`, then following the
 * coalesced `collections.onChange` push so an edit (local or drained) lands
 * without re-querying. It is the source of truth for the collection LIST and a
 * document's membership; document metadata (title, progress) stays Convex-read.
 *
 * `revision` bumps on every push so per-document membership reads
 * (`useDocumentCollections`) know to refetch without each keeping its own
 * subscription.
 */
export interface CollectionsMirror {
  /** Every collection this account holds, oldest first, with its live count. */
  collections: CollectionSummary[];
  /** Outbox rows still waiting to reach the server — drives the sync chip. */
  pending: number;
  /** True until the first snapshot resolves. */
  loading: boolean;
  /** Increments on every mirror push, so dependent reads can refetch. */
  revision: number;
}

const CollectionsMirrorContext = createContext<CollectionsMirror | null>(null);

export function CollectionsMirrorProvider({ children }: { children: ReactNode }) {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const apply = (snapshot: CollectionsSnapshot) => {
      setCollections(snapshot.collections);
      setPending(snapshot.pending);
      setRevision((r) => r + 1);
    };

    // Seed once from the two reads, then follow the full-snapshot push. Each push
    // replaces wholesale, so the view stays exactly in step with main and never
    // drifts on a dropped intermediate update.
    Promise.all([window.pidom.collections.list(), window.pidom.collections.pending()])
      .then(([list, count]) => {
        if (cancelled) return;
        setCollections(list);
        setPending(count);
        setLoading(false);
        setRevision((r) => r + 1);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('collections.list failed', error);
        setLoading(false);
      });

    const unsubscribe = window.pidom.collections.onChange((snapshot) => {
      apply(snapshot);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return createElement(
    CollectionsMirrorContext.Provider,
    { value: { collections, pending, loading, revision } },
    children,
  );
}

export function useCollectionsMirror(): CollectionsMirror {
  const ctx = useContext(CollectionsMirrorContext);
  if (!ctx) throw new Error('useCollectionsMirror must be used within CollectionsMirrorProvider');
  return ctx;
}

/**
 * The ids of the collections a document belongs to — the picker's checkmarks,
 * read from the local mirror. Refetches whenever the mirror revision bumps (a
 * membership change here or drained from another device), so the checkmarks
 * follow local writes at once without a Convex round trip.
 */
export function useDocumentCollections(documentId: string): string[] {
  const { revision } = useCollectionsMirror();
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.pidom.collections
      .forDocument(documentId)
      .then((next) => {
        if (!cancelled) setIds(next);
      })
      .catch((error) => {
        if (!cancelled) console.error('collections.forDocument failed', error);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, revision]);

  return ids;
}
