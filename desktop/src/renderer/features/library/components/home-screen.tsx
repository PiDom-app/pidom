import { ScrollArea } from 'radix-ui';
import { Link } from '@tanstack/react-router';
import { PageHeader } from '@/components/shell/page-header';
import { useHome } from '../data/use-home';
import { ContinueReading } from './continue-reading';
import { SectionRail } from './section-rail';
import { CollectionTile } from './collection-tile';
import { EmptyLibrary } from './empty-library';
import { LibrarySkeleton } from './library-skeleton';

/**
 * The Home workspace: the reader's active context first, then the rest of the
 * library grouped into rails. Hierarchy comes from spacing and headings, not
 * cards — Continue Reading leads, then Recently Added, Favorites, Finished, and
 * Collections, each hidden when it holds nothing.
 */
export function HomeScreen() {
  const home = useHome();

  return (
    <ScrollArea.Root type="scroll" className="h-full">
      <ScrollArea.Viewport className="h-full">
        <div className="mx-auto max-w-6xl px-8 py-8">
          <PageHeader title="Home" subtitle="Pick up where you left off." />
          {home === undefined ? <LibrarySkeleton /> : <HomeContent home={home} />}
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar
        orientation="vertical"
        className="flex w-2 touch-none p-0.5 select-none"
      >
        <ScrollArea.Thumb className="flex-1 rounded-full bg-border-strong" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}

function HomeContent({ home }: { home: NonNullable<ReturnType<typeof useHome>> }) {
  const { continueReading, recentlyAdded, favorites, finished, collections } = home;
  const isEmpty =
    continueReading.length === 0 &&
    recentlyAdded.length === 0 &&
    favorites.length === 0 &&
    finished.length === 0 &&
    collections.length === 0;

  if (isEmpty) return <EmptyLibrary />;

  const [hero, ...restContinue] = continueReading;

  return (
    <div className="space-y-10">
      {hero && <ContinueReading document={hero} />}
      {restContinue.length > 0 && <SectionRail title="Also reading" documents={restContinue} />}
      <SectionRail title="Recently added" documents={recentlyAdded} viewAllTo="/library" />
      <SectionRail title="Favorites" documents={favorites} viewAllTo="/favorites" />
      <SectionRail title="Finished" documents={finished} viewAllTo="/finished" />

      {collections.length > 0 && (
        <section aria-label="Collections">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-fg-muted">Collections</h2>
            <Link
              to="/collections"
              className="text-xs text-link outline-none hover:text-link-hover focus-visible:underline"
            >
              View all
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {collections.map((collection) => (
              <CollectionTile key={collection.id} collection={collection} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
