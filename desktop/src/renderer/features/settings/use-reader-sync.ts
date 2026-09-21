import { useCallback, useEffect } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import { api } from '@convex/api';
import {
  desktopSettings,
  useDesktopSettings,
  type ReaderPreferences,
} from './use-desktop-settings';

/**
 * The account's reader defaults, synced through Convex.
 *
 * The source of truth is the shared `readerPreferences` row (`api.reader.mine` /
 * `api.reader.update`), so a default chosen on the phone or another computer
 * follows the account here. The local store is only a paint cache: `mine`
 * reconciles it whenever the server value arrives, and every change writes
 * through `update` with the device clock so a change made offline never
 * overwrites a newer one from elsewhere (last-writer-wins lives in the model's
 * `patchPreferences`). Every write derives the owner from the verified JWT;
 * there is no user id to pass.
 *
 * Returns the current preferences (from the cache, which tracks the server) and
 * a setter that updates one field.
 */
export function useReaderSync(): {
  reader: ReaderPreferences;
  isLoading: boolean;
  setReader: <K extends keyof ReaderPreferences>(key: K, value: ReaderPreferences[K]) => void;
} {
  const { reader } = useDesktopSettings();
  const server = useQuery(api.reader.mine, {});
  const update = useMutation(api.reader.update);

  // Reconcile the paint cache with the server whenever a new value lands. The
  // server row is authoritative; `mine` never returns null (defaults fill in).
  useEffect(() => {
    if (server) desktopSettings.setReaderCache(server as ReaderPreferences);
  }, [server]);

  const setReader = useCallback(
    <K extends keyof ReaderPreferences>(key: K, value: ReaderPreferences[K]) => {
      // Optimistic: paint the change now, let the reactive query confirm it.
      desktopSettings.setReaderCache({ ...desktopSettings.get().reader, [key]: value });
      void update({ [key]: value, clientUpdatedAt: Date.now() }).catch(() => {
        toast.error("Couldn't save that reader preference");
      });
    },
    [update],
  );

  return { reader, isLoading: server === undefined, setReader };
}
