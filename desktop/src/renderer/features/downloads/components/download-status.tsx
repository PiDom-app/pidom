import { Download } from 'lucide-react';
import { formatBytes } from '@/lib/format';
import { buttonGhostClass } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { useDesktopSettings } from '@/features/settings/use-desktop-settings';
import type { LocalDocumentStatus, LocalFileState } from '../../../../shared/ipc';
import { DownloadProgress } from './download-progress';

/** A short reader-facing reason for a failed download, from the main-process code. */
const FAILURE_REASON: Record<string, string> = {
  'not-a-pdf': 'file is not a PDF',
  'too-large': 'file is too large',
  'bad-url': 'bad download link',
  'signed-out': 'sign in to download',
  'server-error': 'the server refused',
  'not-synced': 'not in your account',
  timeout: 'timed out',
  'download-failed': 'download failed',
};

/** The coloured dot beside a settled state. */
function Dot({ tone }: { tone: 'ok' | 'warn' | 'bad' }) {
  return (
    <span
      className={cn(
        'size-2 shrink-0 rounded-full',
        tone === 'ok' ? 'bg-ok' : tone === 'warn' ? 'bg-warn' : 'bg-destructive',
      )}
    />
  );
}

/**
 * The status cell for one document in the Downloads list.
 *
 * It reads the local state main reports and shows the matching affordance: a
 * live progress line while bytes arrive, a coloured dot and label once the copy
 * settles, or a Download button when nothing is saved yet. `none` for a synced
 * document is the invitation to download; `none` for an unsynced one has nothing
 * to offer.
 */
export function DownloadStatus({
  status,
  isSynced,
  onDownload,
}: {
  status: LocalDocumentStatus | undefined;
  isSynced: boolean;
  onDownload: () => void;
}) {
  const state: LocalFileState = status?.state ?? 'none';
  const { downloadAnimation } = useDesktopSettings();

  if (state === 'downloading') {
    const received = status?.receivedBytes ?? 0;
    const total = status?.totalBytes ?? null;
    const fraction = total && total > 0 ? received / total : 0;
    const meta = (
      <span className="text-xs tabular-nums text-fg-muted">
        Downloading · {formatBytes(received)}
        {total ? ` of ${formatBytes(total)}` : ''}
      </span>
    );
    // The ring reads as a compact circular gauge beside the label; the linear
    // styles stack above it, matching the sign-off mockup.
    if (downloadAnimation === 'ring') {
      return (
        <div className="flex w-full max-w-56 items-center gap-3">
          <DownloadProgress style="ring" progress={fraction} />
          {meta}
        </div>
      );
    }
    return (
      <div className="flex w-full max-w-56 flex-col gap-1">
        <DownloadProgress style={downloadAnimation} progress={fraction} />
        {meta}
      </div>
    );
  }

  if (state === 'none') {
    if (!isSynced) return <span className="text-sm text-fg-subtle">Not synced</span>;
    return (
      <button className={cn(buttonGhostClass, 'px-2.5 py-1.5 text-xs')} onClick={onDownload}>
        <Download className="size-3.5" />
        Download
      </button>
    );
  }

  const label: Record<Exclude<LocalFileState, 'downloading' | 'none'>, string> = {
    available: 'Available offline',
    queued: 'Queued…',
    verifying: 'Verifying…',
    paused: 'Paused',
    outdated: 'Outdated · redownload',
    missing: 'File missing · redownload',
    failed: `Download failed${status?.error ? ` · ${FAILURE_REASON[status.error] ?? 'retry'}` : ' · retry'}`,
  };
  const tone: Record<Exclude<LocalFileState, 'downloading' | 'none'>, 'ok' | 'warn' | 'bad'> = {
    available: 'ok',
    queued: 'warn',
    verifying: 'warn',
    paused: 'warn',
    outdated: 'warn',
    missing: 'warn',
    failed: 'bad',
  };

  return (
    <span className="inline-flex items-center gap-2 text-sm text-fg-muted">
      <Dot tone={tone[state]} />
      {label[state]}
    </span>
  );
}
