import { createFileRoute } from '@tanstack/react-router';
import { AllLibraryScreen } from '@/features/library/all/all-library-screen';

export const Route = createFileRoute('/_app/favorites')({
  component: () => (
    <AllLibraryScreen
      title="Favorites"
      subtitle="Documents you've starred."
      lockedFilter="favorites"
    />
  ),
});
