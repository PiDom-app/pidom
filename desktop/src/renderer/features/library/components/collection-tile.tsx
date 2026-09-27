import { useCoverUrl } from '../data/use-cover-url';
import type { Id } from '@convex/dataModel';
import type { LibraryCollection } from '../data/types';

/** One cell of the mosaic — a single cover, or a neutral surface when absent. */
function CoverCell({ documentId }: { documentId: Id<'documents'> }) {
  const url = useCoverUrl(documentId);
  return (
    <div className="overflow-hidden bg-sunken">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : null}
    </div>
  );
}

/**
 * A collection as a tile: a mosaic of up to four covers, the name, and the count.
 * The mosaic is the anchor; the rest is a line of text beneath it.
 */
export function CollectionTile({ collection }: { collection: LibraryCollection }) {
  const covers = collection.coverDocumentIds.slice(0, 4);

  return (
    <div className="flex w-full flex-col gap-2 text-left">
      <div className="grid aspect-[3/4] grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-md border border-border bg-sunken">
        {covers.length === 0 ? null : covers.map((id) => <CoverCell key={id} documentId={id} />)}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground" title={collection.name}>
          {collection.name}
        </p>
        <p className="mt-0.5 text-xs text-fg-muted">
          {collection.documentCount} {collection.documentCount === 1 ? 'document' : 'documents'}
        </p>
      </div>
    </div>
  );
}
