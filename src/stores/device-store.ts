import { create } from 'zustand';

/**
 * Which of the account's registered devices this one is.
 *
 * Not persisted, and not a credential. `notifications.registerDevice` returns
 * the id of the `deviceTokens` row it just wrote, and the settings screen uses
 * it to mark one row in the list "This device" — the only way to tell two
 * Android phones apart when the push token itself never comes back out of the
 * account.
 *
 * In memory because it is re-established on every authenticated launch that has
 * permission and a network, which is exactly when the settings screen can do
 * anything with it. A launch that never registers has nothing to mark, which is
 * the honest state rather than a stale id read off the disk.
 */
type DeviceState = {
  deviceId: string | null;
  setDeviceId: (deviceId: string | null) => void;
};

export const useDeviceStore = create<DeviceState>((set) => ({
  deviceId: null,
  setDeviceId: (deviceId) => set({ deviceId }),
}));
