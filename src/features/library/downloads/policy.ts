import { connectionKind, hasNetworkNow } from '@/lib/connectivity';
import { preferencesNow, storageCapBytes } from '@/stores/preferences-store';

import { roomFor } from '../local/space';
import type { HoldReason } from '../local/repository/types';

/**
 * Whether a download may move, and which rule says otherwise.
 *
 * Every answer here is one of the reader's own settings doing what it was
 * asked to. That is why a refusal is a `HoldReason` rather than an error: the
 * queue holds the row, the screen says which rule and offers the way past it,
 * and nothing is counted as a failed attempt. The previous behaviour was a
 * toast that had already gone by the time anybody wondered why nothing was
 * moving.
 *
 * The order is deliberate. Disk space is checked last because it is the only
 * one the reader cannot simply override — the other two are choices, and a
 * screen that says "waiting for Wi-Fi" when the real problem is a full phone
 * would send somebody to the wrong settings screen.
 */
export function holdFor(byteSize: number, overridden: boolean): HoldReason | null {
  const prefs = preferencesNow();
  const connection = connectionKind();

  // Only a link NetInfo positively calls cellular is refused. `unknown` is a
  // connection nobody can describe, and refusing on it would strand a reader on
  // a network the library simply does not recognise. Same rule as `mayTransfer`.
  const onCellular = connection === 'cellular';

  if (onCellular && prefs.wifiOnly && !overridden) {
    return 'wifi';
  }

  if (onCellular && !overridden && prefs.cellularCeilingMb >= 0) {
    const ceiling = prefs.cellularCeilingMb * 1024 * 1024;
    // A ceiling of zero means ask about everything, which is a real answer
    // somebody may want on a metered connection abroad.
    if (byteSize > ceiling) {
      return 'cellular-cap';
    }
  }

  const cap = storageCapBytes();
  if (cap !== null && byteSize > cap) {
    // Bigger than the whole ceiling: no amount of eviction makes room, so this
    // is a hold rather than something the queue should keep trying to clear.
    return 'cap';
  }

  if (!roomFor(byteSize).ok) {
    return 'space';
  }

  return null;
}

/** Whether there is any point in the queue running at all right now. */
export function canTransfer(): boolean {
  return hasNetworkNow();
}

/**
 * Which holds the queue should let go of, given what just changed.
 *
 * Narrow on purpose. A queue held for want of disk space must not all start
 * moving the moment somebody joins a network — that is how a phone with four
 * hundred megabytes free tries to fetch six textbooks and fails six times.
 */
export function releasableOn(event: 'network' | 'space'): HoldReason[] {
  if (event === 'network') {
    const prefs = preferencesNow();
    if (!prefs.resumeOnWifi) {
      return [];
    }
    return connectionKind() === 'wifi' ? ['wifi', 'cellular-cap'] : [];
  }
  return ['space', 'cap'];
}
