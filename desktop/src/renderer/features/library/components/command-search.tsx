import { useEffect, useSyncExternalStore } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from '@tanstack/react-router';
import {
  BookmarkCheck,
  Download,
  FilePlus2,
  FolderClosed,
  FolderPlus,
  Home,
  Library,
  Search,
  SearchX,
  Settings,
  Star,
} from 'lucide-react';
import { useImports } from '@/features/import/data/use-imports';
import { useAllLibrary } from '../data/use-all-library';

/**
 * A command / search surface, opened from the title-bar search pill. It searches
 * the library by title and author (cmdk does the fuzzy match) and doubles as a
 * keyboard route switcher — the desktop way to move without reaching for the
 * mouse.
 */

// A tiny module store so any button can open the palette without threading state
// through the tree.
let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openCommandSearch(): void {
  open = true;
  emit();
}
function setOpen(next: boolean): void {
  open = next;
  emit();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const getOpen = () => open;

// The library's first-page load drives the title-bar search spinner. The palette
// owns the query (below); the pill only reads this flag.
let searching = false;
function setSearching(next: boolean): void {
  if (searching === next) return;
  searching = next;
  emit();
}
const getSearching = () => searching;

/** Whether the library is still loading — drives the title-bar search spinner. */
export function useSearchLoading(): boolean {
  return useSyncExternalStore(subscribe, getSearching, getSearching);
}

const NAV_COMMANDS = [
  { label: 'Home', to: '/home', icon: Home },
  { label: 'Library', to: '/library', icon: Library },
  { label: 'Collections', to: '/collections', icon: FolderClosed },
  { label: 'Favorites', to: '/favorites', icon: Star },
  { label: 'Finished', to: '/finished', icon: BookmarkCheck },
  { label: 'Downloads', to: '/downloads', icon: Download },
  { label: 'Settings', to: '/settings', icon: Settings },
] as const;

export function CommandSearch() {
  const isOpen = useSyncExternalStore(subscribe, getOpen, getOpen);
  const navigate = useNavigate();
  const { documents, isLoading } = useAllLibrary();
  const { pickFiles, pickFolder } = useImports();

  // Mirror the library's loading state into the store so the title-bar search
  // pill can show a spinner while results are still coming in, and clear it on
  // unmount so a stale spinner never outlives the palette.
  useEffect(() => {
    setSearching(isLoading);
  }, [isLoading]);
  useEffect(() => () => setSearching(false), []);

  const go = (to: string) => {
    setOpen(false);
    void navigate({ to });
  };

  const run = (action: () => Promise<void>) => {
    setOpen(false);
    void action();
  };

  return (
    <Command.Dialog
      open={isOpen}
      onOpenChange={setOpen}
      label="Search your library"
      // The className styles cmdk's inner root, which we stretch to a full-screen
      // scrim. cmdk mounts that root *inside* Radix's dialog content, so Radix's
      // own click-outside never fires on it — a press on the scrim (never on the
      // card, which is a child) dismisses the palette. Escape still closes it too.
      className="fixed inset-0 z-50 flex items-start justify-center bg-overlay/50 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="animate-slide-up w-[36rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-border bg-elevated shadow-lg">
        <div className="flex items-center gap-2 px-3 shadow-[inset_0_-1px_0_rgb(var(--hairline))]">
          <Search className="size-4 text-fg-subtle" />
          <Command.Input
            placeholder="Search titles and authors, or jump to a page…"
            className="w-full bg-transparent py-3 text-sm text-foreground outline-none placeholder:text-fg-subtle"
          />
        </div>
        <Command.List className="max-h-[22rem] overflow-y-auto p-2">
          <Command.Empty className="flex flex-col items-center gap-2 px-2 py-10 text-center">
            <SearchX className="size-6 text-fg-subtle" />
            <p className="text-sm text-foreground">No matches found</p>
            <p className="text-xs text-fg-muted">Try a different title or author.</p>
          </Command.Empty>

          <Command.Group
            heading="Go to"
            className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
          >
            {NAV_COMMANDS.map(({ label, to, icon: Icon }) => (
              <Command.Item
                key={to}
                value={`go ${label}`}
                onSelect={() => go(to)}
                className="flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground data-[selected=true]:bg-hover"
              >
                <Icon className="size-4 text-fg-muted" />
                {label}
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group
            heading="Import"
            className="mt-1 text-2xs font-semibold tracking-wide text-fg-subtle uppercase [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
          >
            <Command.Item
              value="import files"
              onSelect={() => run(pickFiles)}
              className="flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground data-[selected=true]:bg-hover"
            >
              <FilePlus2 className="size-4 text-fg-muted" />
              Import files…
            </Command.Item>
            <Command.Item
              value="import folder"
              onSelect={() => run(pickFolder)}
              className="flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground data-[selected=true]:bg-hover"
            >
              <FolderPlus className="size-4 text-fg-muted" />
              Import folder…
            </Command.Item>
          </Command.Group>

          {documents.length > 0 && (
            <Command.Group
              heading="Documents"
              className="mt-1 text-2xs font-semibold tracking-wide text-fg-subtle uppercase [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              {documents.map((document) => (
                <Command.Item
                  key={document.id}
                  value={`${document.title} ${document.author ?? ''}`}
                  onSelect={() => go('/library')}
                  className="flex cursor-default items-center justify-between gap-3 rounded-md px-2 py-2 text-sm text-foreground data-[selected=true]:bg-hover"
                >
                  <span className="truncate">{document.title}</span>
                  {document.author && (
                    <span className="shrink-0 truncate text-xs text-fg-subtle">
                      {document.author}
                    </span>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
