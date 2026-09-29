import { useMemo, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Check, FolderClosed, FolderPlus, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDocumentActions } from '../data/use-document-actions';
import { useCollectionsMirror, useDocumentCollections } from '../data/use-collections-mirror';
import type { LibraryDocument } from '../data/types';

/**
 * The add-to-collection picker.
 *
 * A modal dialog rather than a Radix Popover, and deliberately: it is opened
 * from the document menus via `deferOpen`, one tick after the menu closes, when
 * there is no longer a trigger for a popover to anchor to. A centred dialog
 * needs no anchor and follows the same `deferOpen`-then-dialog idiom the rename
 * and remove flows already use.
 *
 * Not a giant list: a search field filters as you type, each row carries its
 * document count and a check when the document is already in it, clicking a row
 * toggles membership, and when the search matches no collection an inline
 * "Create" row makes one and adds the document in a single step. Checkmarks come
 * from `collections.forDocument` and toggle optimistically (see
 * `use-document-actions.ts`).
 */
export function AddToCollectionDialog({
  document,
  open,
  onOpenChange,
}: {
  document: LibraryDocument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { addDocumentToCollection, removeDocumentFromCollection, createCollection } =
    useDocumentActions();
  const { collections, loading } = useCollectionsMirror();
  const memberIds = useDocumentCollections(document.id);
  const [query, setQuery] = useState('');

  const member = useMemo(() => new Set(memberIds), [memberIds]);
  const trimmed = query.trim();
  const filtered = useMemo(() => {
    if (loading) return undefined;
    const q = trimmed.toLowerCase();
    return q ? collections.filter((c) => c.name.toLowerCase().includes(q)) : collections;
  }, [collections, loading, trimmed]);

  // Offer to create only when the typed name matches nothing exactly.
  const exactExists = collections.some(
    (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
  );
  const canCreate = trimmed.length > 0 && !exactExists;

  const toggle = (collectionId: string, name: string) => {
    if (member.has(collectionId)) {
      void removeDocumentFromCollection(collectionId, document.id, name);
    } else {
      void addDocumentToCollection(collectionId, document.id, name);
    }
  };

  const create = async () => {
    const id = await createCollection(trimmed);
    if (id) {
      await addDocumentToCollection(id, document.id, trimmed);
      setQuery('');
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-50 bg-overlay/50" />
        <Dialog.Content className="animate-slide-up fixed top-1/2 left-1/2 z-50 flex max-h-[28rem] w-[24rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-md border border-border bg-elevated p-4 shadow-lg outline-none">
          <Dialog.Title className="text-sm font-semibold text-foreground">
            Add to collection
          </Dialog.Title>
          <Dialog.Description className="mt-0.5 truncate text-xs text-fg-muted" title={document.title}>
            {document.title}
          </Dialog.Description>

          <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-sunken px-3 focus-within:border-border-strong focus-within:ring-2 focus-within:ring-focus">
            <Search className="size-4 text-fg-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find or create a collection"
              className="w-full bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-fg-subtle"
              aria-label="Find or create a collection"
            />
          </div>

          <div className="mt-2 min-h-0 flex-1 overflow-auto">
            {filtered === undefined ? (
              <div className="px-2 py-6 text-center text-sm text-fg-subtle">Loading…</div>
            ) : (
              <>
                {filtered.map((collection) => {
                  const isMember = member.has(collection.id);
                  return (
                    <button
                      key={collection.id}
                      onClick={() => toggle(collection.id, collection.name)}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none hover:bg-hover focus-visible:bg-hover"
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded-md border',
                          isMember ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                        )}
                      >
                        {isMember && <Check className="size-3" />}
                      </span>
                      <FolderClosed className="size-4 shrink-0 text-fg-muted" />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {collection.name}
                      </span>
                      <span className="shrink-0 text-xs text-fg-subtle tabular-nums">
                        {collection.documentCount}
                      </span>
                    </button>
                  );
                })}

                {filtered.length === 0 && !canCreate && (
                  <div className="px-2 py-6 text-center text-sm text-fg-subtle">
                    No collections yet
                  </div>
                )}

                {canCreate && (
                  <button
                    onClick={() => void create()}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground outline-none hover:bg-hover focus-visible:bg-hover"
                  >
                    <Plus className="size-4 text-fg-muted" />
                    Create “{trimmed}”
                  </button>
                )}
              </>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
              <FolderPlus className="size-3.5" />
              Toggle a collection to add or remove
            </span>
            <Dialog.Close className="rounded-md px-2 py-1 text-sm text-fg-muted outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus">
              Done
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
