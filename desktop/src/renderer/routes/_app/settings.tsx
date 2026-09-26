import { createFileRoute } from '@tanstack/react-router';
import { SettingsScreen } from '@/features/settings/components/settings-screen';

export const Route = createFileRoute('/_app/settings')({
  component: SettingsScreen,
});
