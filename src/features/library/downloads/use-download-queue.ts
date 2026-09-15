import { useConvex, useConvexAuth } from 'convex/react';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { log } from '@/lib/logger';
import { watchNetwork } from '@/lib/connectivity';

import { useLibraryStatus } from '../data/use-library-status';
import { database, watchTables } from '../local/db';
import * as Files from '../local/repository/files';
import { dueForVerification, evictToCap, verify } from './actions';
import { drain, movingNow } from './engine';
import { applyRules } from './rules';
import { releasableOn } from './policy';

const SCOPE = 'downloads';

/** Long enough that queueing four documents is one pass rather than four. */
const SETTLE_MS = 400;

/**
 * The heartbeat, for the deferrals nothing else will wake.
 *
 * A transfer waiting out a backoff has no event to announce that its time has
 * come — the table did not change and the network did not move. Same reasoning
 * as `useSyncEngine`'s, and the same interval, because the two are waiting on
 * the same kind of thing.
 */
const HEARTBEAT_MS = 30_000;

/**
 * Runs the download queue. Mount once, in the authenticated layout.
 *
 * Deliberately a second engine rather than a branch inside `useSyncEngine`.
 * That one drains *changes* and is allowed to retry them freely; this one moves
 * *files*, where a retry is somebody's data allowance and a hold is a setting
 * doing its job rather than a failure. Folding them together would mean one set
 * of backoff rules governing both, and the right rules are not the same.
 *
 * Nothing on any screen waits for it. A reader who never opens Downloads never
 * notices it exists, which is the correct amount of attention for a queue whose
 * whole job is to have already finished by the time somebody looks.
 */
export function useDownloadQueue(): void {
  const { profileId } = useLibraryStatus();
  const { isAuthenticated } = useConvexAuth();
  const client = useConvex();

  /** Guards against two passes overlapping, which would start one transfer twice. */
  const busy = useRef(false);

  useEffect(() => {
    if (profileId === null || !isAuthenticated) {
      return;
    }

    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pass = async () => {
      if (!live || busy.current) {
        return;
      }
      busy.current = true;
      try {
        const db = await database(profileId);
        if (db === null || !live) {
          return;
        }

        // Before fetching anything: a ceiling the reader lowered since the last
        // pass should make room rather than refuse the next download.
        await evictToCap(db, profileId);
        await Files.release(db, releasableOn('space'));

        // What the reader's automatic rules ask for, queued before the drain
        // rather than after it — so a favourite added a minute ago joins this
        // pass instead of waiting for the next one.
        await applyRules(db);

        await drain({ client, db, profileId });

        // And afterwards, with whatever the transfers left free. Only when
        // nothing is moving, so a re-verify never competes with a download for
        // the same disk.
        if (movingNow() === 0) {
          for (const documentId of await dueForVerification(db)) {
            if (!live) {
              return;
            }
            await verify(db, profileId, documentId);
          }
        }
      } catch (error) {
        // A queue that can take down the screen that mounts it is a queue that
        // takes the library with it.
        log.debug(SCOPE, 'a pass failed', error);
      } finally {
        busy.current = false;
      }
    };

    const schedule = (delay: number) => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => void pass(), delay);
    };

    schedule(SETTLE_MS);

    // The table changing is the queue being asked for something.
    const unwatch = watchTables(['documentFiles'], () => schedule(SETTLE_MS));

    /**
     * Wi-Fi coming back is the event this feature exists for.
     *
     * A download held on the bus should start in the reader's pocket when they
     * get home, without anybody tapping anything. `releasableOn` decides which
     * holds that actually clears — a queue held for want of disk space must not
     * all start moving because somebody joined a network.
     */
    const unwatchNetwork = watchNetwork(() => {
      void (async () => {
        const db = await database(profileId);
        if (db === null || !live) {
          return;
        }
        const released = await Files.release(db, releasableOn('network'));
        if (released > 0) {
          log.debug(SCOPE, `${released} download(s) released by a change of network`);
        }
        schedule(SETTLE_MS);
      })();
    });

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        schedule(SETTLE_MS);
      }
    });

    const heartbeat = setInterval(() => void pass(), HEARTBEAT_MS);

    return () => {
      live = false;
      if (timer !== null) {
        clearTimeout(timer);
      }
      clearInterval(heartbeat);
      unwatch();
      unwatchNetwork();
      subscription.remove();
    };
  }, [profileId, isAuthenticated, client]);
}
