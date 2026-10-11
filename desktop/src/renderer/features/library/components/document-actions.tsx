import { useState, type ReactNode } from 'react';
import { AlertDialog, ContextMenu, DropdownMenu } from 'radix-ui';
import { useNavigate } from '@tanstack/react-router';
import {
  BookOpen,
  BookOpenCheck,
  FolderMinus,
  FolderPlus,
  Info,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react';
import type { Id } from '@convex/dataModel';
import { cn } from '@/lib/utils';
import { buttonGhostClass, menuItemClass, surfaceClass } from '@/lib/ui';
import { useDocumentActions } from '../data/use-document-actions';
import { RenameDialog } from './rename-dialog';
import { AddToCollectionDialog } from './add-to-collection-dialog';
import type { LibraryDocument } from '../data/types';

/** The collection a document is being shown inside, when it is. Enables the
 *  "Remove from collection" action on the document's menus. */
export type CollectionContext = { id: Id<'collections'>; name: string };

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
 * Rename, add-to-collection, details, and remove dialogs, mounted once and
 * shared by both the three-dot menu and the right-click context menu so a
 * document has one set of dialogs however the reader reaches them.
 */
function DocumentDialogs({
  document,
  renaming,
  setRenaming,
  adding,
  setAdding,
  removing,
  setRemoving,
  details,
  setDetails,
}: {
  document: LibraryDocument;
  renaming: boolean;
  setRenaming: (open: boolean) => void;
  adding: boolean;
  setAdding: (open: boolean) => void;
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
      <AddToCollectionDialog document={document} open={adding} onOpenChange={setAdding} />
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

/** The action items, shared verbatim by the dropdown and the context menu.
 *  `Item` is the menu's own item component so each renders in its own tree. */
function actionItems(
  Item: typeof DropdownMenu.Item | typeof ContextMenu.Item,
  {
    document,
    collectionContext,
    open,
    edit,
    toggleFavorite,
    setFinished,
    removeDocumentFromCollection,
    setAdding,
    setRenaming,
    setDetails,
    setRemoving,
  }: {
    document: LibraryDocument;
    collectionContext?: CollectionContext;
    open: () => void;
    edit: () => void;
    toggleFavorite: (id: Id<'documents'>, next: boolean) => void;
    setFinished: (id: Id<'documents'>, next: boolean, pageCount: number) => void;
    removeDocumentFromCollection: (
      collectionId: Id<'collections'>,
      documentId: Id<'documents'>,
      name: string,
    ) => void;
    setAdding: (open: boolean) => void;
    setRenaming: (open: boolean) => void;
    setDetails: (open: boolean) => void;
    setRemoving: (open: boolean) => void;
  },
) {
  return (
    <>
      <Item className={menuItemClass} onSelect={open}>
        <BookOpen className="size-4" />
        Open
      </Item>
      <Item
        className={cn(menuItemClass, !['pdf', 'txt', 'md', 'csv', 'image', 'docx', 'xlsx', 'pptx', 'odt'].includes(document.documentKind) && 'opacity-50')}
        disabled={!['pdf', 'txt', 'md', 'csv', 'image', 'docx', 'xlsx', 'pptx', 'odt'].includes(document.documentKind)}
        onSelect={edit}
      >
        <Pencil className="size-4" />
        Edit
      </Item>
      <Item
        className={menuItemClass}
        onSelect={() => toggleFavorite(document.id, !document.isFavorite)}
      >
        {document.isFavorite ? <StarOff className="size-4" /> : <Star className="size-4" />}
        {document.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      </Item>
      <Item
        className={menuItemClass}
        onSelect={() => setFinished(document.id, !document.isFinished, document.pageCount ?? 0)}
      >
        {document.isFinished ? <RotateCcw className="size-4" /> : <BookOpenCheck className="size-4" />}
        {document.isFinished ? 'Mark as unread' : 'Mark as finished'}
      </Item>
      <Item className={menuItemClass} onSelect={() => deferOpen(() => setAdding(true))}>
        <FolderPlus className="size-4" />
        Add to collection
      </Item>
      {collectionContext && (
        <Item
          className={menuItemClass}
          onSelect={() =>
            removeDocumentFromCollection(collectionContext.id, document.id, collectionContext.name)
          }
        >
          <FolderMinus className="size-4" />
          Remove from collection
        </Item>
      )}
      <Item className={menuItemClass} onSelect={() => deferOpen(() => setRenaming(true))}>
        <Pencil className="size-4" />
        Rename
      </Item>
      <Item className={menuItemClass} onSelect={() => deferOpen(() => setDetails(true))}>
        <Info className="size-4" />
        Details
      </Item>
      <Item
        className={cn(menuItemClass, 'text-destructive data-[highlighted]:bg-danger-tint')}
        onSelect={() => deferOpen(() => setRemoving(true))}
      >
        <Trash2 className="size-4" />
        Remove from library
      </Item>
    </>
  );
}

/** Shared dialog state for a menu instance. */
function useDocumentMenuState() {
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [details, setDetails] = useState(false);
  const { toggleFavorite, setFinished, removeDocumentFromCollection } = useDocumentActions();
  const navigate = useNavigate();
  return {
    renaming,
    setRenaming,
    adding,
    setAdding,
    removing,
    setRemoving,
    details,
    setDetails,
    toggleFavorite,
    setFinished,
    removeDocumentFromCollection,
    open: (id: Id<'documents'>) => void navigate({ to: '/reader/$documentId', params: { documentId: id } }),
    edit: (id: Id<'documents'>) => void navigate({ to: '/editor/$documentId', params: { documentId: id } }),
  };
}

/** The three-dot dropdown, anchored to a tile or row. */
export function DocumentActions({
  document,
  className,
  collectionContext,
}: {
  document: LibraryDocument;
  className?: string;
  collectionContext?: CollectionContext;
}) {
  const s = useDocumentMenuState();

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
            {actionItems(DropdownMenu.Item, {
              document,
              collectionContext,
              open: () => s.open(document.id),
              edit: () => s.edit(document.id),
              toggleFavorite: s.toggleFavorite,
              setFinished: s.setFinished,
              removeDocumentFromCollection: s.removeDocumentFromCollection,
              setAdding: s.setAdding,
              setRenaming: s.setRenaming,
              setDetails: s.setDetails,
              setRemoving: s.setRemoving,
            })}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <DocumentDialogs
        document={document}
        renaming={s.renaming}
        setRenaming={s.setRenaming}
        adding={s.adding}
        setAdding={s.setAdding}
        removing={s.removing}
        setRemoving={s.setRemoving}
        details={s.details}
        setDetails={s.setDetails}
      />
    </>
  );
}

/** Wrap a tile or row so right-click opens the same actions. */
export function DocumentContextMenu({
  document,
  children,
  collectionContext,
}: {
  document: LibraryDocument;
  children: ReactNode;
  collectionContext?: CollectionContext;
}) {
  const s = useDocumentMenuState();

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={surfaceClass}>
            {actionItems(ContextMenu.Item, {
              document,
              collectionContext,
              open: () => s.open(document.id),
              edit: () => s.edit(document.id),
              toggleFavorite: s.toggleFavorite,
              setFinished: s.setFinished,
              removeDocumentFromCollection: s.removeDocumentFromCollection,
              setAdding: s.setAdding,
              setRenaming: s.setRenaming,
              setDetails: s.setDetails,
              setRemoving: s.setRemoving,
            })}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <DocumentDialogs
        document={document}
        renaming={s.renaming}
        setRenaming={s.setRenaming}
        adding={s.adding}
        setAdding={s.setAdding}
        removing={s.removing}
        setRemoving={s.setRemoving}
        details={s.details}
        setDetails={s.setDetails}
      />
    </>
  );
}
