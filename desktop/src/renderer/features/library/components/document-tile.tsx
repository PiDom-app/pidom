import { Cloud, HardDrive } from 'lucide-react';
import { Tooltip } from 'radix-ui';
import { DocumentCover } from './document-cover';
import { ProgressLine } from './progress-line';
import { DocumentActions, DocumentContextMenu } from './document-actions';
import { formatProgress } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LibraryDocument } from '../data/types';

/**
 * A document as a browsable tile: cover as the anchor, title and one metadata
 * line under it, a reading-position line when started, and actions on hover.
 * No card — the tile is cover + text in the page flow, its only surface the
 * cover itself.
 */
export function DocumentTile({
  document,
  onScreen = true,
  className,
}: {
  document: LibraryDocument;
  /** Gate the cover mint until the tile is in the viewport. */
  onScreen?: boolean;
  className?: string;
}) {
  const started = document.progress > 0 && !document.isFinished;

  return (
    <DocumentContextMenu document={document}>
      <div className={cn('group relative flex w-full flex-col gap-2 text-left', className)}>
        <div className="relative">
          <DocumentCover document={document} enabled={onScreen} />
          <div className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <DocumentActions document={document} className="bg-elevated/80 backdrop-blur-sm" />
          </div>
        </div>

        {started && <ProgressLine progress={document.progress} />}

        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium text-foreground" title={document.title}>
              {document.title}
            </p>
            <StorageDot isSynced={document.isSynced} />
          </div>
          <p className="mt-0.5 truncate text-xs text-fg-muted">
            {document.author ?? 'Unknown author'}
            {started && (
              <span className="text-fg-subtle"> · {formatProgress(document.progress)}</span>
            )}
          </p>
        </div>
      </div>
    </DocumentContextMenu>
  );
}

/** A small state dot: in the cloud, or local to this device's account copy. */
export function StorageDot({ isSynced }: { isSynced: boolean }) {
  const label = isSynced ? 'Stored in your library' : 'On the device that imported it';
  const Icon = isSynced ? Cloud : HardDrive;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span className="shrink-0 text-fg-subtle" aria-label={label}>
          <Icon className="size-3" />
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="z-50 rounded-md border border-border bg-popover px-2 py-1 text-2xs text-popover-foreground shadow-lg"
          sideOffset={4}
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
