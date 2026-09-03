import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * The reader's theme choice.
 *
 * `AsyncStorage`, not `SecureStore`: this is a preference, not a credential,
 * and it needs to be readable fast enough that the first frame is not painted
 * in the wrong theme.
 *
 * `system` is a real third state, not a synonym for whichever theme happens to
 * be active. A reader on `system` who changes the OS setting expects the app to
 * follow; one who picked `dark` expects it to stay dark at noon.
 */

export type ThemeMode = 'light' | 'dark' | 'system';

type ThemeState = {
  mode: ThemeMode;
  /** False until the persisted value has been read back. */
  hydrated: boolean;
  setMode: (mode: ThemeMode) => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'system',
      hydrated: false,
      setMode: (mode) => set({ mode }),
    }),
    {
      name: 'pidom.theme',
      storage: createJSONStorage(() => AsyncStorage),
      // Only `mode` is worth writing back; `hydrated` describes this launch.
      partialize: (state) => ({ mode: state.mode }),
      onRehydrateStorage: () => () => {
        // Fires whether or not the read succeeded. A failure leaves `mode` at
        // its `system` default, which is the right fallback — better than
        // holding the first paint on a storage round trip.
        useThemeStore.setState({ hydrated: true });
      },
    },
  ),
);
