/**
 * How much charge is left, from one listener.
 *
 * `connectivity.ts`'s shape, and for the same two reasons: the policy is
 * consulted on every tick of a drain that runs outside React and cannot await,
 * and an effect per caller would open that many native subscriptions for one
 * number.
 *
 * **Optimistic until the platform answers.** A drain that refused to start
 * because the battery level had not arrived yet would refuse to start on every
 * cold launch, which is exactly when there is a queue to work through.
 */
import * as Battery from 'expo-battery';

import { log } from '@/lib/logger';

const SCOPE = 'intelligence-battery';

let level = 1;
let charging = true;
const listeners = new Set<() => void>();
let stopNative: (() => void) | null = null;

function announce(): void {
  for (const listener of listeners) {
    listener();
  }
}

function start(): void {
  // At module scope rather than in a subscriber's closure: held per-subscriber,
  // the first caller to go away would tear down the listener every other one is
  // still reading.
  if (stopNative !== null) {
    return;
  }

  const subscriptions: { remove: () => void }[] = [];
  try {
    subscriptions.push(
      Battery.addBatteryLevelListener(({ batteryLevel }) => {
        level = batteryLevel;
        announce();
      }),
    );
    subscriptions.push(
      Battery.addBatteryStateListener(({ batteryState }) => {
        charging =
          batteryState === Battery.BatteryState.CHARGING ||
          batteryState === Battery.BatteryState.FULL;
        announce();
      }),
    );

    void Promise.all([Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync()])
      .then(([current, state]) => {
        level = current;
        charging = state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
        announce();
      })
      .catch((error: unknown) => {
        log.debug(SCOPE, 'could not read the battery', error);
      });
  } catch (error) {
    // A simulator, or a platform that will not say. The optimistic defaults
    // stand, which means indexing runs — the right way to be wrong about this.
    log.debug(SCOPE, 'no battery to watch', error);
  }

  stopNative = () => {
    for (const subscription of subscriptions) {
      subscription.remove();
    }
  };
}

/** `0` to `1`. Optimistic until the platform has answered. */
export function batteryLevelNow(): number {
  start();
  return level;
}

/** Plugged in, or full. The floor does not apply while this is true. */
export function isChargingNow(): boolean {
  start();
  return charging;
}

/** Tells a queue to have another look. Used to release a `battery` hold. */
export function watchBattery(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
