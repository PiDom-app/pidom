import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { openCommandSearch } from '@/features/library/components/command-search';
import { cn } from '@/lib/utils';

/**
 * The compact header every workspace page shares: a title, an optional subtitle,
 * a search trigger that opens the command palette, and room for page-specific
 * controls. It sits directly in the page flow — a heading and a row of controls,
 * not a bar in a box.
 */
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {children}
        <SearchTrigger />
      </div>
    </header>
  );
}

function SearchTrigger({ className }: { className?: string }) {
  const isMac = window.pidom?.platform?.os === 'darwin';
  return (
    <button
      onClick={openCommandSearch}
      className={cn(
        'flex items-center gap-2 rounded-md border border-border bg-elevated py-2 pr-2 pl-3 text-sm text-fg-muted outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus',
        className,
      )}
    >
      <Search className="size-4" />
      <span>Search</span>
      <kbd className="rounded-md border border-border bg-sunken px-1.5 py-0.5 text-2xs text-fg-subtle">
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>
    </button>
  );
}
