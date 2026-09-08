import { log } from '@/lib/logger';

const SCOPE = 'notifications';

/**
 * `expo-notifications`, if this build actually has it.
 *
 * **Importing it is not safe.** The module touches its native counterparts as
 * it evaluates, so on a build without them — Expo Go on Android from SDK 53,
 * which dropped remote push, or any build where the module was not linked — a
 * plain `import` throws `Cannot find native module 'ExpoPushTokenManager'`
 * before a line of Pidom's own code runs. That threw inside
 * `(app)/_layout.tsx`, which meant the authenticated layout never evaluated,
 * which is why the second error was `Cannot read property 'ErrorBoundary' of
 * undefined`: expo-router had a route module that was `undefined`. One missing
 * native module took the whole signed-in half of the app down.
 *
 * So it is required lazily, once, behind a `try`. Everything downstream of this
 * already had a "this build cannot receive notifications" path — `register()`
 * returns `unconfigured`, the settings screen says so in a sentence — and this
 * makes that path reachable instead of fatal. Shares still arrive, the inbox
 * still fills, the activity feed still works. Only the lock screen is quiet.
 *
 * The type import is separate and erased at compile time, so it costs nothing
 * at runtime and the call sites stay fully typed.
 */
type Module = typeof import('expo-notifications');

let resolved: Module | null | undefined;

export function notifications(): Module | null {
  if (resolved === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      resolved = require('expo-notifications') as Module;
    } catch (error) {
      // Once, at the first attempt. Repeating it on every heartbeat of a
      // feature that is switched off is noise, and the cache below is what
      // stops Metro re-evaluating a module that throws.
      log.warn(SCOPE, 'this build has no notifications module, so push is off');
      log.debug(SCOPE, 'notifications module error', error);
      resolved = null;
    }
  }
  return resolved;
}

/** Whether push can work at all here. Screens use it to say so rather than to guess. */
export function pushAvailable(): boolean {
  return notifications() !== null;
}
