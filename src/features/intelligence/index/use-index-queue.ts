/**
 * Runs the index queue. Mount once, in the authenticated layout.
 *
 * `use-download-queue.ts`'s four triggers, because they are the four things
 * that can make a stalled queue worth another look: the table changed, the
 * network changed, the app came back to the foreground, and a heartbeat for the
 * deferrals nothing else will wake.
 *
 * There is a fifth here that the download queue has no use for — **the
 * battery**. Indexing is the only thing this application does that runs the
 * processor flat out for minutes, so plugging a phone in is an event worth
 * waking on, and so is the level crossing back over the floor.
 *
 * **`expo-background-task` is deliberately not used.** Android's WorkManager
 * has a fifteen-minute floor and iOS decides for itself whether a background
 * task runs at all, so neither is what makes a 1,000-page book finish. What
 * makes it finish is the durable cursor and the resume at launch. A background
 * task would be an optimisation on top of a queue that already works without
 * one, and this file does not claim to have it.
 *
 * Nothing on any screen waits for it.
 */
import { useConvexAuth } from 'convex/react';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useLibraryStatus } from '@/features/library/data/use-library-status';
import { database, watchTables } from '@/features/library/local/db';
import * as Jobs from '@/features/library/local/repository/jobs';
import { watchNetwork } from '@/lib/connectivity';
import { log } from '@/lib/logger';

import { evictToCap, sweep } from './actions';
import { pruneConversations } from '../store';
import { watchBattery } from './battery';
import { drain } from './engine';
import { releasableOn } from './policy';

const SCOPE = 'intelligence-queue';

/**
 * Long enough that importing four documents is one pass rather than four.
 *
 * Longer than the download queue's 400ms, because the work behind this one is
 * minutes rather than seconds and there is nothing to gain by starting it
 * promptly.
 */
const SETTLE_MS = 1_500;

/** The same interval the other two engines use, for the same kind of wait. */
const HEARTBEAT_MS = 30_000;

export function useIndexQueue(): void {
  const { profileId } = useLibraryStatus();
  const { isAuthenticated } = useConvexAuth();

  /** Guards against two passes overlapping; `engine.ts` keeps the other half. */
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

        // Whatever was running when the process last went away. The cursor
        // survived, so this costs the batch that was in flight rather than the
        // book. `clearStaleTransfers` does the same for a download, and both
        // have to happen before the drain rather than after it.
        await Jobs.clearStaleJobs(db);

        // A ceiling the reader lowered since the last pass should make room
        // rather than refuse the next document.
        await evictToCap(db);

        // What the mirror has brought down since the last pass. Before the
        // drain rather than after it, so a book whose text finished arriving a
        // minute ago joins this pass instead of waiting for the next one —
        // `use-download-queue.ts` runs `applyRules` in the same position for
        // the same reason.
        await sweep(db, profileId);

        // Cached turns the account has certainly deleted by now. Here rather
        // than on a screen, because the screen that would notice is the one
        // somebody has to open — and a phone holding month-old answers for a
        // conversation the server dropped is the claim in `docs/security.md`
        // being false.
        await pruneConversations(profileId);

        await drain({ db, profileId });
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

    const releaseAnd = (event: 'network' | 'battery') => {
      void (async () => {
        const db = await database(profileId);
        if (db === null || !live) {
          return;
        }
        const released = await Jobs.release(db, releasableOn(event));
        if (released > 0) {
          log.debug(SCOPE, `${released} job(s) released by a change of ${event}`);
        }
        schedule(SETTLE_MS);
      })();
    };

    schedule(SETTLE_MS);

    const unwatch = watchTables(['localJobs'], () => schedule(SETTLE_MS));
    const unwatchNetwork = watchNetwork(() => releaseAnd('network'));

    /**
     * Plugging the phone in is the event this queue exists for.
     *
     * A reader who imports a textbook at eleven at night and puts the phone on
     * a charger should find it searchable in the morning, without having tapped
     * anything. The floor is why it was waiting, and charging is what lifts it.
     */
    const unwatchBattery = watchBattery(() => releaseAnd('battery'));

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
      unwatchBattery();
      subscription.remove();
    };
  }, [profileId, isAuthenticated]);
}
