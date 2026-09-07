import { Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useCallback } from 'react';

import * as Documents from '../local/repository/documents';
import * as Files from '../local/repository/files';
import { useLocalQuery } from '../local/use-local-query';
import type { LibraryDocument } from './types';
import { useLibraryStatus } from './use-library-status';

/**
 * What the library occupies on this phone, largest first.
 *
 * Read from SQLite and the filesystem and from nothing else. The account knows
 * how much it is storing on the reader's behalf; only the device knows what is
 * actually here, which is the whole reason `documentFiles.localBytes` exists
 * rather than a field on `documents`.
 *
 * `Paths.availableDiskSpace` is a synchronous property and is read on every
 * pass rather than cached: the number moves while somebody is deleting things,
 * and a stale figure on the one screen about free space would be worse than no
 * figure at all.
 */

/** One document, with the only two facts this screen needs about it. */
export type StorageEntry = {
  document: LibraryDocument;
  bytes: number;
  /**
   * The account has a copy, so removing it here is reversible.
   *
   * The distinction the screen is built around. Removing a synced document
   * costs a download; removing a local-only one destroys the reader's only
   * copy, and those must not look like the same button.
   */
  recoverable: boolean;
};

export type DeviceStorage = {
  entries: StorageEntry[];
  /** What the library's files add up to on this device. */
  used: number;
  /** What the device says is left, or `null` when it will not say. */
  free: number | null;
  loading: boolean;
};

const TABLES = ['documents', 'documentFiles'] as const;

export function useDeviceStorage(): DeviceStorage {
  const { profileId } = useLibraryStatus();

  const read = useCallback(async (db: SQLiteDatabase) => {
    const [onDevice, used] = await Promise.all([
      Documents.onThisDeviceBySize(db),
      Files.bytesOnDevice(db),
    ]);

    return {
      entries: onDevice.map(({ localBytes, ...document }) => ({
        document,
        bytes: localBytes,
        recoverable: document.isSynced,
      })),
      used,
    };
  }, []);

  const { data, loading } = useLocalQuery(profileId, TABLES, read);

  // Zero and a negative are both "the platform did not answer" — an Android
  // device that refuses the stat call reports 0, and a real device with no room
  // left still reports a few megabytes. Treating either as a fact would put
  // "0 B free" on the screen of a phone that is fine.
  const available = Paths.availableDiskSpace;
  const free = Number.isFinite(available) && available > 0 ? available : null;

  return {
    entries: data?.entries ?? [],
    used: data?.used ?? 0,
    free,
    loading,
  };
}
