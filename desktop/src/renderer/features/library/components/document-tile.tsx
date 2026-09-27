import { Cloud, HardDrive } from 'lucide-react';
import { Tooltip } from 'radix-ui';
import { DocumentCover } from './document-cover';
import { ProgressLine } from './progress-line';
import { DocumentActions, DocumentContextMenu } from './document-actions';
import {
  ImportContextMenu,
  ImportStatusDot,
  isOpenable,
  uploadFraction,
} from '@/features/import/components/import-context-menu';
import { formatProgress } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LibraryEntry } from '@/features/import/data/pseudo-document';

/**
 * A document as a browsable tile: cover as the anchor, title and one metadata
 * line under it, a reading-position line when started, and actions on hover.
 * No card — the tile is cover + text in the page flow, its only surface the
 * cover itself.
 *
 * A local-only import (a file staged on this device, not yet a Convex document)
 * renders through the same shape but with an import status dot and an
 * import-specific context menu — it has a device-minted id the account does not
 * know, so the Convex-backed actions do not apply to it.
 */
export function DocumentTile({
  document,
  onScreen = true,
  className,
}: {
  document: LibraryEntry;
  /** Gate the cover mint until the tile is in the viewport. */
  onScreen?: boolean;
  className?: string;
}) {
  if (document.importJob)
    return <ImportTile document={document} onScreen={onScreen} className={className} />;

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

/** The local-only import variant: a dimmed cover while it works, a status dot,
 *  and the import context menu. Openable once the copy is on disk. */
function ImportTile({
  document,
  onScreen,
  className,
}: {
  document: LibraryEntry;
  onScreen: boolean;
  className?: string;
}) {
  const job = document.importJob!;
  const working = job.state !== 'failed';
  const label = job.state === 'failed' ? (job.error ?? 'Failed') : 'Importing…';
  const fraction = uploadFraction(job);

  return (
    <ImportContextMenu job={job}>
      <div className={cn('group relative flex w-full flex-col gap-2 text-left', className)}>
        <div className="relative">
          <div className={cn(working && 'opacity-70')}>
            <DocumentCover document={document} enabled={onScreen} />
          </div>
          <span className="absolute top-1.5 left-1.5 rounded-md bg-overlay/70 px-1.5 py-0.5 text-2xs font-medium text-white backdrop-blur-sm">
            {label}
          </span>
        </div>

        {fraction !== null && <ProgressLine progress={fraction} />}

        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium text-foreground" title={document.title}>
              {document.title}
            </p>
            <ImportStatusDot job={job} />
          </div>
          <p
            className={cn(
              'mt-0.5 truncate text-xs',
              job.state === 'failed' ? 'text-warn' : 'text-fg-muted',
            )}
          >
            {fraction !== null
              ? `Uploading · ${formatProgress(fraction)}`
              : isOpenable(job.state)
                ? 'On this device'
                : 'Preparing…'}
          </p>
        </div>
      </div>
    </ImportContextMenu>
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
