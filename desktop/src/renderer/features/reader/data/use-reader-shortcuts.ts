import { useEffect } from 'react';

/**
 * The reader's keyboard shortcuts, bound at the route rather than the app menu.
 *
 * They belong to the document that is open and mean nothing elsewhere, so they
 * live and die with the reader screen. A shortcut is ignored while the reader is
 * typing — into the find bar, the page-jump input, a bookmark label — so a space
 * in a search term does not also turn the page.
 */
export interface ReaderShortcutHandlers {
  onPrev: () => void;
  onNext: () => void;
  onFirst: () => void;
  onLast: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleSidebar: () => void;
  onToggleFind: () => void;
  onBookmark: () => void;
  onToggleToolbar: () => void;
  onClose: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function useReaderShortcuts(handlers: ReaderShortcutHandlers): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;

      // Find and close work even while typing — Escape leaves the field, and the
      // Find accelerator refocuses it.
      if (mod && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        handlers.onToggleFind();
        return;
      }
      if (event.key === 'Escape') {
        handlers.onClose();
        return;
      }

      if (isTyping(event.target)) return;

      if (mod && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        handlers.onZoomIn();
        return;
      }
      if (mod && event.key === '-') {
        event.preventDefault();
        handlers.onZoomOut();
        return;
      }

      switch (event.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          event.preventDefault();
          handlers.onNext();
          break;
        case 'ArrowLeft':
        case 'PageUp':
          event.preventDefault();
          handlers.onPrev();
          break;
        case 'Home':
          event.preventDefault();
          handlers.onFirst();
          break;
        case 'End':
          event.preventDefault();
          handlers.onLast();
          break;
        case 'b':
        case 'B':
          handlers.onToggleSidebar();
          break;
        case 'd':
        case 'D':
          handlers.onBookmark();
          break;
        case 't':
        case 'T':
          handlers.onToggleToolbar();
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}
