import { useState, type ReactNode } from 'react';
import { AlertDialog, ContextMenu, DropdownMenu } from 'radix-ui';
import { useNavigate } from '@tanstack/react-router';
import { FolderOpen, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonGhostClass, menuItemClass, menuSeparatorClass, surfaceClass } from '@/lib/ui';
import { useDocumentActions } from '../data/use-document-actions';
import { CollectionNameDialog } from './collection-name-dialog';

/**
 * A collection reduced to what its menus need. The id is opaque — a Convex
 * collection id once synced, or a `col_<hex>` placeholder while a create is still
 * queued offline — so it is typed as a plain string, not a branded Convex id.
 */
type CollectionRef = { id: string; name: string };

/**
 * Open a dialog from a menu item on the next tick — Radix locks body
 * `pointer-events` while a menu is open and releases it as the menu closes, and
 * a dialog opened in the same tick can catch that mid-release. Same reason as
 * `document-actions.tsx`.
 */
const deferOpen = (open: () => void) => setTimeout(open, 0);

/**
 * Rename + delete confirmations, mounted once and shared by the collection's
 * context menu and its detail-header menu so a collection has one set of dialogs
 * however the reader reaches them.
 */
function CollectionDialogs({
  collection,
  renaming,
  setRenaming,
  removing,
  setRemoving,
  onDeleted,
}: {
  collection: CollectionRef;
  renaming: boolean;
  setRenaming: (open: boolean) => void;
  removing: boolean;
  setRemoving: (open: boolean) => void;
  /** Run after a successful delete — e.g. leave the detail route. */
  onDeleted?: () => void;
}) {
  const { renameCollection, removeCollection } = useDocumentActions();
  return (
    <>
      <CollectionNameDialog
        open={renaming}
        title="Rename collection"
        submitLabel="Save"
        initialValue={collection.name}
        onOpenChange={setRenaming}
        onSubmit={(name) => void renameCollection(collection.id, name)}
      />
      <AlertDialog.Root open={removing} onOpenChange={setRemoving}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="animate-fade-in fixed inset-0 z-50 bg-overlay/50" />
          <AlertDialog.Content className="animate-slide-up fixed top-1/2 left-1/2 z-50 w-[26rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-elevated p-5 shadow-lg outline-none">
            <AlertDialog.Title className="text-sm font-semibold text-foreground">
              Delete “{collection.name}”?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-1 text-xs text-fg-muted">
              Deletes the collection. Your documents are not removed.
            </AlertDialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <AlertDialog.Cancel className={buttonGhostClass}>Cancel</AlertDialog.Cancel>
              <AlertDialog.Action
                className="inline-flex items-center justify-center rounded-md bg-destructive px-3.5 py-2 text-sm font-medium text-destructive-foreground outline-none transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-focus"
                onClick={() => {
                  void removeCollection(collection.id);
                  onDeleted?.();
                }}
              >
                Delete
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

/** Wrap a collection tile so right-click opens Open / Rename / Delete. */
export function CollectionContextMenu({
  collection,
  children,
}: {
  collection: CollectionRef;
  children: ReactNode;
}) {
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const navigate = useNavigate();
  const open = () =>
    void navigate({ to: '/collections/$collectionId', params: { collectionId: collection.id } });

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={surfaceClass}>
            <ContextMenu.Item className={menuItemClass} onSelect={open}>
              <FolderOpen className="size-4" />
              Open
            </ContextMenu.Item>
            <ContextMenu.Item
              className={menuItemClass}
              onSelect={() => deferOpen(() => setRenaming(true))}
            >
              <Pencil className="size-4" />
              Rename
            </ContextMenu.Item>
            <ContextMenu.Separator className={menuSeparatorClass} />
            <ContextMenu.Item
              className={cn(menuItemClass, 'text-destructive data-[highlighted]:bg-danger-tint')}
              onSelect={() => deferOpen(() => setRemoving(true))}
            >
              <Trash2 className="size-4" />
              Delete
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <CollectionDialogs
        collection={collection}
        renaming={renaming}
        setRenaming={setRenaming}
        removing={removing}
        setRemoving={setRemoving}
      />
    </>
  );
}

/** The three-dot menu for a collection's detail header: Rename / Delete. */
export function CollectionMenu({
  collection,
  onDeleted,
}: {
  collection: CollectionRef;
  onDeleted?: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label="Collection actions"
          className="inline-flex size-8 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-hover data-[state=open]:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={surfaceClass} align="end" sideOffset={4}>
            <DropdownMenu.Item
              className={menuItemClass}
              onSelect={() => deferOpen(() => setRenaming(true))}
            >
              <Pencil className="size-4" />
              Rename
            </DropdownMenu.Item>
            <DropdownMenu.Separator className={menuSeparatorClass} />
            <DropdownMenu.Item
              className={cn(menuItemClass, 'text-destructive data-[highlighted]:bg-danger-tint')}
              onSelect={() => deferOpen(() => setRemoving(true))}
            >
              <Trash2 className="size-4" />
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <CollectionDialogs
        collection={collection}
        renaming={renaming}
        setRenaming={setRenaming}
        removing={removing}
        setRemoving={setRemoving}
        onDeleted={onDeleted}
      />
    </>
  );
}
