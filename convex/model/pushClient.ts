import { PushNotifications } from '@convex-dev/expo-push-notifications';

import { components } from '../_generated/api';
import type { Id } from '../_generated/dataModel';

/**
 * The push component's client, in a module of its own.
 *
 * It lives here rather than in `../push.ts` because two files need it and one
 * of them is `./notifications.ts`, which `../push.ts` already imports —
 * constructing it there would be a cycle. A client with no logic in it is the
 * right thing to break that with.
 *
 * **Keyed on `deviceTokens` ids, not `users` ids.** The component is
 * one-token-per-key: `recordToken` patches the row it finds and
 * `sendPushNotification` reads it back with `.unique()`. Keyed on an account, a
 * reader with a phone and a tablet would be notified on whichever registered
 * last. The type parameter is `extends string` and a Convex id is a branded
 * string, so one component row per device is the intended use of it.
 */
export const pushNotifications = new PushNotifications<Id<'deviceTokens'>>(
  components.pushNotifications,
);
