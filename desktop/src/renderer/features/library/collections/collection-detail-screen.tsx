import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { FolderClosed, RefreshCw } from 'lucide-react';
import type { Id } from '@convex/dataModel';
import { PageHeader } from '@/components/shell/page-header';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { useDesktopSettings, desktopSettings } from '@/features/settings/use-desktop-settings';
import { useCollection } from '../data/use-collection';
import { isLocalCollectionId } from '../data/collection-id';
import { useCollectionsMirror } from '../data/use-collections-mirror';
import { LibraryGrid } from '../all/library-grid';
import { LibraryTable } from '../all/library-table';
import { LibraryToolbar } from '../all/library-toolbar';
import { CollectionMenu } from '../components/collection-actions';

/**
 * One collection's documents, rendered through the same grid and list as the
 * full library — a collection is a view over documents, not a different kind of
 * thing. The name comes from the cached `collections.list`; the documents are
 * paginated through `collections.documents`. Removing a document from the
 * collection is offered on each tile (see the `collectionContext` prop threaded
 * to the grid and list).
 */
export function CollectionDetailScreen({ collectionId }: { collectionId: string }) {
  const settings = useDesktopSettings();
  const view = settings.libraryView;
  const navigate = useNavigate();

  const { collections } = useCollectionsMirror();
  const collection = collections.find((c) => c.id === collectionId);
  const { documents, status, loadMoreDefault } = useCollection(collectionId);

  // A collection created offline wears a `col_<hex>` id until its create syncs;
  // its documents can't be read from the account until then. Show that honestly
  // rather than "Nothing here yet" — the outbox re-keys it to the Convex id
  // within a drain, after which the list loads.
  const syncing = isLocalCollectionId(collectionId) || collection?.isSynced === false;

  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((d) =>
      `${d.title} ${d.author ?? ''}`.toLowerCase().includes(q),
    );
  }, [documents, query]);

  const onNearEnd = () => {
    if (status === 'CanLoadMore') loadMoreDefault();
  };

  const firstLoad = status === 'LoadingFirstPage';
  const name = collection?.name ?? 'Collection';
  const collectionContext = { id: collectionId as Id<'collections'>, name };

  return (
    <div className="flex h-full flex-col px-8 py-8">
      <Breadcrumbs
        className="mb-4"
        items={[{ label: 'Collections', to: '/collections' }, { label: name }]}
      />

      <PageHeader
        title={name}
        subtitle={
          collection
            ? `${collection.documentCount} ${collection.documentCount === 1 ? 'document' : 'documents'}`
            : undefined
        }
      >
        {collection && (
          <CollectionMenu
            collection={{ id: collectionId, name }}
            onDeleted={() => void navigate({ to: '/collections' })}
          />
        )}
      </PageHeader>

      <LibraryToolbar
        view={view}
        onViewChange={desktopSettings.setLibraryView}
        filter="all"
        query={query}
        onQueryChange={setQuery}
        count={filtered.length}
      />

      <div className="min-h-0 flex-1">
        {firstLoad ? (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] rounded-md bg-sunken" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          query ? (
            <p className="py-16 text-center text-sm text-fg-muted">No documents match.</p>
          ) : syncing ? (
            <SyncingCollection />
          ) : (
            <EmptyCollection />
          )
        ) : view === 'grid' ? (
          <LibraryGrid documents={filtered} onNearEnd={onNearEnd} collectionContext={collectionContext} />
        ) : (
          <LibraryTable
            documents={filtered}
            globalFilter=""
            onNearEnd={onNearEnd}
            collectionContext={collectionContext}
          />
        )}
      </div>
    </div>
  );
}

/** Shown for a collection that exists only offline so far — its documents live
 *  on the account and appear once the create syncs. */
function SyncingCollection() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex size-12 items-center justify-center rounded-md bg-sunken text-fg-subtle">
        <RefreshCw className="size-6" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-foreground">Syncing…</h2>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">
        This collection was created offline. Its documents appear here once it syncs to your
        account.
      </p>
    </div>
  );
}

/** Shown when a collection has no documents yet. */
function EmptyCollection() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex size-12 items-center justify-center rounded-md bg-sunken text-fg-subtle">
        <FolderClosed className="size-6" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-foreground">Nothing here yet</h2>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">
        Add documents to this collection from any document's menu.
      </p>
    </div>
  );
}
