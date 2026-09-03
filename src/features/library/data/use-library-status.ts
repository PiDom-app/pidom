import NetInfo from '@react-native-community/netinfo';
import { useConvexConnectionState } from 'convex/react';
import { useSyncExternalStore } from 'react';

import { useProfile } from '@/features/auth/use-profile';

/**
 * Whether it is safe to ask the server for owned data, and whether the server
 * is answering.
 *
 * **`ready` is not optional.** Every library function starts with `requireUser`,
 * which throws `NO_PROFILE` when the token verifies but the row does not exist
 * yet — and `convex/react`'s `useQuery` re-throws a query error *during render*.
 * On a first sign-in the authenticated layout mounts `useEnsureProfile` and the
 * home screen in the same commit, so without this gate the very first launch of
 * a new account renders a thrown error rather than a library.
 *
 * The alternative was to soften `requireUser` into "return nothing if there is
 * no row". That would hide a genuine failure — a token that verifies against a
 * profile that vanished — behind an empty library, on every function. The gate
 * belongs on the caller.
 */
export type LibraryStatus = {
  /** The profile row exists. Owner-scoped queries may run. */
  ready: boolean;
  /** Convex is not answering. Live data will not arrive until it is. */
  offline: boolean;
  /**
   * Whether the device has a network at all.
   *
   * Distinct from `offline` on purpose: an interface can be up while Convex is
   * unreachable — a captive portal, a DNS failure, a backend incident. The two
   * want different words in front of the reader, and only `NetInfo` can tell
   * them apart.
   */
  hasNetwork: boolean;
  /** The signed-in profile's id, which scopes the offline cache. */
  profileId: string | null;
};

export function useLibraryStatus(): LibraryStatus {
  const { profile } = useProfile();
  const connection = useConvexConnectionState();
  const hasNetwork = useHasNetwork();

  return {
    ready: profile !== null,
    // `hasEverConnected` is what keeps a cold launch from flashing "offline"
    // during the second it takes the socket to open: before the first
    // connection there is nothing to have lost.
    offline: connection.hasEverConnected && !connection.isWebSocketConnected,
    hasNetwork,
    profileId: profile?.id ?? null,
  };
}

/**
 * The device's own view of connectivity, from one listener.
 *
 * `useSyncExternalStore` over a module-scoped subscription rather than an
 * effect per caller: `useLibraryStatus` is used by the home hook, the actions
 * hook, both library screens, the collection picker and the action sheet, and
 * an effect would open that many native `NetInfo` listeners for one boolean.
 * This opens exactly one however many components read it.
 *
 * Optimistic until the first answer. `NetInfo` takes a moment on Android, and
 * assuming no network in that window would put an offline notice on a screen
 * that is about to load perfectly well.
 */
let hasNetwork = true;
const listeners = new Set<() => void>();
let stopNative: (() => void) | null = null;

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);

  // The native listener opens on the first subscriber and closes on the last,
  // so a signed-out app holds none. The unsubscribe lives at module scope
  // rather than in this closure: held per-subscriber, the first component to
  // unmount would tear down the listener every other one is still reading.
  if (stopNative === null) {
    stopNative = NetInfo.addEventListener((state) => {
      // `isInternetReachable` stays `null` until the reachability probe
      // answers, and reading that as "no internet" makes the notice flap.
      // `isConnected` is the stable half.
      const next = state.isConnected === true;
      if (next !== hasNetwork) {
        hasNetwork = next;
        for (const listener of listeners) {
          listener();
        }
      }
    });
  }

  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0) {
      stopNative?.();
      stopNative = null;
    }
  };
}

function useHasNetwork(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hasNetwork,
    () => true,
  );
}
