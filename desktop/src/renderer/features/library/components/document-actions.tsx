import { useState, type ReactNode } from 'react';
import { AlertDialog, ContextMenu, DropdownMenu } from 'radix-ui';
import { useQuery } from 'convex/react';
import { useNavigate } from '@tanstack/react-router';
import { BookOpen, FolderPlus, MoreHorizontal, Pencil, Star, StarOff, Trash2 } from 'lucide-react';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';
import { cn } from '@/lib/utils';
import { buttonGhostClass, menuItemClass, menuSeparatorClass, surfaceClass } from '@/lib/ui';
import { useDocumentActions } from '../data/use-document-actions';
import { RenameDialog } from './rename-dialog';
import type { LibraryCollection, LibraryDocument } from '../data/types';

/**
 * Rename + remove confirmations, mounted once and shared by both the three-dot
 * menu and the right-click context menu so a document has one set of dialogs
 * however the reader reaches them.
 */
function DocumentDialogs({
  document,
  renaming,
  setRenaming,
  removing,
  setRemoving,
}: {
  document: LibraryDocument;
  renaming: boolean;
  setRenaming: (open: boolean) => void;
  removing: boolean;
  setRemoving: (open: boolean) => void;
}) {
  const { renameDocument, removeDocument } = useDocumentActions();
  return (
    <>
      <RenameDialog
        open={renaming}
        currentTitle={document.title}
        onOpenChange={setRenaming}
        onRename={(title) => void renameDocument(document.id, title)}
      />
      <AlertDialog.Root open={removing} onOpenChange={setRemoving}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="animate-fade-in fixed inset-0 z-50 bg-overlay/50" />
          <AlertDialog.Content className="animate-slide-up fixed top-1/2 left-1/2 z-50 w-[26rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-elevated p-5 shadow-lg outline-none">
            <AlertDialog.Title className="text-sm font-semibold text-foreground">
              Remove “{document.title}”?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-1 text-xs text-fg-muted">
              This removes the document and its reading position from your account on every device.
              It does not delete any file already saved on this computer.
            </AlertDialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <AlertDialog.Cancel className={buttonGhostClass}>Cancel</AlertDialog.Cancel>
              <AlertDialog.Action
                className="inline-flex items-center justify-center rounded-md bg-destructive px-3.5 py-2 text-sm font-medium text-destructive-foreground outline-none transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-focus"
                onClick={() => void removeDocument(document.id)}
              >
                Remove
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

/** The collections a document can be added to, plus the add handler. */
function useMenuCollections(document: LibraryDocument) {
  const { addDocumentToCollection } = useDocumentActions();
  const collections = useQuery(api.collections.list, {});
  const add = (collectionId: Id<'collections'>, name: string) =>
    void addDocumentToCollection(collectionId, document.id, name);
  return { collections, add };
}

function collectionRows(
  collections: LibraryCollection[] | undefined,
  render: (collection: LibraryCollection) => ReactNode,
): ReactNode {
  if (collections === undefined)
    return <div className="px-2 py-1.5 text-sm text-fg-subtle">Loading…</div>;
  if (collections.length === 0)
    return <div className="px-2 py-1.5 text-sm text-fg-subtle">No collections yet</div>;
  return collections.map(render);
}

/** The three-dot dropdown, anchored to a tile or row. */
export function DocumentActions({
  document,
  className,
}: {
  document: LibraryDocument;
  className?: string;
}) {
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { toggleFavorite } = useDocumentActions();
  const { collections, add } = useMenuCollections(document);
  const navigate = useNavigate();
  const open = () =>
    void navigate({ to: '/reader/$documentId', params: { documentId: document.id } });

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label="Document actions"
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-hover data-[state=open]:text-foreground',
            className,
          )}
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={surfaceClass} align="end" sideOffset={4}>
            <DropdownMenu.Item className={menuItemClass} onSelect={open}>
              <BookOpen className="size-4" />
              Open
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={menuItemClass}
              onSelect={() => void toggleFavorite(document.id, !document.isFavorite)}
            >
              {document.isFavorite ? <StarOff className="size-4" /> : <Star className="size-4" />}
              {document.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            </DropdownMenu.Item>
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className={menuItemClass}>
                <FolderPlus className="size-4" />
                Add to collection
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent className={surfaceClass} sideOffset={2} alignOffset={-4}>
                  {collectionRows(collections, (collection) => (
                    <DropdownMenu.Item
                      key={collection.id}
                      className={menuItemClass}
                      onSelect={() => add(collection.id, collection.name)}
                    >
                      {collection.name}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            <DropdownMenu.Item className={menuItemClass} onSelect={() => setRenaming(true)}>
              <Pencil className="size-4" />
              Rename
            </DropdownMenu.Item>
            <DropdownMenu.Separator className={menuSeparatorClass} />
            <DropdownMenu.Item
              className={cn(menuItemClass, 'text-destructive data-[highlighted]:bg-danger-tint')}
              onSelect={() => setRemoving(true)}
            >
              <Trash2 className="size-4" />
              Remove from library
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <DocumentDialogs
        document={document}
        renaming={renaming}
        setRenaming={setRenaming}
        removing={removing}
        setRemoving={setRemoving}
      />
    </>
  );
}

/** Wrap a tile or row so right-click opens the same actions. */
export function DocumentContextMenu({
  document,
  children,
}: {
  document: LibraryDocument;
  children: ReactNode;
}) {
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { toggleFavorite } = useDocumentActions();
  const { collections, add } = useMenuCollections(document);
  const navigate = useNavigate();
  const open = () =>
    void navigate({ to: '/reader/$documentId', params: { documentId: document.id } });

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={surfaceClass}>
            <ContextMenu.Item className={menuItemClass} onSelect={open}>
              <BookOpen className="size-4" />
              Open
            </ContextMenu.Item>
            <ContextMenu.Item
              className={menuItemClass}
              onSelect={() => void toggleFavorite(document.id, !document.isFavorite)}
            >
              {document.isFavorite ? <StarOff className="size-4" /> : <Star className="size-4" />}
              {document.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            </ContextMenu.Item>
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className={menuItemClass}>
                <FolderPlus className="size-4" />
                Add to collection
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className={surfaceClass} sideOffset={2} alignOffset={-4}>
                  {collectionRows(collections, (collection) => (
                    <ContextMenu.Item
                      key={collection.id}
                      className={menuItemClass}
                      onSelect={() => add(collection.id, collection.name)}
                    >
                      {collection.name}
                    </ContextMenu.Item>
                  ))}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
            <ContextMenu.Item className={menuItemClass} onSelect={() => setRenaming(true)}>
              <Pencil className="size-4" />
              Rename
            </ContextMenu.Item>
            <ContextMenu.Separator className={menuSeparatorClass} />
            <ContextMenu.Item
              className={cn(menuItemClass, 'text-destructive data-[highlighted]:bg-danger-tint')}
              onSelect={() => setRemoving(true)}
            >
              <Trash2 className="size-4" />
              Remove from library
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <DocumentDialogs
        document={document}
        renaming={renaming}
        setRenaming={setRenaming}
        removing={removing}
        setRemoving={setRemoving}
      />
    </>
  );
}
