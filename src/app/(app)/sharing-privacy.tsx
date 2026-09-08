import { SharingPrivacyScreen } from '@/features/sharing/sharing-privacy-screen';

export default SharingPrivacyScreen;

/**
 * Who can reach this account, and what a share of theirs starts as.
 *
 * Routes hold no logic; the screen is composed in `src/features`. The error
 * boundary is here for the reason every authenticated route has one: `useQuery`
 * re-throws a query error during render, so a share revoked on another device
 * while its screen is open would otherwise be a blank screen with no way out
 * but a force-quit.
 */
export { ScreenError as ErrorBoundary } from '@/components/feedback/screen-error';
