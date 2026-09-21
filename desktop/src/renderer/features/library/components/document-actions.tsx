import { useState, type ReactNode } from 'react';
import { AlertDialog, ContextMenu, DropdownMenu } from 'radix-ui';
import { useQuery } from 'convex/react';
import { useNavigate } from '@tanstack/react-router';
import {
  BookOpen,
  BookOpenCheck,
  FolderPlus,
  Info,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';
import { cn } from '@/lib/utils';
import { buttonGhostClass, menuItemClass, menuSeparatorClass, surfaceClass } from '@/lib/ui';
import { useDocumentActions } from '../data/use-document-actions';
import { RenameDialog } from './rename-dialog';
import type { LibraryCollection, LibraryDocument } from '../data/types';

/**
 * Open a dialog from a menu item on the next tick, not inside `onSelect`. Radix
 * locks body `pointer-events` while a menu is open and releases it as the menu
 * closes; a dialog opened in the same tick can catch that mid-release and leave
 * the window unclickable. One frame's delay lets the menu finish closing first.
 */
const deferOpen = (open: () => void) => setTimeout(open, 0);

/** Bytes as a short human string for the details panel. */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

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
  details,
  setDetails,
}: {
  document: LibraryDocument;
  renaming: boolean;
  setRenaming: (open: boolean) => void;
  removing: boolean;
  setRemoving: (open: boolean) => void;
  details: boolean;
  setDetails: (open: boolean) => void;
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
      <AlertDialog.Root open={details} onOpenChange={setDetails}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="animate-fade-in fixed inset-0 z-50 bg-overlay/50" />
          <AlertDialog.Content className="animate-slide-up fixed top-1/2 left-1/2 z-50 w-[26rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-elevated p-5 shadow-lg outline-none">
            <AlertDialog.Title className="text-sm font-semibold text-foreground">
              Details
            </AlertDialog.Title>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-6">
                <dt className="shrink-0 text-fg-muted">Title</dt>
                <dd className="min-w-0 truncate text-right text-foreground">{document.title}</dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt className="shrink-0 text-fg-muted">Author</dt>
                <dd className="min-w-0 truncate text-right text-foreground">
                  {document.author ?? '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt className="shrink-0 text-fg-muted">Pages</dt>
                <dd className="text-right text-foreground">
                  {document.pageCount != null ? document.pageCount : '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt className="shrink-0 text-fg-muted">Size</dt>
                <dd className="text-right text-foreground">{formatBytes(document.byteSize)}</dd>
              </div>
            </dl>
            <div className="mt-4 flex justify-end">
              <AlertDialog.Cancel className={buttonGhostClass}>Close</AlertDialog.Cancel>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
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
  const [details, setDetails] = useState(false);
  const { toggleFavorite, setFinished } = useDocumentActions();
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
            <DropdownMenu.Item
              className={menuItemClass}
              onSelect={() =>
                void setFinished(document.id, !document.isFinished, document.pageCount ?? 0)
              }
            >
              {document.isFinished ? (
                <RotateCcw className="size-4" />
              ) : (
                <BookOpenCheck className="size-4" />
              )}
              {document.isFinished ? 'Mark as unread' : 'Mark as finished'}
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
            <DropdownMenu.Item
              className={menuItemClass}
              onSelect={() => deferOpen(() => setRenaming(true))}
            >
              <Pencil className="size-4" />
              Rename
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={menuItemClass}
              onSelect={() => deferOpen(() => setDetails(true))}
            >
              <Info className="size-4" />
              Details
            </DropdownMenu.Item>
            <DropdownMenu.Separator className={menuSeparatorClass} />
            <DropdownMenu.Item
              className={cn(menuItemClass, 'text-destructive data-[highlighted]:bg-danger-tint')}
              onSelect={() => deferOpen(() => setRemoving(true))}
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
        details={details}
        setDetails={setDetails}
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
  const [details, setDetails] = useState(false);
  const { toggleFavorite, setFinished } = useDocumentActions();
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
            <ContextMenu.Item
              className={menuItemClass}
              onSelect={() =>
                void setFinished(document.id, !document.isFinished, document.pageCount ?? 0)
              }
            >
              {document.isFinished ? (
                <RotateCcw className="size-4" />
              ) : (
                <BookOpenCheck className="size-4" />
              )}
              {document.isFinished ? 'Mark as unread' : 'Mark as finished'}
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
            <ContextMenu.Item
              className={menuItemClass}
              onSelect={() => deferOpen(() => setRenaming(true))}
            >
              <Pencil className="size-4" />
              Rename
            </ContextMenu.Item>
            <ContextMenu.Item
              className={menuItemClass}
              onSelect={() => deferOpen(() => setDetails(true))}
            >
              <Info className="size-4" />
              Details
            </ContextMenu.Item>
            <ContextMenu.Separator className={menuSeparatorClass} />
            <ContextMenu.Item
              className={cn(menuItemClass, 'text-destructive data-[highlighted]:bg-danger-tint')}
              onSelect={() => deferOpen(() => setRemoving(true))}
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
        details={details}
        setDetails={setDetails}
      />
    </>
  );
}
