import { useEffect, useState } from 'react';
import { type SQLiteDatabase } from 'expo-sqlite';

import { log } from '@/lib/logger';

import { database, watchTables } from './db';

const SCOPE = 'local-query';

/**
 * A burst of row events settles into one re-run.
 *
 * `addDatabaseChangeListener` fires per row, so a reconcile writing two hundred
 * documents would otherwise re-run every mounted query two hundred times. One
 * frame of quiet is long enough to let a transaction finish and short enough
 * that nobody sees the delay.
 */
const SETTLE_MS = 24;

export type LocalQuery<T> = {
  /** `null` until the first answer, and after a failure. */
  data: T | null;
  /** True only before the first answer. A re-run does not put it back. */
  loading: boolean;
};

/**
 * Reads the device's database, and reads it again when it changes.
 *
 * This is what `useQuery` from `convex/react` is to the backend: the screens
 * subscribe to the local database and re-render when a row moves, whoever moved
 * it — a reader tapping a control, the sync engine draining its queue, or a
 * reconcile bringing another device's changes down. Nothing has to be told by
 * hand that something else wrote.
 *
 * `run` must be stable — wrap it in `useCallback` — and `tables` must be a
 * module-level constant. Both are read as dependencies, and an array or a
 * closure rebuilt on every render would re-subscribe on every render.
 *
 * A failure answers `null` rather than throwing. Every caller is a screen that
 * has to render something either way, and unlike `convex/react` there is no
 * error boundary story for a query that throws inside an effect.
 */
export function useLocalQuery<T>(
  profileId: string | null,
  tables: readonly string[],
  run: (db: SQLiteDatabase) => Promise<T>,
): LocalQuery<T> {
  const [state, setState] = useState<LocalQuery<T>>({ data: null, loading: true });

  const key = tables.join(',');

  useEffect(() => {
    let live = true;
    let running = false;
    let queued = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function execute(): Promise<void> {
      if (!live) {
        return;
      }
      if (running) {
        queued = true;
        return;
      }
      running = true;

      try {
        const db = profileId === null ? null : await database(profileId);
        const data = db === null ? null : await run(db);
        if (live) {
          setState({ data, loading: false });
        }
      } catch (error) {
        log.debug(SCOPE, 'a local read failed', error);
        if (live) {
          setState({ data: null, loading: false });
        }
      } finally {
        running = false;
        if (queued && live) {
          queued = false;
          void execute();
        }
      }
    }

    void execute();

    const stop = watchTables(tables, () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        void execute();
      }, SETTLE_MS);
    });

    return () => {
      live = false;
      if (timer !== null) {
        clearTimeout(timer);
      }
      stop();
    };
    // `tables` is a module-level constant, and `key` is what changes when its
    // contents do — depending on the array itself would resubscribe whenever a
    // caller happened to rebuild it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, key, run]);

  return state;
}
