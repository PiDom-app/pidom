import { createFileRoute } from '@tanstack/react-router';
import { DownloadsScreen } from '@/features/downloads/downloads-screen';

export const Route = createFileRoute('/_app/downloads')({
  component: DownloadsScreen,
});
