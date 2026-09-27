import type { ReactNode } from 'react';
import { ContextMenu, Tooltip } from 'radix-ui';
import { useNavigate } from '@tanstack/react-router';
import { BookOpen, Cloud, HardDrive, Loader, RotateCcw, TriangleAlert, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { menuItemClass, menuSeparatorClass, surfaceClass } from '@/lib/ui';
import { useImports } from '../data/use-imports';
import type { ImportJobStatus } from '../../../../shared/ipc';

/** Whether a job has a copy on disk that the reader can open right now. Every
 *  state past staging means the file was validated and renamed into place. */
export function isOpenable(state: ImportJobStatus['state']): boolean {
  return state !== 'staging' && state !== 'failed';
}

/** The fraction of the R2 upload that has landed, or null when the job is not
 *  uploading (nothing sensible to draw). Clamped 0–1 by `ProgressLine`. */
export function uploadFraction(job: ImportJobStatus): number | null {
  if (job.receivedBytes === null || job.byteSize <= 0) return null;
  return job.receivedBytes / job.byteSize;
}

/** A short, reader-facing reason for a failed import. Codes come from main. */
const FAILURE_REASON: Record<string, string> = {
  'not-a-pdf': 'that file is not a PDF',
  'too-large': 'that file is larger than the 100 MB limit',
  'not-a-file': 'that path is not a file',
  unreadable: "the file couldn't be read",
  'stage-failed': "the file couldn't be saved on this computer",
  'register-failed': "the document couldn't be registered",
  'upload-failed': "the upload didn't finish",
  'upload-not-synced': 'the upload is still settling — retry in a moment',
  'server-error': "the server didn't accept the upload",
  'signed-out': 'sign in to finish importing',
  offline: 'no connection — it will finish when you reconnect',
};

/** One line describing where a local-only import stands. */
export function importStatusLabel(job: ImportJobStatus): string {
  switch (job.state) {
    case 'staging':
      return 'Preparing on this device…';
    case 'staged':
    case 'registering':
      return 'On this device · registering…';
    case 'registered':
    case 'uploading':
    case 'uploaded':
      return 'On this device · uploading…';
    case 'duplicate':
      return 'Already in your library';
    case 'done':
      return 'In your library';
    case 'failed':
      return `Import failed — ${FAILURE_REASON[job.error ?? ''] ?? 'something went wrong'}`;
    default:
      return 'On this device';
  }
}

/**
 * The status dot for a local-only import row: a spinner while it works, a
 * warning triangle when it failed, an ok-tone cloud once the content has
 * settled into the library, tooltip carrying the detail. Mirrors the
 * synced/device `StorageDot` shape so tiles read consistently.
 */
export function ImportStatusDot({ job }: { job: ImportJobStatus }) {
  const failed = job.state === 'failed';
  const settled = job.state === 'duplicate' || job.state === 'done';
  const label = importStatusLabel(job);
  const Icon = failed
    ? TriangleAlert
    : settled
      ? Cloud
      : job.state === 'staging'
        ? Loader
        : HardDrive;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span
          className={cn('shrink-0', failed ? 'text-warn' : settled ? 'text-ok' : 'text-fg-subtle')}
          aria-label={label}
        >
          <Icon className={cn('size-3', job.state === 'staging' && 'animate-spin')} />
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="z-50 max-w-56 rounded-md border border-border bg-popover px-2 py-1 text-2xs text-popover-foreground shadow-lg"
          sideOffset={4}
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/**
 * Right-click actions for a local-only import. Deliberately NOT the Convex-backed
 * `DocumentContextMenu` — a staged file has a device-minted id the account does
 * not know, so favorite/rename/remove would fail. It offers only what applies:
 * open (when the copy is on disk), retry a failure, and cancel.
 */
export function ImportContextMenu({
  job,
  children,
}: {
  job: ImportJobStatus;
  children: ReactNode;
}) {
  const { retry, cancel } = useImports();
  const navigate = useNavigate();
  const openable = isOpenable(job.state);
  const open = () =>
    void navigate({ to: '/reader/$documentId', params: { documentId: job.localId } });

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={surfaceClass}>
          <ContextMenu.Item className={menuItemClass} disabled={!openable} onSelect={open}>
            <BookOpen className="size-4" />
            Open
          </ContextMenu.Item>
          {job.state === 'failed' && (
            <ContextMenu.Item className={menuItemClass} onSelect={() => void retry(job.localId)}>
              <RotateCcw className="size-4" />
              Retry import
            </ContextMenu.Item>
          )}
          <ContextMenu.Separator className={menuSeparatorClass} />
          <ContextMenu.Item
            className={cn(menuItemClass, 'text-destructive data-[highlighted]:bg-danger-tint')}
            onSelect={() => void cancel(job.localId)}
          >
            <Trash2 className="size-4" />
            Cancel import
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
