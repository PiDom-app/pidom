import { Loader2, Search } from 'lucide-react';
import { openCommandSearch, useSearchLoading } from '@/features/library/components/command-search';

/**
 * The global search, centred in the title bar. It is the single entry point to
 * the command palette (see `command-search`): a click opens the same palette the
 * whole app shares. A spinner appears while the library's first page is still
 * loading, so the pill reflects search readiness in real time.
 *
 * `no-app-drag` opts the pill out of the surrounding title-bar drag region so it
 * stays clickable. The 999px radius is a deliberate, isolated exception to the
 * app's 6px corner rule — this one control is a pill on purpose.
 */
export function TitlebarSearch() {
  const loading = useSearchLoading();
  return (
    <button
      type="button"
      onClick={openCommandSearch}
      aria-label="Search your library"
      className="no-app-drag flex h-7 w-full items-center gap-2 rounded-[999px] border border-border bg-elevated pr-3 pl-3.5 text-sm text-fg-muted outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
    >
      <Search className="size-4 shrink-0" />
      <span className="truncate">Search titles and authors…</span>
      {loading && <Loader2 className="ml-auto size-4 shrink-0 animate-spin text-fg-subtle" />}
    </button>
  );
}
