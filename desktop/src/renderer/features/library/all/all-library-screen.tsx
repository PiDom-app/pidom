import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { useDesktopSettings, desktopSettings } from '@/features/settings/use-desktop-settings';
import { ImportMenu } from '@/features/import/components/import-menu';
import { ImportDropZone } from '@/features/import/components/import-drop-zone';
import { useAllLibrary } from '../data/use-all-library';
import { useSelection, type DocumentId } from '../data/use-selection';
import { EmptyLibrary } from '../components/empty-library';
import { SyncStatusChip } from '../components/sync-status-chip';
import { LibraryGrid } from './library-grid';
import { LibraryTable } from './library-table';
import { LibraryToolbar, type LibraryFilter } from './library-toolbar';
import { SelectionToolbar } from './selection-toolbar';
import type { LibraryEntry } from '@/features/import/data/pseudo-document';

function matches(document: LibraryEntry, filter: LibraryFilter, query: string): boolean {
  if (filter === 'favorites' && !document.isFavorite) return false;
  if (filter === 'finished' && !document.isFinished) return false;
  if (filter === 'cloud' && !document.isSynced) return false;
  if (filter === 'device' && document.isSynced) return false;
  if (query) {
    const haystack = `${document.title} ${document.author ?? ''}`.toLowerCase();
    if (!haystack.includes(query.toLowerCase())) return false;
  }
  return true;
}

/**
 * The full Library screen, reused by the Favorites and Finished routes with a
 * locked filter. Grid or dense list, a text filter, and category filters —
 * documents stay the primary objects, and the view choice persists locally.
 */
export function AllLibraryScreen({
  title,
  subtitle,
  lockedFilter,
}: {
  title: string;
  subtitle?: string;
  /** When set, the screen shows only this category and hides the filter control. */
  lockedFilter?: LibraryFilter;
}) {
  const settings = useDesktopSettings();
  const view = settings.libraryView;
  const isListView = view === 'list';
  const { documents, status, loadMoreDefault } = useAllLibrary();

  const [filter, setFilter] = useState<LibraryFilter>(lockedFilter ?? 'all');
  const [query, setQuery] = useState('');

  const effectiveFilter = lockedFilter ?? filter;
  const filtered = useMemo(
    () => documents.filter((d) => matches(d, effectiveFilter, query)),
    [documents, effectiveFilter, query],
  );

  const selection = useSelection();

  // Only real (synced) documents can be organised — a still-importing local
  // file has a device-minted id the account does not know. Range selection and
  // select-all run against this order, the on-screen order after filter/sort.
  const selectableIds = useMemo<DocumentId[]>(
    () => filtered.filter((d) => !d.importJob).map((d) => d.id),
    [filtered],
  );
  const selectedDocuments = useMemo(
    () => filtered.filter((d) => !d.importJob && selection.isSelected(d.id)),
    [filtered, selection],
  );

  // Escape clears a live selection, the expected way out of selection mode.
  useEffect(() => {
    if (!selection.active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selection.clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);

  useEffect(() => {
    if (!isListView && selection.active) selection.clear();
  }, [isListView, selection.active, selection.clear]);

  const onNearEnd = () => {
    if (status === 'CanLoadMore') loadMoreDefault();
  };

  const firstLoad = status === 'LoadingFirstPage';

  return (
    <ImportDropZone>
      <div className="flex h-full flex-col px-8 py-8">
        <PageHeader title={title} subtitle={subtitle}>
          {status !== 'LoadingFirstPage' && (
            <span className="text-xs text-fg-subtle">
              {status === 'Exhausted' ? `${documents.length} in library` : 'Loading…'}
            </span>
          )}
          <SyncStatusChip />
          <ImportMenu />
        </PageHeader>

        {isListView && selection.active ? (
          <SelectionToolbar
            count={selection.count}
            selectedDocuments={selectedDocuments}
            onClear={selection.clear}
          />
        ) : (
          <LibraryToolbar
            view={view}
            onViewChange={desktopSettings.setLibraryView}
            filter={effectiveFilter}
            onFilterChange={lockedFilter ? undefined : setFilter}
            query={query}
            onQueryChange={setQuery}
            count={filtered.length}
          />
        )}

        <div className="min-h-0 flex-1">
          {firstLoad ? (
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="aspect-[3/4] rounded-md bg-sunken" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            query || effectiveFilter !== 'all' ? (
              <p className="py-16 text-center text-sm text-fg-muted">No documents match.</p>
            ) : (
              <EmptyLibrary />
            )
          ) : view === 'grid' ? (
            <LibraryGrid documents={filtered} onNearEnd={onNearEnd} />
          ) : (
            <LibraryTable
              documents={filtered}
              globalFilter=""
              onNearEnd={onNearEnd}
              selection={selection}
              selectableIds={selectableIds}
            />
          )}
        </div>
      </div>
    </ImportDropZone>
  );
}
