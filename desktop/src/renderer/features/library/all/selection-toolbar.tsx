import { BookOpenCheck, FolderPlus, RotateCcw, Star, StarOff, X } from 'lucide-react';
import { useDocumentActions } from '../data/use-document-actions';
import { BulkAddToCollectionPopover } from '../components/bulk-add-to-collection-popover';
import { cn } from '@/lib/utils';
import type { LibraryEntry } from '@/features/import/data/pseudo-document';

/** A quiet icon+label action in the selection row. Boldness is spent on the
 *  count and the selected fills, not here. */
const barButtonClass =
  'inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-hover';

/**
 * The multi-select toolbar — the library controls row transformed into bulk
 * actions while a selection is live. A flat flex row in the page flow, not a
 * floating card: the count leads in the primary colour, then the actions, a
 * hairline, and Clear.
 *
 * Favorite and Finished are state-aware: when every selected document already
 * has the state the button offers to remove it, so a mixed selection resolves
 * one way (adds) and a uniform one toggles. These are definitive one-shot
 * actions, so they clear the selection on success. "Add to collection" opens an
 * anchored picker that stays open for several collections, so it does not clear.
 */
export function SelectionToolbar({
  count,
  selectedDocuments,
  onClear,
}: {
  count: number;
  selectedDocuments: LibraryEntry[];
  onClear: () => void;
}) {
  const { favoriteMany, setFinishedMany } = useDocumentActions();
  const ids = selectedDocuments.map((d) => d.id);

  // Uniform state → the button removes it; anything mixed → the button adds it.
  const allFavorite = selectedDocuments.length > 0 && selectedDocuments.every((d) => d.isFavorite);
  const allFinished = selectedDocuments.length > 0 && selectedDocuments.every((d) => d.isFinished);

  const onFavorite = async () => {
    if (await favoriteMany(ids, !allFavorite)) onClear();
  };
  const onFinished = async () => {
    if (await setFinishedMany(ids, !allFinished)) onClear();
  };

  return (
    <div className="mb-5 flex flex-wrap items-center gap-1">
      <span className="mr-1 text-sm font-medium text-primary tabular-nums">{count} selected</span>

      <BulkAddToCollectionPopover documentIds={ids} triggerClassName={barButtonClass}>
        <FolderPlus className="size-4 text-fg-muted" />
        Add to collection
      </BulkAddToCollectionPopover>

      <button type="button" onClick={() => void onFavorite()} className={barButtonClass}>
        {allFavorite ? <StarOff className="size-4" /> : <Star className="size-4" />}
        {allFavorite ? 'Remove favorite' : 'Favorite'}
      </button>

      <button type="button" onClick={() => void onFinished()} className={barButtonClass}>
        {allFinished ? <RotateCcw className="size-4" /> : <BookOpenCheck className="size-4" />}
        {allFinished ? 'Mark unread' : 'Mark finished'}
      </button>

      <span className="mx-1 h-5 w-px bg-hairline" aria-hidden />

      <button
        type="button"
        onClick={onClear}
        className={cn(barButtonClass, 'text-fg-muted')}
      >
        <X className="size-4" />
        Clear
      </button>
    </div>
  );
}
