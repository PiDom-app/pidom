import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useMutation } from 'convex/react';
import Constants from 'expo-constants';

import { api } from '@convex/_generated/api';
import { useLibraryStatus } from '@/features/library/data/use-library-status';
import { log } from '@/lib/logger';

import { shareIdOf } from './handler';
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
 */
export function usePushNotifications(): void {
  const router = useRouter();
  const { ready, hasNetwork } = useLibraryStatus();
  const registerDevice = useMutation(api.notifications.registerDevice);
  const registered = useRef(false);

  useEffect(() => {
    if (!ready || !hasNetwork || registered.current) {
      return;
    }
    let live = true;

    void (async () => {
      if ((await permissionStatus()) !== 'granted') {
        return;
      }
      const outcome = await register();
      if (!live || outcome.kind !== 'token') {
        return;
      }
      try {
        await registerDevice({
          token: outcome.token,
          platform: outcome.platform,
          deviceName: Constants.deviceName ?? undefined,
          appVersion: Constants.expoConfig?.version ?? undefined,
        });
        registered.current = true;
      } catch (error) {
        // Never fatal. A device that could not register still reads its inbox.
        log.debug(SCOPE, 'could not register this device', error);
      }
    })();

    return () => {
      live = false;
    };
  }, [hasNetwork, ready, registerDevice]);

  // A tap while the app is running.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const shareId = shareIdOf(response);
      router.push(
        shareId === null ? { pathname: '/shared' } : { pathname: '/share-detail', params: { id: shareId } },
      );
    });
    return () => subscription.remove();
  }, [router]);

  // A tap that launched the app. Reported only here, and only once.
  const opened = useRef(false);
  useEffect(() => {
    if (!ready || opened.current) {
      return;
    }
    opened.current = true;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
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
