import { useMemo, useState } from 'react';
import { Popover } from 'radix-ui';
import { Check, FolderClosed, FolderPlus, Plus, Search } from 'lucide-react';
import type { Id } from '@convex/dataModel';
import { useDocumentActions } from '../data/use-document-actions';
import { useCollectionsMirror } from '../data/use-collections-mirror';

/**
 * The multi-select toolbar's "Add to collection" picker, anchored under its
 * button.
 *
 * Deliberately **action-oriented**, not membership-reflecting: it adds every
 * selected document to the collection you click. Because it acts on many
 * documents at once there is no single "already a member" truth to show, so it
 * asks for no per-document membership query — it shows a transient check on a
 * row the moment its add lands, and stays open so several collections can be
 * added to before closing. A search field filters the list; when the query
 * matches nothing, an inline row creates the collection and adds the selection
 * to it in one step.
 *
 * The single-document picker (`add-to-collection-dialog.tsx`) is the opposite:
 * it toggles true membership from `collections.forDocument`. Two surfaces, two
 * jobs — this one never has to be right about state it cannot cheaply know.
 */
export function BulkAddToCollectionPopover({
  documentIds,
  triggerClassName,
  children,
}: {
  documentIds: Id<'documents'>[];
  triggerClassName?: string;
  children: React.ReactNode;
}) {
  const { addManyToCollection, createCollection } = useDocumentActions();
  const { collections, loading } = useCollectionsMirror();
  const [query, setQuery] = useState('');
  const [justAdded, setJustAdded] = useState<Record<string, true>>({});

  const trimmed = query.trim();
  const filtered = useMemo(() => {
    if (loading) return undefined;
    const q = trimmed.toLowerCase();
    return q ? collections.filter((c) => c.name.toLowerCase().includes(q)) : collections;
  }, [collections, loading, trimmed]);

  const exactExists = collections.some(
    (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
  );
  const canCreate = trimmed.length > 0 && !exactExists;

  const add = async (collectionId: string, name: string) => {
    const ok = await addManyToCollection(collectionId, documentIds, name);
    if (ok) setJustAdded((prev) => ({ ...prev, [collectionId]: true }));
  };

  const create = async () => {
    const id = await createCollection(trimmed);
    if (id) {
      await add(id, trimmed);
      setQuery('');
    }
  };

  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (!open) {
          setQuery('');
          setJustAdded({});
        }
      }}
    >
      <Popover.Trigger className={triggerClassName}>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 flex max-h-[24rem] w-[20rem] flex-col rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg"
        >
          <div className="flex items-center gap-2 rounded-md border border-border bg-sunken px-3 focus-within:border-border-strong focus-within:ring-2 focus-within:ring-focus">
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
                  const added = justAdded[collection.id] === true;
                  return (
                    <button
                      key={collection.id}
                      onClick={() => void add(collection.id, collection.name)}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-hover focus-visible:bg-hover"
                    >
                      <FolderClosed className="size-4 shrink-0 text-fg-muted" />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {collection.name}
                      </span>
                      {added ? (
                        <Check className="size-4 shrink-0 text-primary" />
                      ) : (
                        <span className="shrink-0 text-xs text-fg-subtle tabular-nums">
                          {collection.documentCount}
                        </span>
                      )}
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

          <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 text-xs text-fg-subtle shadow-[inset_0_1px_0_rgb(var(--hairline))]">
            <FolderPlus className="size-3.5" />
            Adds all selected to a collection
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
