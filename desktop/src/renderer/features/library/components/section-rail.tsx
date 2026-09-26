import { ScrollArea } from 'radix-ui';
import { Link } from '@tanstack/react-router';
import { DocumentTile } from './document-tile';
import type { LibraryDocument } from '../data/types';

/**
 * A horizontal rail of document tiles under a section heading. Hidden entirely
 * when empty — a rail with nothing in it is noise, not structure. Documents stay
 * the visual objects; the rail is spacing and a heading, not a card.
 */
export function SectionRail({
  title,
  documents,
  viewAllTo,
}: {
  title: string;
  documents: LibraryDocument[];
  viewAllTo?: string;
}) {
  if (documents.length === 0) return null;

  return (
    <section aria-label={title}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-fg-muted">{title}</h2>
        {viewAllTo && (
          <Link
            to={viewAllTo}
            className="text-xs text-link outline-none hover:text-link-hover focus-visible:underline"
          >
            View all
          </Link>
        )}
      </div>
      <ScrollArea.Root type="hover">
        <ScrollArea.Viewport className="w-full pb-2">
          <div className="flex gap-4">
            {documents.map((document) => (
              <div key={document.id} className="w-32 shrink-0 sm:w-36">
                <DocumentTile document={document} />
              </div>
            ))}
          </div>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar
          orientation="horizontal"
          className="flex h-1.5 touch-none rounded-full bg-transparent select-none"
        >
          <ScrollArea.Thumb className="rounded-full bg-border-strong" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
    </section>
  );
}
