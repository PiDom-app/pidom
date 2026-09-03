import { ImportScreen } from '@/features/library/import/import-screen';

export default ImportScreen;

/**
 * Expo Router wraps this route in it. `useQuery` re-throws a query error during
 * render, so without this a deleted document or a lapsed profile is a blank
 * screen with no way out but a force-quit.
 */
export { ScreenError as ErrorBoundary } from '@/components/feedback/screen-error';
