/**
 * The device's own view of connectivity, from one listener.
 *
 * A module rather than a hook, because two very different callers need it: the
 * library screens read it during render to choose between two sentences, and
 * the session provider needs to be told, imperatively and from outside React,
 * the moment a network comes back so it can retry an identity it could not
 * verify at launch.
 *
 * One native listener however many callers there are. `useLibraryStatus` alone
 * is read by the home hook, the actions hook, both library screens, the
 * collection picker and the action sheet, and an effect per caller would open
 * that many native `NetInfo` subscriptions for one boolean.
 *
 * Optimistic until the first answer. `NetInfo` takes a moment on Android, and
 * assuming no network in that window would put an offline notice on a screen
 * that is about to load perfectly well.
 */
import NetInfo from '@react-native-community/netinfo';
import { useSyncExternalStore } from 'react';

let hasNetwork = true;
const listeners = new Set<() => void>();
let stopNative: (() => void) | null = null;

function start(): void {
  // The unsubscribe lives at module scope rather than in a subscriber's
  // closure: held per-subscriber, the first caller to go away would tear down
  // the listener every other one is still reading.
  if (stopNative !== null) {
    return;
  }

  stopNative = NetInfo.addEventListener((state) => {
    // `isInternetReachable` stays `null` until the reachability probe answers,
    // and reading that as "no internet" makes the notice flap. `isConnected`
    // is the stable half.
    const next = state.isConnected === true;
    if (next === hasNetwork) {
      return;
    }

    hasNetwork = next;
    for (const listener of [...listeners]) {
      listener();
    }
  });
}

function stopIfIdle(): void {
  if (listeners.size === 0) {
    stopNative?.();
    stopNative = null;
  }
}

/** The last thing `NetInfo` said. `true` before it has said anything. */
export function hasNetworkNow(): boolean {
  return hasNetwork;
}

/**
 * Watch connectivity from outside React.
 *
 * The listener is called on a *change*, not on subscribe, so a caller that
 * needs the current value reads `hasNetworkNow()` first.
 */
export function watchNetwork(listener: () => void): () => void {
  listeners.add(listener);
  start();

  return () => {
    listeners.delete(listener);
    stopIfIdle();
  };
}

/** The same subscription, shaped for `useSyncExternalStore`. */
export function useHasNetwork(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hasNetwork,
    () => true,
  );
}

function subscribe(onStoreChange: () => void): () => void {
  return watchNetwork(onStoreChange);
}
