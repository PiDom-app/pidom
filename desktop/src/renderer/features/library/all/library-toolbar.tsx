import { Popover, ToggleGroup } from 'radix-ui';
import { Check, LayoutGrid, List, ListFilter, Search } from 'lucide-react';
import { surfaceClass } from '@/lib/ui';
import { cn } from '@/lib/utils';

export type LibraryFilter = 'all' | 'favorites' | 'finished' | 'cloud' | 'device';

const FILTERS: { value: LibraryFilter; label: string }[] = [
  { value: 'all', label: 'All documents' },
  { value: 'favorites', label: 'Favorites' },
  { value: 'finished', label: 'Finished' },
  { value: 'cloud', label: 'In the cloud' },
  { value: 'device', label: 'On this device only' },
];

/**
 * The Library view's controls: a text filter, a filter popover, and the
 * grid/list toggle. Sits in the page flow under the header, not in a bar.
 */
export function LibraryToolbar({
  view,
  onViewChange,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  count,
}: {
  view: 'grid' | 'list';
  onViewChange: (view: 'grid' | 'list') => void;
  filter: LibraryFilter;
  /** Omitted when the screen locks the filter (Favorites, Finished). */
  onFilterChange?: (filter: LibraryFilter) => void;
  query: string;
  onQueryChange: (query: string) => void;
  count: number;
}) {
  const activeFilterLabel = FILTERS.find((f) => f.value === filter)?.label ?? 'All documents';

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <div className="flex min-w-52 flex-1 items-center gap-2 rounded-md border border-border bg-elevated px-3 focus-within:border-border-strong focus-within:ring-2 focus-within:ring-focus">
        <Search className="size-4 text-fg-subtle" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Filter by title or author"
          className="w-full bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-fg-subtle"
        />
      </div>

      {onFilterChange && (
        <Popover.Root>
          <Popover.Trigger className="flex items-center gap-2 rounded-md border border-border bg-elevated px-3 py-2 text-sm text-foreground outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-hover">
            <ListFilter className="size-4 text-fg-muted" />
            {activeFilterLabel}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className={surfaceClass} align="end" sideOffset={4}>
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => onFilterChange(f.value)}
                  className="flex w-full items-center justify-between gap-6 rounded-md px-2 py-1.5 text-left text-sm text-foreground outline-none hover:bg-hover focus-visible:bg-hover"
                >
                  {f.label}
                  {filter === f.value && <Check className="size-4 text-primary" />}
                </button>
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}

      <span className="text-xs text-fg-subtle tabular-nums">{count}</span>

      <ToggleGroup.Root
        type="single"
        value={view}
        onValueChange={(value) => value && onViewChange(value as 'grid' | 'list')}
        className="flex items-center rounded-md border border-border bg-elevated p-0.5"
        aria-label="Library view"
      >
        <ToggleGroup.Item value="grid" aria-label="Grid view" className={toggleItemClass}>
          <LayoutGrid className="size-4" />
        </ToggleGroup.Item>
        <ToggleGroup.Item value="list" aria-label="List view" className={toggleItemClass}>
          <List className="size-4" />
        </ToggleGroup.Item>
      </ToggleGroup.Root>
    </div>
  );
}

const toggleItemClass = cn(
  'flex size-7 items-center justify-center rounded-md text-fg-muted outline-none transition-colors',
  'hover:text-foreground data-[state=on]:bg-hover data-[state=on]:text-foreground focus-visible:ring-2 focus-visible:ring-focus',
);
