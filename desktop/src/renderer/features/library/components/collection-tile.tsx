import { Link, useNavigate } from '@tanstack/react-router';
import { useCoverUrl } from '../data/use-cover-url';
import { CollectionContextMenu } from './collection-actions';
import type { Id } from '@convex/dataModel';

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
 * The mosaic is the anchor; the rest is a line of text beneath it. The whole
 * tile is a link into the collection's documents, and right-click opens its
 * actions (Open / Rename / Delete).
 *
 * The identity and count come from whatever list drives the tile — the Convex
 * home data on the home rail, or the offline-first local mirror on the
 * collections index. Covers are document metadata, so they arrive separately as
 * `coverDocumentIds`; a collection created offline (or with no members) simply
 * renders the neutral empty mosaic until its covers are known.
 */
export function CollectionTile({
  collection,
  coverDocumentIds = [],
}: {
  collection: { id: string; name: string; documentCount: number };
  coverDocumentIds?: Id<'documents'>[];
}) {
  const covers = coverDocumentIds.slice(0, 4);
  const navigate = useNavigate();

  // The tile is a link, so a single click opens it. A double-click — the desktop
  // reflex for a folder — opens it too; navigating to the route it is already
  // heading to is idempotent, so both gestures land on the same screen.
  const open = () =>
    void navigate({ to: '/collections/$collectionId', params: { collectionId: collection.id } });

  return (
    <CollectionContextMenu collection={collection}>
      <Link
        to="/collections/$collectionId"
        params={{ collectionId: collection.id }}
        onDoubleClick={open}
        className="group flex w-full flex-col gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <div className="grid aspect-[3/4] grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-md border border-border bg-sunken transition-colors group-hover:border-border-strong">
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
      </Link>
    </CollectionContextMenu>
  );
}
