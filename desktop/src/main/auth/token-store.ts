import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Durable storage for the ONE credential that has to survive a relaunch: the
 * Google refresh token. This is the desktop analogue of the mobile app's
 * `expo-secure-store` (WHEN_UNLOCKED_THIS_DEVICE_ONLY) use.
 *
 * The rules mirror the mobile security model:
 *   - The ID token is never written here; it lives in memory for the session.
 *   - The refresh token is encrypted at rest with Electron `safeStorage`, which
 *     is backed by the OS keychain (Keychain / DPAPI / libsecret).
 *   - It is never logged, and the renderer never sees it.
 */
const FILE = () => join(app.getPath('userData'), 'pidom-refresh.bin');

export function saveRefreshToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fail closed rather than write a bearer credential in the clear — the same
    // stance the mobile SQLCipher path takes when the cipher is unavailable.
    throw new Error('OS secure storage is unavailable; refusing to persist the refresh token.');
  }
  const encrypted = safeStorage.encryptString(token);
  writeFileSync(FILE(), encrypted, { mode: 0o600 });
}

export function loadRefreshToken(): string | null {
  const path = FILE();
  if (!existsSync(path)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const encrypted = readFileSync(path);
    return safeStorage.decryptString(encrypted);
  } catch {
    // A key rotation or a corrupt file means the reader signs in again.
    return null;
  }
}

export function clearRefreshToken(): void {
  const path = FILE();
  if (existsSync(path)) rmSync(path, { force: true });
}
