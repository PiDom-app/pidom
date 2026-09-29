import { createFileRoute } from '@tanstack/react-router';
import type { Id } from '@convex/dataModel';
import { CollectionDetailScreen } from '@/features/library/collections/collection-detail-screen';

export const Route = createFileRoute('/_app/collections/$collectionId')({
  component: CollectionDetailRoute,
});

function CollectionDetailRoute() {
  const { collectionId } = Route.useParams();
  return <CollectionDetailScreen collectionId={collectionId as Id<'collections'>} />;
}
