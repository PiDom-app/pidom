import { useCallback } from 'react';
import { useReaderSync } from '@/features/settings/use-reader-sync';
import type { ReaderPreferences } from '@/features/settings/use-desktop-settings';

/**
 * The reader feature's view of the account's reading preferences.
 *
 * A thin adapter over `useReaderSync`, which owns the one Convex read/write path
 * and the localStorage paint cache — this exists so the reader's components and
 * hooks depend on a `{ prefs, update }` shape rather than reaching across into
 * the settings feature's internals. Every field syncs across devices; the
 * staleness guard that keeps an offline change from clobbering a newer one lives
 * in `convex/model/reader.ts`.
 */

export type { ReaderPreferences };

export function useReaderPreferences(): {
  prefs: ReaderPreferences;
  update: (patch: Partial<ReaderPreferences>) => void;
} {
  const { reader, setReader } = useReaderSync();

  const update = useCallback(
    (patch: Partial<ReaderPreferences>) => {
      for (const key of Object.keys(patch) as (keyof ReaderPreferences)[]) {
        const value = patch[key];
        if (value !== undefined) setReader(key, value as ReaderPreferences[typeof key]);
      }
    },
    [setReader],
  );

  return { prefs: reader, update };
}
