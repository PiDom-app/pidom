import { createFileRoute } from '@tanstack/react-router';
import { HomeScreen } from '@/features/library/components/home-screen';

export const Route = createFileRoute('/_app/home')({
  component: HomeScreen,
});
