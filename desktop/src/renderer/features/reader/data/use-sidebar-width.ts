import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A draggable width for the reader sidebar, remembered on this machine.
 *
 * The sidebar holds contents, thumbnails, and bookmarks — a long title or a wide
 * thumbnail wants more room, a small screen wants less — so the reader drags the
 * divider to fit and the choice sticks. Width is per-device (localStorage), not
 * account state: it is about this window's size, not the document.
 */

const KEY = 'pidom.reader.sidebarWidth';
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 256;

function clamp(width: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width));
}

export interface SidebarWidth {
  width: number;
  /** Bind to the drag handle's onPointerDown; tracks the divider until release. */
  onResizeStart: (event: React.PointerEvent) => void;
  resizing: boolean;
}

export function useSidebarWidth(): SidebarWidth {
  const [width, setWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(KEY));
    return Number.isFinite(stored) && stored > 0 ? clamp(stored) : SIDEBAR_DEFAULT;
  });
  const [resizing, setResizing] = useState(false);
  const start = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    localStorage.setItem(KEY, String(width));
  }, [width]);

  const onResizeStart = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      start.current = { x: event.clientX, width };
      setResizing(true);

      const onMove = (e: PointerEvent) => {
        if (!start.current) return;
        setWidth(clamp(start.current.width + (e.clientX - start.current.x)));
      };
      const onUp = () => {
        start.current = null;
        setResizing(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [width],
  );

  return { width, onResizeStart, resizing };
}
