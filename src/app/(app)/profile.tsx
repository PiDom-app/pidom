import { ProfileScreen } from '@/features/account/profile-screen';

export default ProfileScreen;

/**
 * The name and the face other people see.
 *
 * Routes hold no logic; the screen is composed in `src/features`. The error
 * boundary is here for the reason every authenticated route has one: `useQuery`
 * re-throws a query error during render, so an account read that fails while
 * the screen is open would otherwise be a blank screen with no way out but a
 * force-quit.
 */
export { ScreenError as ErrorBoundary } from '@/components/feedback/screen-error';
