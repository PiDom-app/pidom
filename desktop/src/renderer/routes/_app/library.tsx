import { createFileRoute } from '@tanstack/react-router';
import { AllLibraryScreen } from '@/features/library/all/all-library-screen';

export const Route = createFileRoute('/_app/library')({
  component: () => <AllLibraryScreen title="Library" subtitle="Everything in your account." />,
});
