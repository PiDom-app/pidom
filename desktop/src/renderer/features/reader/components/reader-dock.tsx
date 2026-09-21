import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Popover, Toolbar, ToggleGroup, Tooltip } from 'radix-ui';
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Minus,
  MoreHorizontal,
  PanelLeft,
  Plus,
  ScrollText,
  Search,
  Square,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { surfaceClass } from '@/lib/ui';
import type { Fit, ViewMode } from '../data/use-reader-view';

/**
 * The reader's controls, as a floating bottom-centred dock rather than a top
 * strip — the document is the whole surface and the dock rides above its bottom
 * edge, macOS-style. Actions are grouped into clusters (navigate · page · zoom ·
 * layout · tools) with a hairline divider between clusters and no gap inside one.
 * A single pill glides under the active layout mode. Solid surface, one border,
 * 6px corners, soft shadow — no glass or gradient, per the layout law.
 *
 * It is still a Radix `Toolbar` (keyboard roving, button semantics); Radix places
 * no constraint on where a toolbar sits, so the dock is pure layout. Tooltips
 * open upward so they never land on the page behind the dock.
 */

/** An icon control with an accessible label and a tooltip carrying the same text. */
export function IconButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Toolbar.Button
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'inline-flex size-9 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:text-fg-disabled',
            active && 'bg-primary-tint text-primary hover:bg-primary-tint hover:text-primary',
          )}
        >
          {children}
        </Toolbar.Button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={8}
          className="z-50 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-foreground shadow-md"
        >
          {label}
          <Tooltip.Arrow className="fill-elevated" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** A hairline divider between two clusters. */
function Divider() {
  return <Toolbar.Separator className="mx-1 h-5.5 w-px bg-hairline" />;
}

const modeIcon: Record<ViewMode, ReactNode> = {
  continuous: <ScrollText className="size-4" />,
  single: <Square className="size-4" />,
  spread: <Columns2 className="size-4" />,
};

const modeLabel: Record<ViewMode, string> = {
  continuous: 'Continuous',
  single: 'Single page',
  spread: 'Two-page spread',
};

const fitLabel: Record<Fit, string> = {
  'fit-width': 'Fit width',
  'fit-page': 'Fit page',
  auto: 'Auto',
  manual: 'Custom',
};

const MODES = ['continuous', 'single', 'spread'] as const;

export function ReaderDock({
  currentPage,
  pageCount,
  mode,
  fit,
  scalePercent,
  sidebarOpen,
  isBookmarked,
  onBack,
  onToggleSidebar,
  onPrev,
  onNext,
  onJump,
  onSetMode,
  onCycleFit,
  onZoomIn,
  onZoomOut,
  onToggleBookmark,
  onToggleFind,
}: {
  currentPage: number;
  pageCount: number;
  mode: ViewMode;
  fit: Fit;
  scalePercent: number;
  sidebarOpen: boolean;
  isBookmarked: boolean;
  onBack: () => void;
  onToggleSidebar: () => void;
  onPrev: () => void;
  onNext: () => void;
  onJump: (page: number) => void;
  onSetMode: (mode: ViewMode) => void;
  onCycleFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleBookmark: () => void;
  onToggleFind: () => void;
}) {
  return (
    <Toolbar.Root
      aria-label="Reader controls"
      className="pointer-events-auto flex h-12 items-center gap-1.5 rounded-md border border-border bg-surface p-1.5 shadow-[0_8px_28px_rgb(var(--overlay)/0.34),0_2px_6px_rgb(var(--overlay)/0.2)]"
    >
      {/* navigate */}
      <div className="flex items-center gap-0.5">
        <IconButton label="Back to library" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </IconButton>
        <IconButton
          label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          active={sidebarOpen}
          onClick={onToggleSidebar}
        >
          <PanelLeft className="size-4" />
        </IconButton>
      </div>

      <Divider />

      {/* page */}
      <div className="flex items-center gap-0.5">
        <IconButton label="Previous page" disabled={currentPage <= 1} onClick={onPrev}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <PageJump currentPage={currentPage} pageCount={pageCount} onJump={onJump} />
        <IconButton
          label="Next page"
          disabled={pageCount > 0 && currentPage >= pageCount}
          onClick={onNext}
        >
          <ChevronRight className="size-4" />
        </IconButton>
      </div>

      <Divider />

      {/* zoom */}
      <div className="flex items-center gap-0.5">
        <IconButton label="Zoom out" onClick={onZoomOut}>
          <Minus className="size-4" />
        </IconButton>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Toolbar.Button
              aria-label={`Fit: ${fitLabel[fit]}. Click to change.`}
              onClick={onCycleFit}
              className="inline-flex h-9 min-w-13 items-center justify-center rounded-md px-2 text-xs tabular-nums text-fg-muted outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
            >
              {fit === 'manual' ? `${scalePercent}%` : fitLabel[fit]}
            </Toolbar.Button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="top"
              sideOffset={8}
              className="z-50 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-foreground shadow-md"
            >
              Cycle fit
              <Tooltip.Arrow className="fill-elevated" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <IconButton label="Zoom in" onClick={onZoomIn}>
          <Plus className="size-4" />
        </IconButton>
      </div>

      <Divider />

      {/* layout — the gliding pill lives here */}
      <LayoutGroup mode={mode} onSetMode={onSetMode} />

      <Divider />

      {/* tools */}
      <div className="flex items-center gap-0.5">
        <IconButton label="Find in document" onClick={onToggleFind}>
          <Search className="size-4" />
        </IconButton>
        <IconButton
          label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
          active={isBookmarked}
          onClick={onToggleBookmark}
        >
          {isBookmarked ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
        </IconButton>
        <IconButton label="More">
          <MoreHorizontal className="size-4" />
        </IconButton>
      </div>
    </Toolbar.Root>
  );
}

/**
 * The layout ToggleGroup with a pill that slides under the active mode.
 *
 * The pill is one absolutely-positioned element measured from the active item's
 * box, so switching modes animates a single glide rather than three buttons
 * fading. Measured in a layout effect against the real DOM so it survives font
 * and zoom differences instead of assuming a fixed item width.
 */
function LayoutGroup({ mode, onSetMode }: { mode: ViewMode; onSetMode: (mode: ViewMode) => void }) {
  const groupRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<ViewMode, HTMLButtonElement | null>>({
    continuous: null,
    single: null,
    spread: null,
  });
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const active = itemRefs.current[mode];
    const group = groupRef.current;
    if (!active || !group) return;
    setPill({ left: active.offsetLeft, width: active.offsetWidth });
  }, [mode]);

  return (
    <ToggleGroup.Root
      ref={groupRef}
      type="single"
      value={mode}
      onValueChange={(value) => value && onSetMode(value as ViewMode)}
      aria-label="Page layout"
      className="relative flex items-center gap-0.5"
    >
      {pill && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 h-9 rounded-md bg-primary-tint transition-[left,width] duration-300 ease-[cubic-bezier(0.34,1.2,0.4,1)]"
          style={{ left: pill.left, width: pill.width }}
        />
      )}
      {MODES.map((value) => (
        <Tooltip.Root key={value}>
          <Tooltip.Trigger asChild>
            <ToggleGroup.Item
              ref={(el) => {
                itemRefs.current[value] = el;
              }}
              value={value}
              aria-label={modeLabel[value]}
              className="relative z-1 inline-flex size-9 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus data-[state=on]:text-primary"
            >
              {modeIcon[value]}
            </ToggleGroup.Item>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="top"
              sideOffset={8}
              className="z-50 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-foreground shadow-md"
            >
              {modeLabel[value]}
              <Tooltip.Arrow className="fill-elevated" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      ))}
    </ToggleGroup.Root>
  );
}

/** The page indicator, which opens a bounded jump input on click. */
function PageJump({
  currentPage,
  pageCount,
  onJump,
}: {
  currentPage: number;
  pageCount: number;
  onJump: (page: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  const commit = () => {
    const page = Number(value);
    if (Number.isInteger(page) && page >= 1 && (pageCount === 0 || page <= pageCount)) {
      onJump(page);
      setOpen(false);
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setValue(String(currentPage));
      }}
    >
      <Popover.Trigger asChild>
        <Toolbar.Button
          aria-label="Jump to page"
          className="inline-flex h-9 items-center rounded-md px-2.5 text-sm tabular-nums text-foreground outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus"
        >
          {currentPage}
          {pageCount > 0 && <span className="text-fg-subtle">&nbsp;/&nbsp;{pageCount}</span>}
        </Toolbar.Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={8}
          className={cn(surfaceClass, 'flex items-center gap-2 p-2')}
        >
          <input
            autoFocus
            type="number"
            min={1}
            max={pageCount || undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setOpen(false);
            }}
            className="w-20 rounded-md border border-input bg-elevated px-2 py-1 text-sm tabular-nums text-foreground outline-none focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-focus"
            aria-label="Page number"
          />
          <button
            onClick={commit}
            className="rounded-md bg-primary px-2.5 py-1 text-sm font-medium text-primary-foreground outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus"
          >
            Go
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
