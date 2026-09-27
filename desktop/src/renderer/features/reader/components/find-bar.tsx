import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FindState } from '../data/use-find-in-document';

/**
 * The find-in-document bar: a floating input over the top-right of the surface.
 *
 * It steps through one match per page. The result count and the empty/loading
 * states are spelled out rather than left to a blinking cursor — a document that
 * was never extracted has no text to search, and the bar says exactly that so it
 * does not read as broken.
 */
export function FindBar({ find, onClose }: { find: FindState; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const status = () => {
    if (find.availability === 'loading') return 'Loading…';
    if (find.availability === 'unavailable') return 'No text to search';
    if (find.term.trim().length < 2) return '';
    return find.hits.length === 0 ? 'No matches' : `${find.at + 1} of ${find.hits.length}`;
  };

  const disabled = find.availability !== 'ready' || find.hits.length === 0;

  return (
    <div className="absolute top-3 right-3 z-30 flex items-center gap-1 rounded-md border border-border bg-popover p-1.5 shadow-lg">
      <input
        ref={inputRef}
        value={find.term}
        onChange={(e) => find.setTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.shiftKey ? find.previous : find.next)();
          if (e.key === 'Escape') onClose();
        }}
        placeholder="Find in document"
        aria-label="Find in document"
        className="w-52 rounded-md border border-input bg-elevated px-2.5 py-1 text-sm text-foreground outline-none placeholder:text-fg-subtle focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-focus"
      />
      <span className="min-w-16 px-1 text-center text-xs tabular-nums text-fg-muted">
        {status()}
      </span>
      <FindButton label="Previous match" disabled={disabled} onClick={find.previous}>
        <ChevronUp className="size-4" />
      </FindButton>
      <FindButton label="Next match" disabled={disabled} onClick={find.next}>
        <ChevronDown className="size-4" />
      </FindButton>
      <FindButton label="Close find" onClick={onClose}>
        <X className="size-4" />
      </FindButton>
    </div>
  );
}

function FindButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:text-fg-disabled',
      )}
    >
      {children}
    </button>
  );
}
