import { NotificationSettingsScreen } from '@/features/sharing/notification-settings-screen';

export default NotificationSettingsScreen;

/**
 * What this account wants to be told about, and on which device.
 *
 * Routes hold no logic; the screen is composed in `src/features`. The error
 * boundary is here for the reason every authenticated route has one: `useQuery`
 * re-throws a query error during render, so a share revoked on another device
 * while its screen is open would otherwise be a blank screen with no way out
 * but a force-quit.
 */
export { ScreenError as ErrorBoundary } from '@/components/feedback/screen-error';
