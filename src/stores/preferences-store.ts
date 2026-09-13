import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Choices about this device, kept on this device.
 *
 * Deliberately not in `sharingSettings` or `notificationSettings` on the
 * account. Those describe the reader — who may find them, what they want to be
 * told — and they should follow the reader to a new phone. This describes the
 * handset: whether *this* device, on *its* connection, with *its* remaining
 * disk, should pull a hundred megabytes down. Syncing that to a tablet on hotel
 * Wi-Fi would be applying one device's answer to another device's question.
 *
 * `AsyncStorage` for the same reason as the theme: it is a preference, not a
 * credential, and it has to be readable before the first transfer is offered.
 *
 * **Every setting here governs something.** That is a rule rather than an
 * observation: `docs/security.md` has a paragraph about `showReadingActivity`
 * sitting on a screen for months wired to nothing, reading as a protection and
 * being none. A switch nobody has implemented is worse than a switch nobody
 * has added, so each of these is named beside the code that reads it.
 */

/** What the reader will let this device pull over a connection that is not Wi-Fi. */
export type CellularCeiling = 0 | 5 | 25 | 50 | -1;

/** How many recently-opened documents are kept offline whatever else happens. */
export type KeepRecent = 0 | 3 | 5 | 10;

/** The ceiling for the whole library on this device, in bytes. `0` is no ceiling. */
export type StorageCap = 0 | 1 | 2 | 5 | 10;

/** What goes first when the ceiling is reached. Never a document only this phone has. */
export type EvictionOrder = 'least-recently-opened' | 'largest' | 'finished-first';

/** How often a file already here is read back and checked. */
export type VerifyCadence = 'always' | 'weekly' | 'never';

type PreferencesState = {
  /** Hold large transfers unless the connection is Wi-Fi. Off by default. */
  wifiOnly: boolean;
  /**
   * Megabytes, above which a download over mobile data waits to be agreed to.
   *
   * `-1` means never ask. Read by `downloads/policy.ts`, and it is a second
   * question from `wifiOnly` rather than a softer version of it: one is "not on
   * mobile data at all", the other is "not a textbook on mobile data".
   */
  cellularCeilingMb: CellularCeiling;
  /** Let held downloads go the moment Wi-Fi comes back, rather than waiting for a tap. */
  resumeOnWifi: boolean;

  /** Fetch a shared PDF when the reader accepts the share. */
  autoDownloadAccepted: boolean;
  /** Keep anything hearted on this device. */
  autoDownloadFavourites: boolean;
  /** Keep the last N opened documents offline. `0` is off. */
  keepRecent: KeepRecent;

  /** Gigabytes the library may occupy on this device. `0` is no ceiling. */
  storageCapGb: StorageCap;
  evictionOrder: EvictionOrder;
  /** Never evict a book the reader marked finished. */
  keepFinished: boolean;

  verifyCadence: VerifyCadence;

  /** How many transfers may move at once. More is not faster on one connection. */
  maxConcurrent: 1 | 2 | 3;
  /** Retry a failed transfer on the queue's own backoff. */
  retryAutomatically: boolean;

  /** False until the persisted value has been read back. */
  hydrated: boolean;
  set: (patch: Partial<PreferencesState>) => void;
  setWifiOnly: (wifiOnly: boolean) => void;
};

/**
 * The defaults, and the two worth defending.
 *
 * **`wifiOnly` is off**, because a reader who has not been asked has not said
 * no. The switch is on the Downloads screen with the storage numbers beside it,
 * which is where somebody who cares about their allowance will look.
 *
 * **`cellularCeilingMb` is 25 and not `-1`.** It is the one default here that
 * interrupts somebody, and it earns it: the difference between a 2 MB lease
 * agreement and a 12 MB textbook is the difference between nothing and a
 * noticeable piece of a monthly allowance, and a reader who finds out from
 * their bill has been failed by a default that preferred not to ask.
 *
 * Everything automatic is off. A setting that fetches documents nobody asked
 * for, over a connection nobody described, is not a default anybody should
 * arrive at without choosing it.
 */
export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      wifiOnly: false,
      cellularCeilingMb: 25,
      resumeOnWifi: true,

      autoDownloadAccepted: false,
      autoDownloadFavourites: false,
      keepRecent: 0,

      storageCapGb: 0,
      evictionOrder: 'least-recently-opened',
      keepFinished: false,

      verifyCadence: 'weekly',

      maxConcurrent: 1,
      retryAutomatically: true,

      hydrated: false,
      set: (patch) => set(patch),
      setWifiOnly: (wifiOnly) => set({ wifiOnly }),
    }),
    {
      name: 'pidom.preferences',
      storage: createJSONStorage(() => AsyncStorage),
      // `hydrated` describes this launch; everything else is the reader's.
      partialize: ({ hydrated: _hydrated, set: _set, setWifiOnly: _setWifiOnly, ...rest }) => rest,
      /**
       * Older installs have a blob with one key in it.
       *
       * `persist` merges a stored object over the defaults shallowly, so a
       * phone that last wrote `{ wifiOnly }` keeps its answer and picks up
       * every default added since. Nothing to migrate, and nothing to guess.
       */
      version: 2,
      onRehydrateStorage: () => () => {
        usePreferencesStore.setState({ hydrated: true });
      },
    },
  ),
);

/** The current value, for callers outside React. */
export function wifiOnlyNow(): boolean {
  return usePreferencesStore.getState().wifiOnly;
}

/** The whole current set, for the queue, which runs outside React. */
export function preferencesNow(): PreferencesState {
  return usePreferencesStore.getState();
}

/** The ceiling in bytes, or `null` when the reader has not set one. */
export function storageCapBytes(): number | null {
  const gb = usePreferencesStore.getState().storageCapGb;
  return gb === 0 ? null : gb * 1024 * 1024 * 1024;
}
