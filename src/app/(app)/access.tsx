import { AccessScreen } from '@/features/sharing/access-screen';

export default AccessScreen;

/**
 * Who can open a document the reader owns.
 *
 * Routes hold no logic; the screen is composed in `src/features`. The error
 * boundary is here for the reason every authenticated route has one: `useQuery`
 * re-throws a query error during render, so a share revoked on another device
 * while its screen is open would otherwise be a blank screen with no way out
 * but a force-quit.
 */
export { ScreenError as ErrorBoundary } from '@/components/feedback/screen-error';
