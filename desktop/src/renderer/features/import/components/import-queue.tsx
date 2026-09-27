import { Popover, ScrollArea, Tooltip } from 'radix-ui';
import { useNavigate } from '@tanstack/react-router';
import { BookOpen, Loader, RotateCcw, TriangleAlert, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProgressLine } from '@/features/library/components/progress-line';
import { useImports } from '../data/use-imports';
import { importStatusLabel, isOpenable, uploadFraction } from './import-context-menu';
import type { ImportJobStatus } from '../../../../shared/ipc';

/** What the live queue shows: everything still moving, plus failures waiting for
 *  a retry. A `done` or byte-shared `duplicate` job has left the pipeline and is
 *  in the library itself, so it drops out. */
function isPending(job: ImportJobStatus): boolean {
  return job.state !== 'done' && job.state !== 'duplicate';
}

/**
 * The title-bar import indicator: a small button that appears only while imports
 * are in flight or a failure is waiting, opening a Popover queue of those jobs.
 *
 * It never surfaces a filesystem path — every job is named by its title and
 * driven by its `localId`, exactly what main hands the renderer. Terminal jobs
 * drop out (they are in the library now); what remains is the work still moving
 * and anything that needs a retry.
 */
export function ImportQueue() {
  const { jobs, activeCount, failedCount, retry, cancel, retryAll } = useImports();
  const navigate = useNavigate();

  const pending = jobs.filter(isPending);
  if (pending.length === 0) return null;

  const open = (localId: string) =>
    void navigate({ to: '/reader/$documentId', params: { documentId: localId } });

  return (
    <Popover.Root>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Popover.Trigger
            className="no-app-drag relative flex size-7 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-hover data-[state=open]:text-foreground"
            aria-label={`Imports — ${activeCount} active, ${failedCount} failed`}
          >
            {activeCount > 0 ? (
              <Loader className="size-4 animate-spin" />
            ) : (
              <TriangleAlert className="size-4 text-warn" />
            )}
            {failedCount > 0 && activeCount > 0 && (
              <span className="absolute top-1 right-1 size-1.5 rounded-full bg-warn" />
            )}
          </Popover.Trigger>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="z-50 rounded-md border border-border bg-popover px-2 py-1 text-2xs text-popover-foreground shadow-lg"
            sideOffset={4}
          >
            {activeCount > 0 ? `Importing ${activeCount}…` : `${failedCount} import failed`}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-80 rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="flex items-center justify-between px-3 py-2 shadow-[inset_0_-1px_0_rgb(var(--hairline))]">
            <span className="text-xs font-semibold text-foreground">Imports</span>
            {activeCount > 0 && (
              <span className="text-2xs text-fg-subtle">{activeCount} in progress</span>
            )}
          </div>

          <ScrollArea.Root className="max-h-80 overflow-hidden">
            <ScrollArea.Viewport className="max-h-80 w-full">
              <ul className="p-1">
                {pending.map((job) => (
                  <QueueRow
                    key={job.localId}
                    job={job}
                    onOpen={() => open(job.localId)}
                    onRetry={() => void retry(job.localId)}
                    onCancel={() => void cancel(job.localId)}
                  />
                ))}
              </ul>
            </ScrollArea.Viewport>
            <ScrollArea.Scrollbar orientation="vertical" className="flex w-2 touch-none p-0.5">
              <ScrollArea.Thumb className="flex-1 rounded-full bg-border-strong" />
            </ScrollArea.Scrollbar>
          </ScrollArea.Root>

          {failedCount > 0 && (
            <div className="p-1 shadow-[inset_0_1px_0_rgb(var(--hairline))]">
              <button
                className="flex w-full items-center justify-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground outline-none transition-colors hover:bg-hover"
                onClick={() => void retryAll()}
              >
                <RotateCcw className="size-4" />
                Retry all failed
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** One row in the queue: title, a state line, an upload bar while uploading, and
 *  the actions that apply — open when the copy is on disk, retry a failure,
 *  cancel. */
function QueueRow({
  job,
  onOpen,
  onRetry,
  onCancel,
}: {
  job: ImportJobStatus;
  onOpen: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const failed = job.state === 'failed';
  const fraction = uploadFraction(job);
  const actionClass =
    'flex size-6 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-hover hover:text-foreground';

  return (
    <li className="flex items-center gap-2 rounded-md px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground" title={job.title}>
          {job.title}
        </p>
        <p className={cn('mt-0.5 truncate text-2xs', failed ? 'text-warn' : 'text-fg-subtle')}>
          {importStatusLabel(job)}
        </p>
        {fraction !== null && <ProgressLine progress={fraction} className="mt-1" />}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {isOpenable(job.state) && (
          <button className={actionClass} aria-label="Open" onClick={onOpen}>
            <BookOpen className="size-3.5" />
          </button>
        )}
        {failed && (
          <button className={actionClass} aria-label="Retry" onClick={onRetry}>
            <RotateCcw className="size-3.5" />
          </button>
        )}
        <button
          className={cn(actionClass, 'hover:text-destructive')}
          aria-label="Cancel import"
          onClick={onCancel}
        >
          {failed ? <Trash2 className="size-3.5" /> : <X className="size-3.5" />}
        </button>
      </div>
    </li>
  );
}
