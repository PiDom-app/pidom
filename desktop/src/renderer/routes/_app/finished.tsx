import { createFileRoute } from '@tanstack/react-router';
import { AllLibraryScreen } from '@/features/library/all/all-library-screen';

export const Route = createFileRoute('/_app/finished')({
  component: () => (
    <AllLibraryScreen
      title="Finished"
      subtitle="Documents you've read through."
      lockedFilter="finished"
    />
  ),
});
