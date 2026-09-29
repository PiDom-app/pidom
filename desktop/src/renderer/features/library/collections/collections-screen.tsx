import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { FolderClosed, Plus } from 'lucide-react';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';
import { PageHeader } from '@/components/shell/page-header';
import { buttonPrimaryClass } from '@/lib/ui';
import { useDocumentActions } from '../data/use-document-actions';
import { useCollectionsMirror } from '../data/use-collections-mirror';
import { CollectionTile } from '../components/collection-tile';
import { CollectionNameDialog } from '../components/collection-name-dialog';
import { SyncStatusChip } from '../components/sync-status-chip';

/**
 * Every collection the account owns. Collections group documents the reader made
 * themselves; this lists them as cover-mosaic tiles. Opening a collection to its
 * documents arrives with the reader.
 *
 * The list itself — which collections exist, their names and counts — comes from
 * the offline-first local mirror, so a collection created or renamed offline
 * shows here at once. The cover mosaics are document metadata, so they are read
 * from Convex opportunistically and keyed onto each tile by id; a collection with
 * no known covers (freshly created, or still offline) renders the neutral empty
 * mosaic until they arrive.
 */
export function CollectionsScreen() {
  const { collections, loading } = useCollectionsMirror();
  const covers = useQuery(api.collections.list, {});
  const { createCollection } = useDocumentActions();
  const [creating, setCreating] = useState(false);

  const coversById = useMemo(() => {
    const map = new Map<string, Id<'documents'>[]>();
    for (const c of covers ?? []) map.set(c.id, c.coverDocumentIds);
    return map;
  }, [covers]);

  return (
    <div className="mx-auto h-full max-w-6xl overflow-auto px-8 py-8">
      <PageHeader title="Collections" subtitle="Documents you've grouped together.">
        <SyncStatusChip />
        <button className={buttonPrimaryClass} onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New collection
        </button>
      </PageHeader>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] rounded-md bg-sunken" />
          ))}
        </div>
      ) : collections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="flex size-12 items-center justify-center rounded-md bg-sunken text-fg-subtle">
            <FolderClosed className="size-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-foreground">No collections yet</h2>
          <p className="mt-1 max-w-sm text-sm text-fg-muted">
            Group documents into collections from any document's menu, or start one here.
          </p>
          <button className={`${buttonPrimaryClass} mt-4`} onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New collection
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {collections.map((collection) => (
            <CollectionTile
              key={collection.id}
              collection={collection}
              coverDocumentIds={coversById.get(collection.id)}
            />
          ))}
        </div>
      )}

      <CollectionNameDialog
        open={creating}
        title="New collection"
        submitLabel="Create"
        initialValue=""
        onOpenChange={setCreating}
        onSubmit={(name) => void createCollection(name)}
      />
    </div>
  );
}
