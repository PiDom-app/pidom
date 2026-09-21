import { useQuery } from 'convex/react';
import { FolderClosed } from 'lucide-react';
import { api } from '@convex/api';
import { PageHeader } from '@/components/shell/page-header';
import { CollectionTile } from '../components/collection-tile';

/**
 * Every collection the account owns. Collections group documents the reader made
 * themselves; this lists them as cover-mosaic tiles. Opening a collection to its
 * documents arrives with the reader.
 */
export function CollectionsScreen() {
  const collections = useQuery(api.collections.list, {});

  return (
    <div className="mx-auto h-full max-w-6xl overflow-auto px-8 py-8">
      <PageHeader title="Collections" subtitle="Documents you've grouped together." />

      {collections === undefined ? (
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
            Group documents into collections from any document's menu, and they'll show up here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {collections.map((collection) => (
            <CollectionTile key={collection.id} collection={collection} />
          ))}
        </div>
      )}
    </div>
  );
}
