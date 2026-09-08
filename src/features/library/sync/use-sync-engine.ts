import { useConvex, useConvexAuth } from 'convex/react';
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';

import { log } from '@/lib/logger';
import { hasNetworkNow, watchNetwork } from '@/lib/connectivity';
import { useSyncStore } from '@/stores/sync-store';

import { useLibraryStatus } from '../data/use-library-status';
import { database, watchTables } from '../local/db';
import * as Queue from '../local/repository/queue';
import { clearStaleTransfers } from '../local/repository/files';
import { drain, reconcile } from './engine';

const SCOPE = 'sync';

/**
 * How long after a change the engine waits before sending.
 *
 * Long enough that a reader turning pages does not open a request per page —
 * they all collapse into one queue row anyway, and this is what stops that row
 * being sent thirty times while they read. Short enough that somebody who
 * favourites a book and immediately opens the account screen sees it land.
 */
const SETTLE_MS = 1_500;

/** A floor between passes, so a queue that keeps failing does not spin. */
const FLOOR_MS = 5_000;

/**
 * The heartbeat, for the deferrals nothing else will wake.
 *
 * An operation waiting out a rate limit or a backoff has no event to announce
 * that its time has come — the queue did not change and the network did not
 * move. This is the only thing that comes back for it.
 */
const HEARTBEAT_MS = 30_000;

/**
 * Runs the outbox. Mount once, in the authenticated layout.
 *
 * Everything it does is a consequence of something else having already
 * happened. A reader's change is written to the device and queued by the action
 * that made it; this notices the queue changed, waits for the reader to stop,
 * and sends. Nothing on any screen waits for it, and turning it off entirely
 * would cost the account its copy of the library and cost the reader nothing
 * until they picked up a second device.
 */
export function useSyncEngine(): void {
  const { profileId } = useLibraryStatus();
  const { isAuthenticated } = useConvexAuth();
  const client = useConvex();
  const setSync = useSyncStore((state) => state.set);

  /** A download that was running when the process went away is not running now. */
  useEffect(() => {
    if (profileId === null) {
      return;
    }
    let live = true;
    void (async () => {
      const db = await database(profileId);
      if (db === null || !live) {
        return;
      }
      await clearStaleTransfers(db);
      const summary = await Queue.summary(db);
      setSync({ pending: summary.pending, failed: summary.failed });
    })();
    return () => {
      live = false;
    };
  }, [profileId, setSync]);

  /**
   * The engine itself, and every reason to run it: a change to the queue, a
   * network coming back, the app returning to the foreground, and a heartbeat
   * for the deferrals none of those will ever wake — an operation waiting out a
   * rate limit has no event to announce that its time has come.
   *
   * It all lives inside one effect rather than in a memoised callback because a
   * pass has to be able to ask for another when work arrived while it was
   * running, and a `useCallback` that schedules itself is a cycle the React
   * Compiler will not optimise past.
   */
  useEffect(() => {
    if (profileId === null) {
      setSync({ phase: 'offline' });
      return;
    }

    let live = true;
    let running = false;
    let again = false;
    let lastRun = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function pass(): Promise<void> {
      if (!live) {
        return;
      }
      if (profileId === null || !isAuthenticated || !hasNetworkNow()) {
        setSync({ phase: 'offline' });
        return;
      }
      if (running) {
        again = true;
        return;
      }
      /**
       * Inside the floor. Wait it out rather than dropping the trigger.
       *
       * This used to set `again` and return, which looks like the branch above
       * it and is not: `again` is only ever consumed in the `finally` of a pass
       * that got past the guards, and `running` is false here — so nothing
       * consumed it and the wake-up was lost. A share tapped two seconds after
       * launch waited for the thirty-second heartbeat.
       */
      const waited = Date.now() - lastRun;
      if (waited < FLOOR_MS) {
        if (timer === null) {
          timer = setTimeout(() => {
            timer = null;
            void pass();
          }, FLOOR_MS - waited);
        }
        return;
      }

      running = true;
      lastRun = Date.now();

      try {
        const db = await database(profileId);
        if (db === null) {
          setSync({ phase: 'error' });
          return;
        }

        setSync({ phase: 'syncing' });
        const result = await drain({ client, db }, profileId);

        const summary = await Queue.summary(db);
        setSync({ pending: summary.pending, failed: summary.failed });

        // The account's answer is only worth reading once this device has
        // finished telling it things. Reconciling with operations still waiting
        // would overwrite a reader's own changes with a version that predates
        // them.
        if (summary.pending === 0) {
          await reconcile({ client, db }, profileId);
          setSync({ lastSyncedAt: Date.now() });
        }

        const after = await Queue.summary(db);
        setSync({
          pending: after.pending,
          failed: after.failed,
          phase: after.failed > 0 ? 'error' : after.pending > 0 ? 'pending' : 'synced',
        });

        log.debug(
          SCOPE,
          `sent ${result.sent}, deferred ${result.deferred}, failed ${result.failed}`,
        );
      } catch (error) {
        // A whole pass that threw is a connection that went away mid-sentence.
        // The queue is untouched and the next trigger tries again.
        log.debug(SCOPE, 'a sync pass did not finish', error);
        setSync({ phase: 'pending' });
      } finally {
        running = false;
        if (again && live) {
          again = false;
          timer = setTimeout(() => {
            timer = null;
            void pass();
          }, FLOOR_MS);
        }
      }
    }

    const soon = () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        void pass();
      }, SETTLE_MS);
    };

    void pass();

    const stopQueue = watchTables(['syncQueue'], soon);
    const stopNetwork = watchNetwork(soon);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        soon();
      }
    });
    const heartbeat = setInterval(() => void pass(), HEARTBEAT_MS);

    return () => {
      live = false;
      if (timer !== null) {
        clearTimeout(timer);
      }
      clearInterval(heartbeat);
      subscription.remove();
      stopQueue();
      stopNetwork();
    };
  }, [client, isAuthenticated, profileId, setSync]);
}

/**
 * Asks for a pass now, from a control a reader pressed.
 *
 * Deliberately separate from the engine's own triggers: the engine paces itself
 * and a reader pulling to refresh should not have to wait out a floor meant for
 * a page turn.
 */
export function useSyncNow(): () => Promise<void> {
  const { profileId } = useLibraryStatus();
  const { isAuthenticated } = useConvexAuth();
  const client = useConvex();
  const setSync = useSyncStore((state) => state.set);

  return useCallback(async () => {
    if (profileId === null || !isAuthenticated) {
      return;
    }
    const db = await database(profileId);
    if (db === null) {
      return;
    }
    try {
      setSync({ phase: 'syncing' });
      await Queue.retryFailed(db, null);
      await drain({ client, db }, profileId);
      const summary = await Queue.summary(db);
      if (summary.pending === 0) {
        await reconcile({ client, db }, profileId);
        setSync({ lastSyncedAt: Date.now() });
      }
      setSync({
        pending: summary.pending,
        failed: summary.failed,
        phase: summary.failed > 0 ? 'error' : summary.pending > 0 ? 'pending' : 'synced',
      });
    } catch (error) {
      log.debug(SCOPE, 'a manual sync did not finish', error);
      setSync({ phase: 'pending' });
    }
  }, [client, isAuthenticated, profileId, setSync]);
}
