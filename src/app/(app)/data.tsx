import { DataScreen } from '@/features/account/data-screen';

export default DataScreen;

/**
 * What this device downloads, and how to leave.
 *
 * Routes hold no logic; the screen is composed in `src/features`. The error
 * boundary is here for the reason every authenticated route has one.
 */
export { ScreenError as ErrorBoundary } from '@/components/feedback/screen-error';
