import { useMemo, useRef, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronsUpDown, Cloud, HardDrive } from 'lucide-react';
import { DocumentActions } from '../components/document-actions';
import { ProgressLine } from '../components/progress-line';
import { formatBytes, formatProgress, formatRelative } from '@/lib/format';
import { useDesktopSettings } from '@/features/settings/use-desktop-settings';
import { cn } from '@/lib/utils';
import type { LibraryDocument } from '../data/types';

/** Fixed column widths, shared by the header and body so a flex row (needed for
 * virtualization) still aligns like a table. `title` takes the remaining space. */
function columnWidthClass(id: string): string {
  switch (id) {
    case 'title':
      return 'flex-1 min-w-0';
    case 'author':
      return 'w-40 shrink-0';
    case 'pageCount':
      return 'w-16 shrink-0';
    case 'progress':
      return 'w-32 shrink-0';
    case 'createdAt':
    case 'lastOpenedAt':
      return 'w-28 shrink-0';
    case 'storage':
      return 'w-24 shrink-0';
    case 'byteSize':
      return 'w-20 shrink-0';
    case 'actions':
      return 'w-12 shrink-0';
    default:
      return '';
  }
}

/** The dense list. TanStack Table owns sort/filter state (headless); TanStack
 * Virtual mounts only the rows in view, so a library of thousands stays a few
 * dozen DOM nodes. Sorting and the text filter apply to the pages loaded so far;
 * scrolling near the bottom pulls the next page. */
export function LibraryTable({
  documents,
  globalFilter,
  onNearEnd,
}: {
  documents: LibraryDocument[];
  globalFilter: string;
  onNearEnd: () => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }]);
  const { density } = useDesktopSettings();
  const rowHeight = density === 'compact' ? 40 : 48;
  const cellPad = density === 'compact' ? 'py-1.5' : 'py-2';

  const columns = useMemo<ColumnDef<LibraryDocument>[]>(
    () => [
      {
        accessorKey: 'title',
        header: 'Title',
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-foreground">{row.original.title}</span>
          </div>
        ),
      },
      {
        accessorKey: 'author',
        header: 'Author',
        cell: ({ getValue }) => (
          <span className="truncate text-fg-muted">{(getValue() as string | null) ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'pageCount',
        header: 'Pages',
        cell: ({ getValue }) => (
          <span className="tabular-nums text-fg-muted">{(getValue() as number | null) ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'progress',
        header: 'Progress',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <ProgressLine progress={row.original.progress} className="w-16" />
            <span className="tabular-nums text-xs text-fg-muted">
              {formatProgress(row.original.progress)}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: 'Added',
        cell: ({ getValue }) => (
          <span className="text-fg-muted">{formatRelative(getValue() as number) ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'lastOpenedAt',
        header: 'Last opened',
        cell: ({ getValue }) => (
          <span className="text-fg-muted">
            {formatRelative(getValue() as number | null) ?? '—'}
          </span>
        ),
      },
      {
        id: 'storage',
        accessorFn: (row) => (row.isSynced ? 1 : 0),
        header: 'Where',
        cell: ({ row }) =>
          row.original.isSynced ? (
            <span className="inline-flex items-center gap-1.5 text-fg-muted">
              <Cloud className="size-3.5" /> Cloud
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-fg-muted">
              <HardDrive className="size-3.5" /> Device
            </span>
          ),
      },
      {
        accessorKey: 'byteSize',
        header: 'Size',
        cell: ({ getValue }) => (
          <span className="tabular-nums text-fg-muted">{formatBytes(getValue() as number)}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => <DocumentActions document={row.original} />,
      },
    ],
    [],
  );

  const table = useReactTable({
    data: documents,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const rows = table.getRowModel().rows;
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  const items = virtualizer.getVirtualItems();
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) onNearEnd();
  };

  return (
    <div ref={parentRef} onScroll={onScroll} className="h-full overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-surface">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="flex w-full shadow-[inset_0_-1px_0_rgb(var(--border))]">
              {group.headers.map((header) => {
                const sortable = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    className={cn(
                      'px-3 py-2 text-xs font-medium text-fg-subtle',
                      columnWidthClass(header.column.id),
                      sortable && 'cursor-pointer select-none',
                    )}
                    onClick={sortable ? header.column.getToggleSortingHandler() : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sortable &&
                        (sorted === 'asc' ? (
                          <ArrowUp className="size-3" />
                        ) : sorted === 'desc' ? (
                          <ArrowDown className="size-3" />
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-40" />
                        ))}
                    </span>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
            display: 'block',
          }}
        >
          {items.map((item) => {
            const row = rows[item.index];
            return (
              <tr
                key={row.id}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="flex w-full items-center shadow-[inset_0_-1px_0_rgb(var(--hairline))] hover:bg-hover"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={cn('truncate px-3', cellPad, columnWidthClass(cell.column.id))}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
