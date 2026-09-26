import { useEffect, useState } from 'react';
import { Highlighter, Copy, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { menuItemClass, surfaceClass } from '@/lib/ui';

/**
 * A small action menu over a text selection — Highlight, Copy, Search.
 *
 * The reader selects text in the page's text layer (the transparent glyphs PDF.js
 * lays over the canvas); when a selection settles, this floats above it. Keeping
 * a passage is the one write — `note` was retired backend-side — and Search hands
 * the selection to the find bar. Copy uses the clipboard the OS already granted
 * the renderer, no bridge.
 */
export function SelectionMenu({
  containerRef,
  onHighlight,
  onSearch,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  onHighlight: (text: string) => void;
  onSearch: (text: string) => void;
}) {
  const [state, setState] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMouseUp = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? '';
      if (!selection || selection.isCollapsed || text.length === 0) {
        setState(null);
        return;
      }
      // Only react to a selection that began inside the document surface, not one
      // in the sidebar or toolbar.
      const range = selection.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) {
        setState(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const bounds = container.getBoundingClientRect();
      setState({
        x: rect.left - bounds.left + rect.width / 2,
        y: rect.top - bounds.top,
        text,
      });
    };

    container.addEventListener('mouseup', onMouseUp);
    return () => container.removeEventListener('mouseup', onMouseUp);
  }, [containerRef]);

  if (!state) return null;

  const act = (fn: (text: string) => void) => {
    fn(state.text);
    setState(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div
      className={cn(surfaceClass, 'absolute z-40 flex -translate-x-1/2 -translate-y-full gap-0.5')}
      style={{ left: state.x, top: state.y - 8 }}
      role="menu"
    >
      <button className={menuItemClass} onClick={() => act(onHighlight)}>
        <Highlighter className="size-4" />
        Highlight
      </button>
      <button
        className={menuItemClass}
        onClick={() => act((t) => void navigator.clipboard.writeText(t))}
      >
        <Copy className="size-4" />
        Copy
      </button>
      <button className={menuItemClass} onClick={() => act(onSearch)}>
        <Search className="size-4" />
        Search
      </button>
    </div>
  );
}
