import { LibraryScreen } from '@/features/library/components/library-screen';

export default LibraryScreen;

/**
 * Expo Router wraps this route in it. `useQuery` re-throws a query error during
 * render, so without this a deleted document or a lapsed profile is a blank
 * screen with no way out but a force-quit.
 */
export { ScreenError as ErrorBoundary } from '@/components/feedback/screen-error';
