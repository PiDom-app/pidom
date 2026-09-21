/// <reference types="vite/client" />
import rateLimiter from '@convex-dev/rate-limiter/test';
import workflow from '@convex-dev/workflow/test';
import workpool from '@convex-dev/workpool/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { SHARING_DEFAULTS } from './model/settings';
import { READING_ACTIVITY_FLIP_MS } from './model/limits';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

/**
 * The one-time reading-activity backfill, and the cutoff that makes it safe.
 *
 * `showReadingActivity` shipped defaulting to `false` while it governed nothing,
 * then one commit flipped the default to `true` and made `presence.heartbeat`
 * enforce it. A default lives in code, but `patchSharing` writes the whole
 * default set into a row the first time any setting changes — so every account
 * that touched a setting before that commit has `false` baked in and is
 * invisible in every document room despite never choosing to be.
 *
 * `backfillReadingActivity` repairs exactly those rows. The assertions that
 * matter are the two edges of its cutoff:
 *
 *   - a `false` written before the flip is the old default, not a decision, and
 *     is reset to `true`;
 *   - a `false` written at or after the flip is a deliberate opt-out, and is
 *     left alone.
 */
function harness() {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  workflow.register(t);
  workpool.register(t, 'maintenance');
  return t;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type Harness = ReturnType<typeof harness>;

let seq = 0;

/** A `sharingSettings` row for a fresh account, with the two fields under test set. */
async function seedSettings(
  t: Harness,
  values: { showReadingActivity: boolean; updatedAt: number },
): Promise<Id<'sharingSettings'>> {
  const n = seq++;
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', {
      subject: `google-oauth2|user-${n}`,
      email: `user-${n}@example.com`,
      emailVerified: true,
      createdAt: 0,
      lastSeenAt: 0,
    });
    return await ctx.db.insert('sharingSettings', {
      userId,
      ...SHARING_DEFAULTS,
      showReadingActivity: values.showReadingActivity,
      updatedAt: values.updatedAt,
    });
  });
}

async function readingActivityOf(t: Harness, id: Id<'sharingSettings'>): Promise<boolean> {
  return await t.run(async (ctx) => {
    const row = await ctx.db.get('sharingSettings', id);
    if (row === null) {
      throw new Error('row gone');
    }
    return row.showReadingActivity;
  });
}

describe('backfillReadingActivity', () => {
  test('resets a stale pre-flip false, and only that', async () => {
    const t = harness();

    // Written before the flip, still `false`: the old default, nobody's choice.
    const stale = await seedSettings(t, {
      showReadingActivity: false,
      updatedAt: READING_ACTIVITY_FLIP_MS - 1,
    });
    // Written after the flip, `false`: somebody turned presence off on purpose.
    const chosen = await seedSettings(t, {
      showReadingActivity: false,
      updatedAt: READING_ACTIVITY_FLIP_MS + 1,
    });
    // Already `true`: nothing to do.
    const on = await seedSettings(t, {
      showReadingActivity: true,
      updatedAt: READING_ACTIVITY_FLIP_MS - 1,
    });

    // The dry run counts exactly the row the patch will change.
    expect(await t.query(internal.maintenance.staleReadingActivityCount, {})).toBe(1);

    await t.mutation(internal.maintenance.backfillReadingActivity, { cursor: null });

    expect(await readingActivityOf(t, stale)).toBe(true);
    expect(await readingActivityOf(t, chosen)).toBe(false);
    expect(await readingActivityOf(t, on)).toBe(true);

    // Idempotent: nothing left stale, so a second run is a no-op.
    expect(await t.query(internal.maintenance.staleReadingActivityCount, {})).toBe(0);
  });

  test('walks every page, not just the first', async () => {
    const t = harness();

    // More rows than one page holds, all stale, so the job must reschedule
    // itself with the cursor to finish them.
    const ids: Id<'sharingSettings'>[] = [];
    for (let i = 0; i < 150; i++) {
      ids.push(
        await seedSettings(t, {
          showReadingActivity: false,
          updatedAt: READING_ACTIVITY_FLIP_MS - 1,
        }),
      );
    }

    expect(await t.query(internal.maintenance.staleReadingActivityCount, {})).toBe(150);

    await t.mutation(internal.maintenance.backfillReadingActivity, { cursor: null });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.query(internal.maintenance.staleReadingActivityCount, {})).toBe(0);
    for (const id of ids) {
      expect(await readingActivityOf(t, id)).toBe(true);
    }
  });
});
