import { DocumentTile } from '../components/document-tile';
import { useDesktopSettings } from '@/features/settings/use-desktop-settings';
import { cn } from '@/lib/utils';
import type { LibraryDocument } from '../data/types';

/**
 * The cover-first grid. Optimised for browsing rather than managing: each
 * document gets room for a real cover. Pages load as the reader scrolls toward
 * the end, so the grid grows without an unbounded first read.
 */
export function LibraryGrid({
  documents,
  onNearEnd,
}: {
  documents: LibraryDocument[];
  onNearEnd: () => void;
}) {
  const { density } = useDesktopSettings();
  return (
    <div
      className="h-full overflow-auto"
      onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) onNearEnd();
      }}
    >
      <div
        className={cn(
          'grid grid-cols-2 pb-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
          density === 'compact' ? 'gap-3' : 'gap-5',
        )}
      >
        {documents.map((document) => (
          <DocumentTile key={document.id} document={document} />
        ))}
      </div>
    </div>
  );
}
