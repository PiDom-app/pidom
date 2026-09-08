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
/**
 * What kind of connection it is, when NetInfo has said.
 *
 * Kept beside `hasNetwork` rather than in a second listener, because it comes
 * off the same `state` object — and because "Wi-Fi only" is a setting about a
 * transfer that only makes sense while there is a network at all.
 *
 * `unknown` before the first answer and whenever the platform will not say. A
 * Wi-Fi-only download is refused on `cellular` and allowed on everything else:
 * refusing what cannot be identified would block downloads on any platform
 * NetInfo is vague about, which is a worse failure than one metered megabyte.
 */
let connection: 'wifi' | 'cellular' | 'other' | 'unknown' = 'unknown';
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
    const kind =
      state.type === 'wifi' || state.type === 'ethernet'
        ? 'wifi'
        : state.type === 'cellular'
          ? 'cellular'
          : state.type === 'unknown' || state.type === 'none'
            ? 'unknown'
            : 'other';
    if (next === hasNetwork && kind === connection) {
      return;
    }

    hasNetwork = next;
    connection = kind;
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

/** What the connection is, as of the last thing `NetInfo` said. */
export function connectionKind(): 'wifi' | 'cellular' | 'other' | 'unknown' {
  return connection;
}

/**
 * Whether a large transfer should go now, given the reader's Wi-Fi-only choice.
 *
 * Here rather than at each call site so there is one answer to "is this
 * metered", and so the fallback is decided once: only a connection NetInfo
 * positively identifies as cellular is refused.
 */
export function mayTransfer(wifiOnly: boolean): boolean {
  return !wifiOnly || connection !== 'cellular';
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

/** The same subscription, for a screen that needs to name the connection. */
export function useConnectionKind(): 'wifi' | 'cellular' | 'other' | 'unknown' {
  return useSyncExternalStore(
    subscribe,
    () => connection,
    () => 'unknown' as const,
  );
}

function subscribe(onStoreChange: () => void): () => void {
  return watchNetwork(onStoreChange);
}
