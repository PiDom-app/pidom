import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Cloud, Download, HardDrive } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { DocumentCover } from '@/features/library/components/document-cover';
import { useAllLibrary } from '@/features/library/data/use-all-library';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LibraryDocument } from '@/features/library/data/types';
import { DownloadActions } from './components/download-actions';
import { DownloadStatus } from './components/download-status';
import { useDownloads } from './data/use-downloads';
import type { LocalDocumentStatus } from '../../../shared/ipc';

type Filter = 'all' | 'device' | 'cloud';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'device', label: 'On device' },
  { id: 'cloud', label: 'Cloud only' },
];

/** A document is "on this device" once its local copy has settled to a usable
 *  state — present, or present-but-flagged. Everything else counts as cloud. */
function isOnDevice(status: LocalDocumentStatus | undefined): boolean {
  const state = status?.state;
  return (
    state === 'available' ||
    state === 'downloading' ||
    state === 'verifying' ||
    state === 'queued' ||
    state === 'paused' ||
    state === 'outdated' ||
    state === 'missing'
  );
}

/**
 * Downloads — the manager for what this computer holds offline.
 *
 * It joins the account library (paginated through the same `snapshot` query the
 * Library view uses) with the local statuses main reports, so every synced
 * document shows here with either its saved state or an invitation to download.
 * Main does the work; this screen names documents by id and reflects the pushes.
 */
export function DownloadsScreen() {
  const { documents, status: pageStatus, loadMoreDefault } = useAllLibrary();
  const { statuses, download, remove, verify } = useDownloads();
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(
    () =>
      documents.filter((doc) => {
        const local = statuses.get(doc.id);
        if (filter === 'device') return isOnDevice(local);
        if (filter === 'cloud') return doc.isSynced && !isOnDevice(local);
        return true;
      }),
    [documents, statuses, filter],
  );

  const deviceCount = useMemo(
    () => documents.filter((doc) => isOnDevice(statuses.get(doc.id))).length,
    [documents, statuses],
  );
  const deviceBytes = useMemo(() => {
    let total = 0;
    for (const [, s] of statuses) if (s.state === 'available' && s.bytes) total += s.bytes;
    return total;
  }, [statuses]);

  const onNearEnd = () => {
    if (pageStatus === 'CanLoadMore') loadMoreDefault();
  };
  const firstLoad = pageStatus === 'LoadingFirstPage';

  return (
    <div className="flex h-full flex-col px-8 py-8">
      <PageHeader
        title="Downloads"
        subtitle="Documents saved on this computer for offline reading."
      >
        {!firstLoad && (
          <span className="text-xs tabular-nums text-fg-subtle">
            {deviceCount} on this device · {formatBytes(deviceBytes)}
          </span>
        )}
      </PageHeader>

      <div className="mb-4 flex items-center gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus',
              filter === f.id
                ? 'bg-hover font-medium text-foreground'
                : 'text-fg-muted hover:bg-hover hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {firstLoad ? (
          <div className="flex flex-col gap-px">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 rounded-md bg-sunken" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyDownloads filtered={filter !== 'all'} />
        ) : (
          <DownloadRows
            rows={rows}
            statuses={statuses}
            onNearEnd={onNearEnd}
            onDownload={(id) => void download(id)}
            onVerify={(id) => void verify(id)}
            onRemove={(id) => void remove(id)}
          />
        )}
      </div>
    </div>
  );
}

/** The virtualized list. Only the rows in view mount, so a large library stays a
 *  few dozen nodes; scrolling near the bottom pulls the next library page. */
function DownloadRows({
  rows,
  statuses,
  onNearEnd,
  onDownload,
  onVerify,
  onRemove,
}: {
  rows: LibraryDocument[];
  statuses: Map<string, LocalDocumentStatus>;
  onNearEnd: () => void;
  onDownload: (id: string) => void;
  onVerify: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 12,
  });

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) onNearEnd();
  };

  return (
    <div ref={parentRef} onScroll={onScroll} className="h-full overflow-auto">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const doc = rows[item.index];
          const local = statuses.get(doc.id);
          return (
            <div
              key={doc.id}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 flex w-full items-center gap-4 py-2 pr-1 pl-2 shadow-[inset_0_-1px_0_rgb(var(--hairline))]"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <DocumentCover document={doc} className="h-10 w-8 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{doc.title}</p>
                <p className="truncate text-xs text-fg-muted">{doc.author ?? '—'}</p>
              </div>
              <span className="hidden w-24 shrink-0 items-center gap-1.5 text-sm text-fg-muted sm:inline-flex">
                {isOnDevice(local) ? (
                  <>
                    <HardDrive className="size-3.5" /> Device
                  </>
                ) : (
                  <>
                    <Cloud className="size-3.5" /> Cloud
                  </>
                )}
              </span>
              <span className="hidden w-20 shrink-0 text-right text-sm tabular-nums text-fg-muted md:block">
                {formatBytes(local?.bytes ?? doc.byteSize)}
              </span>
              <div className="flex w-64 shrink-0 justify-start">
                <DownloadStatus
                  status={local}
                  isSynced={doc.isSynced}
                  onDownload={() => onDownload(doc.id)}
                />
              </div>
              <DownloadActions
                documentId={doc.id}
                state={local?.state ?? 'none'}
                isSynced={doc.isSynced}
                onDownload={() => onDownload(doc.id)}
                onVerify={() => onVerify(doc.id)}
                onRemove={() => onRemove(doc.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyDownloads({ filtered }: { filtered: boolean }) {
  if (filtered)
    return <p className="py-16 text-center text-sm text-fg-muted">No documents match.</p>;
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex size-12 items-center justify-center rounded-md bg-sunken text-fg-subtle">
        <Download className="size-6" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-foreground">Nothing downloaded yet</h2>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">
        Download a document to read it offline. It stays on this computer and opens with no
        connection.
      </p>
    </div>
  );
}
