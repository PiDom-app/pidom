import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useMutation } from 'convex/react';
import Constants from 'expo-constants';

import { api } from '@convex/_generated/api';
import { useLibraryStatus } from '@/features/library/data/use-library-status';
import { log } from '@/lib/logger';
import { useDeviceStore } from '@/stores/device-store';

import { shareIdOf } from './handler';
import { notifications } from './native';
import { permissionStatus, register } from './register';

const SCOPE = 'notifications';

/**
 * Push, mounted once in the authenticated layout.
 *
 * Two jobs, and they are separate on purpose.
 *
 * **Registering** only happens if the reader has already said yes. This hook
 * never raises the operating system prompt — that is
 * `notification-settings-screen.tsx`, where there is a sentence explaining what
 * it is for. A permission asked for cold on launch is a permission denied
 * permanently, and there is no second chance at it.
 *
 * **Routing a tap** happens in two places because a notification can be tapped
 * in two situations: with the app running, which the listener catches, and from
 * cold, which only `getLastNotificationResponseAsync` reports. Handling only
 * the first is the bug where tapping a notification opens the home screen.
 *
 * The payload carries `{ kind, shareId }` and nothing else — no title, no
 * message — so the deep link is the whole of what a notification communicates
 * before the reader has been authenticated and checked.
 *
 * **Nothing here imports `expo-notifications` directly.** It throws as it
 * evaluates on a build without the native module, and this hook is mounted by
 * the authenticated layout — so the import took the entire signed-in half of
 * the app down with it, layout and all. `notifications()` returns `null`
 * instead, both effects below become no-ops, and everything that does not need
 * a lock screen carries on working.
 */
export function usePushNotifications(): void {
  const router = useRouter();
  const { ready, hasNetwork } = useLibraryStatus();
  const registerDevice = useMutation(api.notifications.registerDevice);
  const setDeviceId = useDeviceStore((state) => state.setDeviceId);
  const registered = useRef(false);

  useEffect(() => {
    if (!ready || !hasNetwork || registered.current) {
      return;
    }
    let live = true;

    void (async () => {
      // Both of the ways this gives up used to be silent, which is why a
      // handset that never registered could only ever be diagnosed by the
      // settings screen saying it had not. Neither line carries a token.
      const permission = await permissionStatus();
      if (permission !== 'granted') {
        log.error(SCOPE, `not registering: notifications are ${permission}`);
        return;
      }
      const outcome = await register();
      if (!live) {
        return;
      }
      if (outcome.kind !== 'token') {
        log.error(
          SCOPE,
          `not registering: ${outcome.kind === 'denied' ? 'permission denied' : outcome.reason}`,
        );
        return;
      }
      try {
        // The id of this handset's row, so the settings screen can mark one of
        // the account's devices "this device" without the token ever coming
        // back out. See `stores/device-store.ts`.
        setDeviceId(
          await registerDevice({
            token: outcome.token,
            platform: outcome.platform,
            deviceName: Constants.deviceName ?? undefined,
            appVersion: Constants.expoConfig?.version ?? undefined,
          }),
        );
        registered.current = true;
      } catch (error) {
        // Never fatal — a device that could not register still reads its inbox
        // — but not silent either. This was `debug`, which is compiled out of a
        // production bundle, so a handset that never managed to register said
        // nothing anywhere and the settings screen could only report the
        // symptom. The message is a failure reason, never the token.
        log.error(SCOPE, 'could not register this device for notifications', error);
      }
    })();

    return () => {
      live = false;
    };
  }, [hasNetwork, ready, registerDevice, setDeviceId]);

  // A tap while the app is running.
  useEffect(() => {
    const api = notifications();
    if (api === null) {
      return;
    }
    const subscription = api.addNotificationResponseReceivedListener((response) => {
      const shareId = shareIdOf(response);
      router.push(
        shareId === null
          ? { pathname: '/shared' }
          : { pathname: '/share-detail', params: { id: shareId } },
      );
    });
    return () => subscription.remove();
  }, [router]);

  // A tap that launched the app. Reported only here, and only once.
  const opened = useRef(false);
  useEffect(() => {
    const api = notifications();
    if (!ready || opened.current || api === null) {
      return;
    }
    opened.current = true;
    void api.getLastNotificationResponseAsync().then((response) => {
      if (response === null) {
        return;
      }
      const shareId = shareIdOf(response);
      if (shareId !== null) {
        router.push({ pathname: '/share-detail', params: { id: shareId } });
      }
    });
  }, [ready, router]);
}
