import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { DocumentTile } from '../components/document-tile';
import { useDesktopSettings } from '@/features/settings/use-desktop-settings';
import type { LibraryEntry } from '@/features/import/data/pseudo-document';

/**
 * The cover-first grid. Optimised for browsing rather than managing: each
 * document gets room for a real cover. Pages load as the reader scrolls toward
 * the end, so the grid grows without an unbounded first read.
 *
 * Virtualized by row (TanStack Virtual), the same way the dense table view is:
 * only the rows in view mount, so a library of thousands stays a few dozen DOM
 * nodes and — because a tile mints its signed cover URL only while on screen
 * (`onScreen`) — the cover-URL mint volume is proportional to what's visible,
 * not to everything loaded. Row height is a fixed estimate rather than measured
 * per row: every tile in a row is the same width, and per-row measurement would
 * attach a ResizeObserver to each cover image, the remeasure storm that once
 * froze the window.
 */

/** Tailwind breakpoints → column count, matching the classes this grid used
 *  before it was virtualized (2 / 3 / 4 / 5 / 6). */
function columnsForWidth(width: number): number {
  if (width >= 1280) return 6; // xl
  if (width >= 1024) return 5; // lg
  if (width >= 768) return 4; // md
  if (width >= 640) return 3; // sm
  return 2;
}

export function LibraryGrid({
  documents,
  onNearEnd,
}: {
  documents: LibraryEntry[];
  onNearEnd: () => void;
}) {
  const { density } = useDesktopSettings();
  const gap = density === 'compact' ? 12 : 20; // gap-3 / gap-5, in px
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Track the scroll container's width so the column count and row height stay
  // in step with the layout — one ResizeObserver on the container, not per tile.
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columns = width > 0 ? columnsForWidth(width) : 2;
  const tileWidth = width > 0 ? (width - gap * (columns - 1)) / columns : 0;
  // Cover is aspect-[3/4]; the row also carries the gap-2 to the text block and
  // a two-line title/author (plus a slim progress line on started documents).
  // Budget generously so a started tile never overlaps the row beneath it —
  // over-estimating only adds a little whitespace, under-estimating overlaps.
  const rowHeight = tileWidth > 0 ? Math.round((tileWidth * 4) / 3) + 62 + gap : 300;

  const rows = useMemo(() => {
    const chunked: LibraryEntry[][] = [];
    for (let i = 0; i < documents.length; i += columns) {
      chunked.push(documents.slice(i, i + columns));
    }
    return chunked;
  }, [documents, columns]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 4,
  });

  // Re-lay-out when the row height changes (density toggle or a resize that
  // crosses a breakpoint), since the estimate feeds the total size.
  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) onNearEnd();
  };

  return (
    <div ref={parentRef} onScroll={onScroll} className="h-full overflow-auto">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          return (
            <div
              key={item.key}
              data-index={item.index}
              className="absolute top-0 left-0 grid w-full"
              style={{
                transform: `translateY(${item.start}px)`,
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: `${gap}px`,
              }}
            >
              {row.map((document) => (
                <DocumentTile key={document.id} document={document} onScreen />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
