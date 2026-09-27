import { DropdownMenu } from 'radix-ui';
import { useNavigate } from '@tanstack/react-router';
import { BookOpen, CheckCircle2, DownloadCloud, MoreHorizontal, Trash2 } from 'lucide-react';
import type { Id } from '@convex/dataModel';
import { cn } from '@/lib/utils';
import { menuItemClass, menuSeparatorClass, surfaceClass } from '@/lib/ui';
import type { LocalFileState } from '../../../../shared/ipc';

/**
 * The three-dot menu for a document in the Downloads list. Actions match what
 * the document's local state allows: a saved copy can be opened, verified, or
 * removed; anything not yet available offers a (re)download. Every action names
 * the document by its Convex id and goes through the storage bridge — no path.
 */
export function DownloadActions({
  documentId,
  state,
  isSynced,
  onDownload,
  onVerify,
  onRemove,
}: {
  documentId: string;
  state: LocalFileState;
  isSynced: boolean;
  onDownload: () => void;
  onVerify: () => void;
  onRemove: () => void;
}) {
  const navigate = useNavigate();
  const open = () =>
    void navigate({
      to: '/reader/$documentId',
      params: { documentId: documentId as Id<'documents'> },
    });

  const hasCopy = state !== 'none' && state !== 'downloading' && state !== 'queued';
  const canDownload = isSynced && state !== 'downloading' && state !== 'queued';
  const redownload = state === 'outdated' || state === 'missing' || state === 'failed';

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Download actions"
        className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-hover data-[state=open]:text-foreground"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={surfaceClass} align="end" sideOffset={4}>
          <DropdownMenu.Item className={menuItemClass} onSelect={open}>
            <BookOpen className="size-4" />
            Open
          </DropdownMenu.Item>
          {canDownload && (
            <DropdownMenu.Item className={menuItemClass} onSelect={onDownload}>
              <DownloadCloud className="size-4" />
              {redownload || state === 'available' ? 'Redownload' : 'Download'}
            </DropdownMenu.Item>
          )}
          {hasCopy && (
            <DropdownMenu.Item className={menuItemClass} onSelect={onVerify}>
              <CheckCircle2 className="size-4" />
              Verify
            </DropdownMenu.Item>
          )}
          {hasCopy && (
            <>
              <DropdownMenu.Separator className={menuSeparatorClass} />
              <DropdownMenu.Item
                className={cn(menuItemClass, 'text-destructive data-[highlighted]:bg-danger-tint')}
                onSelect={onRemove}
              >
                <Trash2 className="size-4" />
                Remove local copy
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
