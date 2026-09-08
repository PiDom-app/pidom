import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Choices about this device, kept on this device.
 *
 * Deliberately not in `sharingSettings` or `notificationSettings` on the
 * account. Those describe the reader — who may find them, what they want to be
 * told — and they should follow the reader to a new phone. This describes the
 * handset: whether *this* device, on *its* connection, should pull a hundred
 * megabytes down. Syncing that to a tablet on hotel Wi-Fi would be applying one
 * device's answer to another device's question.
 *
 * `AsyncStorage` for the same reason as the theme: it is a preference, not a
 * credential, and it has to be readable before the first transfer is offered.
 */
type PreferencesState = {
  /** Hold large transfers unless the connection is Wi-Fi. Off by default. */
  wifiOnly: boolean;
  /** False until the persisted value has been read back. */
  hydrated: boolean;
  setWifiOnly: (wifiOnly: boolean) => void;
};

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      // Off, because a reader who has not been asked has not said no. The
      // switch is on the Sync & data screen with the storage numbers beside it,
      // which is where somebody who cares about their allowance will look.
      wifiOnly: false,
      hydrated: false,
      setWifiOnly: (wifiOnly) => set({ wifiOnly }),
    }),
    {
      name: 'pidom.preferences',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ wifiOnly: state.wifiOnly }),
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
