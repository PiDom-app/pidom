import type * as Notifications from 'expo-notifications';

import { notifications } from './native';

/**
 * What happens when one arrives while the app is open.
 *
 * Set once, at module scope, because `expo-notifications` reads the handler
 * globally rather than per screen — a handler set in a component is a handler
 * that exists only while that component is mounted.
 *
 * Through `notifications()` rather than a bare import: a build without the
 * native module throws on the import itself, and this file is reached from the
 * authenticated layout. See `./native.ts`.
 *
 * A banner and a list entry, no sound and no badge. The sound belongs to the
 * operating system's own decision when the app is closed; playing one over a
 * reader who is looking at the screen is telling them something they can see.
 *
 * `shouldShowBanner` and `shouldShowList` are the current fields —
 * `shouldShowAlert` was the old single flag and is gone.
 */
notifications()?.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** What `convex/push.ts` puts in a payload. Nothing else is read. */
export type SharePayload = {
  kind?: string;
  shareId?: string | null;
};

/**
 * The share a notification points at, if it points at one.
 *
 * Defensive because the payload arrives from a third party's delivery service:
 * it is JSON somebody else round-tripped, so it is read as unknown and narrowed
 * rather than cast. The worst a malformed one can do here is open nothing.
 */
export function shareIdOf(response: Notifications.NotificationResponse): string | null {
  const data = response.notification.request.content.data as SharePayload | undefined;
  const shareId = data?.shareId;
  return typeof shareId === 'string' && shareId !== '' ? shareId : null;
}
