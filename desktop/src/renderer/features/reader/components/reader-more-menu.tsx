import { useState } from 'react';
import { AlertDialog, DropdownMenu, Toolbar } from 'radix-ui';
import { useQuery } from 'convex/react';
import {
  BookOpenCheck,
  ChevronRight,
  FolderPlus,
  Info,
  ListTree,
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
import { useDocumentActions } from '@/features/library/data/use-document-actions';
import { RenameDialog } from '@/features/library/components/rename-dialog';

/**
 * Open a dialog from a menu item on the next tick, not inside `onSelect`.
 *
 * Radix locks `pointer-events` on the body while a menu is open and releases it
 * as the menu closes; a dialog opened synchronously in the same tick can catch
 * the body mid-release and leave the whole window unclickable. Deferring one
 * frame lets the menu finish closing first, so the dialog owns a clean state.
 */
const deferOpen = (open: () => void) => setTimeout(open, 0);

/** Bytes as a short human string for the details panel. */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export interface ReaderMoreMeta {
  title: string;
  author: string | null;
  pageCount: number | null;
  byteSize: number;
  isFavorite: boolean;
  isFinished: boolean;
}

/**
 * The dock's overflow menu — the reader's secondary actions, the desktop face of
 * the mobile reader's "..." action sheet. It offers what maps onto a streaming
 * client with the shared backend: favourite, finished, collection, rename,
 * contents, details, remove. Download / offline / share live in Phase 2, so they
 * are deliberately absent rather than shown broken.
 */
export function ReaderMoreMenu({
  documentId,
  meta,
  onShowContents,
}: {
  documentId: Id<'documents'>;
  meta: ReaderMoreMeta;
  onShowContents: () => void;
}) {
  const { toggleFavorite, setFinished, addDocumentToCollection, renameDocument, removeDocument } =
    useDocumentActions();
  const collections = useQuery(api.collections.list, {});

  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [details, setDetails] = useState(false);

  const pageCount = meta.pageCount ?? 0;

  return (
    <>
      <DropdownMenu.Root>
        {/* No Tooltip wrapper: composing Tooltip.Trigger + DropdownMenu.Trigger
            onto one Toolbar.Button is a triple asChild merge that is fragile and
            buys little on a labelled button. The aria-label carries the name. */}
        <DropdownMenu.Trigger asChild>
          <Toolbar.Button
            aria-label="More actions"
            className="inline-flex size-9 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-hover data-[state=open]:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </Toolbar.Button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="top"
            align="end"
            sideOffset={8}
            className={cn(surfaceClass, 'w-56')}
          >
            <DropdownMenu.Item
              className={menuItemClass}
              onSelect={() => void toggleFavorite(documentId, !meta.isFavorite)}
            >
              {meta.isFavorite ? <StarOff className="size-4" /> : <Star className="size-4" />}
              {meta.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            </DropdownMenu.Item>

            <DropdownMenu.Item
              className={menuItemClass}
              onSelect={() => void setFinished(documentId, !meta.isFinished, pageCount)}
            >
              {meta.isFinished ? (
                <RotateCcw className="size-4" />
              ) : (
                <BookOpenCheck className="size-4" />
              )}
              {meta.isFinished ? 'Mark as unread' : 'Mark as finished'}
            </DropdownMenu.Item>

            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className={cn(menuItemClass, 'justify-between')}>
                <span className="flex items-center gap-2">
                  <FolderPlus className="size-4" />
                  Add to collection
                </span>
                <ChevronRight className="size-4 text-fg-subtle" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  className={cn(surfaceClass, 'max-h-72 w-52 overflow-auto')}
                  sideOffset={4}
                >
                  {collections === undefined ? (
                    <p className="px-2 py-1.5 text-sm text-fg-subtle">Loading…</p>
                  ) : collections.length === 0 ? (
                    <p className="px-2 py-1.5 text-sm text-fg-subtle">No collections yet.</p>
                  ) : (
                    collections.map((collection) => (
                      <DropdownMenu.Item
                        key={collection.id}
                        className={menuItemClass}
                        onSelect={() =>
                          void addDocumentToCollection(collection.id, documentId, collection.name)
                        }
                      >
                        <span className="min-w-0 truncate">{collection.name}</span>
                      </DropdownMenu.Item>
                    ))
                  )}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>

            <DropdownMenu.Item className={menuItemClass} onSelect={onShowContents}>
              <ListTree className="size-4" />
              Contents &amp; bookmarks
            </DropdownMenu.Item>

            <DropdownMenu.Separator className={menuSeparatorClass} />

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
              className={cn(
                menuItemClass,
                'text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive',
              )}
              onSelect={() => deferOpen(() => setRemoving(true))}
            >
              <Trash2 className="size-4" />
              Remove from library
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <RenameDialog
        open={renaming}
        currentTitle={meta.title}
        onOpenChange={setRenaming}
        onRename={(title) => void renameDocument(documentId, title)}
      />

      <AlertDialog.Root open={removing} onOpenChange={setRemoving}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-overlay/50" />
          <AlertDialog.Content
            className={cn(
              surfaceClass,
              'fixed top-1/2 left-1/2 z-50 w-[26rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 p-5',
            )}
          >
            <AlertDialog.Title className="text-sm font-semibold text-foreground">
              Remove “{meta.title}”?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-1 text-sm text-fg-muted">
              This removes the document and its reading position from your account on every device.
              It does not delete any file already saved on this computer.
            </AlertDialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <AlertDialog.Cancel className={buttonGhostClass}>Cancel</AlertDialog.Cancel>
              <AlertDialog.Action
                className="inline-flex items-center justify-center rounded-md bg-destructive px-3.5 py-2 text-sm font-medium text-destructive-foreground outline-none transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-focus"
                onClick={() => void removeDocument(documentId)}
              >
                Remove
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <AlertDialog.Root open={details} onOpenChange={setDetails}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-overlay/50" />
          <AlertDialog.Content
            className={cn(
              surfaceClass,
              'fixed top-1/2 left-1/2 z-50 w-[26rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 p-5',
            )}
          >
            <AlertDialog.Title className="text-sm font-semibold text-foreground">
              Details
            </AlertDialog.Title>
            <dl className="mt-3 space-y-2 text-sm">
              <DetailRow label="Title" value={meta.title} />
              <DetailRow label="Author" value={meta.author ?? '—'} />
              <DetailRow
                label="Pages"
                value={meta.pageCount != null ? String(meta.pageCount) : '—'}
              />
              <DetailRow label="Size" value={formatBytes(meta.byteSize)} />
            </dl>
            <div className="mt-4 flex justify-end">
              <AlertDialog.Cancel className={buttonGhostClass}>Close</AlertDialog.Cancel>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6">
      <dt className="shrink-0 text-fg-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-foreground">{value}</dd>
    </div>
  );
}
