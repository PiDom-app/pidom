import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { log } from '@/lib/logger';

import { notifications } from './native';

const SCOPE = 'notifications';

/**
 * Getting this device a push token, or explaining why not.
 *
 * Four things have to be true before a token exists, and each of them fails in
 * a way worth naming rather than swallowing:
 *
 * - **The module has to exist.** `expo-notifications` throws as it evaluates on
 *   a build that has not linked it — Expo Go on Android since SDK 53 dropped
 *   remote push — so it is reached through `notifications()`, which returns
 *   `null` there instead of taking the app down with it.
 * - **It has to be a real device.** A simulator has no push service to
 *   register with, and Expo's own docs say so.
 * - **There has to be an EAS project id.** `getExpoPushTokenAsync` needs one to
 *   know which project's credentials to mint against, and this project does not
 *   have an EAS project yet. Rather than throwing on every launch, this returns
 *   `unconfigured` and logs the reason — the app runs, the in-app inbox works,
 *   and push starts working the moment `eas init` has been run and the id
 *   appears in `app.json`.
 * - **The reader has to have said yes.** Asked at the point it buys them
 *   something, not on first launch. See `use-push-registration.ts`.
 * - **Android needs a channel.** A notification sent to a channel that does not
 *   exist is a notification Android silently drops, and the channel name is the
 *   one `convex/push.ts` sends against.
 *
 * From SDK 53 onward, remote push on Android needs a development build rather
 * than Expo Go — so in Expo Go this returns `unconfigured` too, which is
 * accurate.
 */
export type Registration =
  | { kind: 'token'; token: string; platform: 'ios' | 'android' }
  | { kind: 'denied' }
  | { kind: 'unconfigured'; reason: string };

/** The channel `convex/push.ts` addresses. Created before any token is asked for. */
export const CHANNEL_ID = 'shares';

export async function ensureAndroidChannel(): Promise<void> {
  const api = notifications();
  if (Platform.OS !== 'android' || api === null) {
    return;
  }
  await api.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Shared documents',
    importance: api.AndroidImportance.DEFAULT,
    // No custom vibration or light: this is somebody being told a PDF arrived,
    // not an alarm.
    lockscreenVisibility: api.AndroidNotificationVisibility.PRIVATE,
  });
}

/**
 * Whether the reader has already answered, without asking them again.
 *
 * A build with no module has no answer to give and reports `undetermined`
 * rather than `denied`: nobody has refused anything, and the settings screen
 * says which of the two it is in its own words.
 */
export async function permissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  const api = notifications();
  if (api === null) {
    return 'undetermined';
  }
  const { status } = await api.getPermissionsAsync();
  return status;
}

/**
 * Asks, and registers if the answer is yes.
 *
 * `requestPermissionsAsync` is the only place the operating system prompt is
 * raised, and it is raised from a screen that has just explained what it is
 * for. Asking cold on first launch is how an application ends up permanently
 * unable to notify anybody.
 */
export async function register(): Promise<Registration> {
  const api = notifications();
  if (api === null) {
    return { kind: 'unconfigured', reason: 'this build has no notifications module' };
  }
  if (!Device.isDevice) {
    return { kind: 'unconfigured', reason: 'push notifications need a physical device' };
  }

  await ensureAndroidChannel();

  const existing = await api.getPermissionsAsync();
  const decided =
    existing.status === 'granted'
      ? existing
      : await api.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        });

  if (decided.status !== 'granted') {
    return { kind: 'denied' };
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    // The field EAS writes on a build, which is not always the same object.
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;

  if (typeof projectId !== 'string' || projectId === '') {
    // Not an error, and not silent. Everything else in the feature works; this
    // is the one part that needs an EAS project to exist.
    log.warn(
      SCOPE,
      'no EAS project id, so no push token. Run `eas init` and set extra.eas.projectId.',
    );
    return { kind: 'unconfigured', reason: 'no EAS project id' };
  }

  try {
    const { data } = await api.getExpoPushTokenAsync({ projectId });
    return {
      kind: 'token',
      token: data,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    };
  } catch (error) {
    // A development build is required for remote push on Android from SDK 53,
    // and Expo Go throws here rather than returning anything. Logged without
    // the error's message, which can carry project identifiers.
    log.warn(SCOPE, 'could not mint a push token on this build');
    log.debug(SCOPE, 'push token error', error);
    return { kind: 'unconfigured', reason: 'this build cannot receive remote notifications' };
  }
}
