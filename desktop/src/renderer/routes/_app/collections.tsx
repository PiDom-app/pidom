import { createFileRoute } from '@tanstack/react-router';
import { CollectionsScreen } from '@/features/library/collections/collections-screen';

export const Route = createFileRoute('/_app/collections')({
  component: CollectionsScreen,
});
