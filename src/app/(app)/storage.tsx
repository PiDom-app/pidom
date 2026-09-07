import { DeviceStorageScreen } from '@/features/library/components/device-storage';

export default DeviceStorageScreen;

/**
 * Expo Router wraps this route in it. `useQuery` re-throws a query error during
 * render, so without this a lapsed profile is a blank screen with no way out
 * but a force-quit.
 */
export { ScreenError as ErrorBoundary } from '@/components/feedback/screen-error';
