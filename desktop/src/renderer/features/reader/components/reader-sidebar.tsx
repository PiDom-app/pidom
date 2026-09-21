import { ScrollArea, Tabs } from 'radix-ui';
import { Bookmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import { edgeRight } from '@/lib/ui';
import { THUMBNAIL_PAGE_MAX } from '@convex-model/limits';
import type { PDFDocumentProxy } from '../pdf/engine';
import type { OutlineEntry } from '../data/use-outline';
import type { Bookmark as BookmarkEntry } from '../data/use-bookmarks';
import { ThumbnailStrip } from './thumbnail-strip';

/**
 * The document navigator: Contents, Pages, and Bookmarks, one tab each.
 *
 * Contents is the PDF's own outline (empty for a document that has none). Pages
 * is a virtualized thumbnail strip, offered only up to `THUMBNAIL_PAGE_MAX` —
 * past that a thumbnail per page is a great deal of rendering to scroll past
 * nothing, and the toolbar's jump reaches any page regardless. Bookmarks are the
 * account's, the same list the toolbar toggles.
 */
export function ReaderSidebar({
  doc,
  pageCount,
  currentPage,
  outline,
  bookmarks,
  onJump,
}: {
  doc: PDFDocumentProxy;
  pageCount: number;
  currentPage: number;
  outline: OutlineEntry[] | undefined;
  bookmarks: BookmarkEntry[];
  onJump: (page: number) => void;
}) {
  const tabClass =
    'flex-1 rounded-md px-2 py-1.5 text-xs font-medium text-fg-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus data-[state=active]:bg-hover data-[state=active]:text-foreground';

  return (
    <aside className={cn('flex w-64 shrink-0 flex-col bg-surface', edgeRight)}>
      <Tabs.Root defaultValue="contents" className="flex min-h-0 flex-1 flex-col">
        <Tabs.List className="flex gap-1 p-2" aria-label="Document navigator">
          <Tabs.Trigger value="contents" className={tabClass}>
            Contents
          </Tabs.Trigger>
          <Tabs.Trigger value="pages" className={tabClass}>
            Pages
          </Tabs.Trigger>
          <Tabs.Trigger value="bookmarks" className={tabClass}>
            Bookmarks
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="contents" className="min-h-0 flex-1 outline-none">
          <OutlinePanel outline={outline} currentPage={currentPage} onJump={onJump} />
        </Tabs.Content>
        <Tabs.Content value="pages" className="min-h-0 flex-1 outline-none">
          {pageCount <= THUMBNAIL_PAGE_MAX ? (
            <ThumbnailStrip
              doc={doc}
              pageCount={pageCount}
              currentPage={currentPage}
              onJump={onJump}
            />
          ) : (
            <p className="p-4 text-xs text-fg-subtle">
              This document is too long for a thumbnail strip. Use the page jump in the toolbar.
            </p>
          )}
        </Tabs.Content>
        <Tabs.Content value="bookmarks" className="min-h-0 flex-1 outline-none">
          <BookmarksPanel bookmarks={bookmarks} currentPage={currentPage} onJump={onJump} />
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}

function OutlinePanel({
  outline,
  currentPage,
  onJump,
}: {
  outline: OutlineEntry[] | undefined;
  currentPage: number;
  onJump: (page: number) => void;
}) {
  if (outline === undefined) return <p className="p-4 text-xs text-fg-subtle">Loading…</p>;
  if (outline.length === 0)
    return <p className="p-4 text-xs text-fg-subtle">This document has no contents.</p>;

  return (
    <ScrollArea.Root className="h-full">
      <ScrollArea.Viewport className="h-full">
        <ul className="p-2">
          {outline.map((entry, index) => (
            <li key={`${entry.page}-${index}`}>
              <button
                onClick={() => onJump(entry.page)}
                style={{ paddingLeft: 8 + entry.depth * 12 }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md py-1.5 pr-2 text-left text-sm outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus',
                  entry.page === currentPage ? 'text-foreground' : 'text-fg-muted',
                )}
              >
                <span className="min-w-0 truncate">{entry.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{entry.page}</span>
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical" className="flex w-2 touch-none p-0.5">
        <ScrollArea.Thumb className="flex-1 rounded-full bg-border-strong" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}

function BookmarksPanel({
  bookmarks,
  currentPage,
  onJump,
}: {
  bookmarks: BookmarkEntry[];
  currentPage: number;
  onJump: (page: number) => void;
}) {
  if (bookmarks.length === 0) {
    return (
      <p className="p-4 text-xs text-fg-subtle">No bookmarks yet. Mark a page from the toolbar.</p>
    );
  }

  return (
    <ScrollArea.Root className="h-full">
      <ScrollArea.Viewport className="h-full">
        <ul className="p-2">
          {bookmarks.map((bookmark) => (
            <li key={bookmark.page}>
              <button
                onClick={() => onJump(bookmark.page)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus',
                  bookmark.page === currentPage ? 'text-foreground' : 'text-fg-muted',
                )}
              >
                <Bookmark className="size-3.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">
                  {bookmark.label ?? `Page ${bookmark.page}`}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
                  {bookmark.page}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical" className="flex w-2 touch-none p-0.5">
        <ScrollArea.Thumb className="flex-1 rounded-full bg-border-strong" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}
