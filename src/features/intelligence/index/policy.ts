/**
 * Whether an index may be built, and which rule says otherwise.
 *
 * `downloads/policy.ts`'s shape, and the same argument behind it: every answer
 * here is one of the reader's own settings doing what it was asked to, so a
 * refusal is an `IndexHold` rather than an error. The queue holds the row, the
 * screen says which rule and offers the way past it, and nothing is counted as
 * a failed attempt.
 *
 * The order is the order the reader can act on. `model` first, because it is
 * the only one that is an instruction rather than a wait and the only one that
 * affects every document at once — telling somebody their phone is waiting for
 * Wi-Fi when the real answer is that they have not downloaded the model would
 * send them to the wrong screen. Space last, because it is the only one they
 * cannot simply override.
 */
import { connectionKind } from '@/lib/connectivity';
import { roomFor } from '@/features/library/local/space';
import type { IndexHold } from '@/features/library/local/repository/types';
import { indexCapBytes, preferencesNow } from '@/stores/preferences-store';

import { modelPresent } from '../engine/model-store';
import { batteryLevelNow, isChargingNow } from './battery';

/** What a document's index is expected to cost, for the ceiling check. */
export type IndexCost = { bytes: number; needsText: boolean };

export function holdFor(profileId: string, cost: IndexCost, usedBytes: number): IndexHold | null {
  const prefs = preferencesNow();

  if (!modelPresent(profileId)) {
    return 'model';
  }

  // Only the fetch of a document's text needs a network at all. Once the pages
  // are mirrored, indexing is pure local compute and a Wi-Fi rule that held it
  // would be a rule about nothing.
  if (cost.needsText && prefs.indexOnWifiOnly && connectionKind() === 'cellular') {
    return 'wifi';
  }

  // A floor of zero is "never wait", which is a real answer for somebody who
  // leaves a phone on a charger. Charging lifts it regardless: the reason for
  // the floor is the reading somebody wants to do later, and a plugged-in phone
  // has no later.
  if (
    prefs.indexBatteryFloor > 0 &&
    !isChargingNow() &&
    batteryLevelNow() < prefs.indexBatteryFloor
  ) {
    return 'battery';
  }

  const cap = indexCapBytes();
  if (cap !== null && usedBytes + cost.bytes > cap) {
    return 'cap';
  }

  if (!roomFor(cost.bytes).ok) {
    return 'space';
  }

  return null;
}

/**
 * Whether the queue is worth running at all right now.
 *
 * Deliberately not `hasNetworkNow()` on its own, which is what the download
 * queue asks. Indexing a document whose text is already here needs nothing from
 * the network, so a phone in aeroplane mode with four mirrored books to index
 * should index them.
 */
export function canIndex(profileId: string): boolean {
  return preferencesNow().indexAutomatically && modelPresent(profileId);
}

/**
 * Which holds to let go of, given what just changed.
 *
 * Narrow on purpose, for the reason the download queue's version is: a queue
 * held for want of disk must not all start the moment somebody joins a network.
 * `model` is absent from every list — it is released by the download finishing,
 * which calls `release(['model'])` directly, because nothing else can tell.
 */
export function releasableOn(event: 'network' | 'battery' | 'space' | 'settings'): IndexHold[] {
  switch (event) {
    case 'network':
      return connectionKind() === 'wifi' ? ['wifi'] : [];
    case 'battery':
      return isChargingNow() || batteryLevelNow() >= preferencesNow().indexBatteryFloor
        ? ['battery']
        : [];
    case 'space':
      return ['space', 'cap'];
    case 'settings':
      // The reader changed something. Everything that is a setting may now be
      // wrong, and the next pass re-asks `holdFor` for each of them anyway.
      return ['wifi', 'battery', 'cap'];
  }
}
