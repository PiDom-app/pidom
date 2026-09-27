import { useState } from 'react';
import { useCoverUrl } from '../data/use-cover-url';
import { cn } from '@/lib/utils';
import type { LibraryDocument } from '../data/types';

/** The two initials a coverless document falls back to. */
function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * A document's cover. The strongest visual anchor on a tile or row: the real
 * cover when the document has one and is on screen (minted lazily), a neutral
 * lettered placeholder otherwise. Solid surface, 6px radius, restrained border —
 * no glass or elevation.
 */
export function DocumentCover({
  document,
  enabled = true,
  className,
}: {
  document: LibraryDocument;
  /** Gate the signed-URL mint until the cover is actually on screen. */
  enabled?: boolean;
  className?: string;
}) {
  const url = useCoverUrl(document.id, enabled && document.hasCover);
  const [failed, setFailed] = useState(false);
  const showImage = document.hasCover && url && !failed;

  return (
    <div
      className={cn(
        'relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-md border border-border bg-sunken',
        className,
      )}
    >
      {showImage ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
          draggable={false}
        />
      ) : (
        <span className="text-lg font-semibold text-fg-subtle select-none">
          {initials(document.title)}
        </span>
      )}
    </div>
  );
}
