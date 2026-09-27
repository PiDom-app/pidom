/// <reference types="vite/client" />
import rateLimiter from '@convex-dev/rate-limiter/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { READER_DEFAULTS } from './model/reader';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

/**
 * Reader preferences: defaults from code, an owner-scoped row once changed, and
 * a stale write dropped.
 *
 * The row-means-defaults contract is the same one `settings.test.ts` guards for
 * the other two settings tables, so these assertions mirror it: an account with
 * no row reads the code defaults, a change writes a row, and a change queued on
 * a device that fell behind does not overwrite a newer one.
 */
function harness() {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
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

/** A fresh account with a verified token, and the identity to call as. */
async function seedUser(t: Harness): Promise<{ subject: string; userId: Id<'users'> }> {
  const n = seq++;
  const subject = `google-oauth2|user-${n}`;
  const userId = await t.run(async (ctx) =>
    ctx.db.insert('users', {
      subject: `user-${n}`,
      email: `user-${n}@example.com`,
      emailVerified: true,
      createdAt: 0,
      lastSeenAt: 0,
    }),
  );
  return { subject, userId };
}

describe('reader preferences', () => {
  test('an account with no row reads the code defaults', async () => {
    const t = harness();
    const { subject } = await seedUser(t);
    const prefs = await t.withIdentity({ subject }).query(api.reader.mine, {});
    expect(prefs).toEqual(READER_DEFAULTS);
  });

  test('a change writes a row and round-trips', async () => {
    const t = harness();
    const { subject } = await seedUser(t);
    const as = t.withIdentity({ subject });

    await as.mutation(api.reader.update, {
      defaultViewMode: 'spread',
      documentBackground: 'dark',
      restorePosition: false,
    });

    const prefs = await as.query(api.reader.mine, {});
    expect(prefs.defaultViewMode).toBe('spread');
    expect(prefs.documentBackground).toBe('dark');
    expect(prefs.restorePosition).toBe(false);
    // Untouched fields still read their defaults, not undefined.
    expect(prefs.pageScaling).toBe(READER_DEFAULTS.pageScaling);
    expect(prefs.pageSpacing).toBe(READER_DEFAULTS.pageSpacing);
  });

  test('a stale clientUpdatedAt is ignored, a newer one wins', async () => {
    const t = harness();
    const { subject } = await seedUser(t);
    const as = t.withIdentity({ subject });

    // A change stamped at t=1000 lands first.
    await as.mutation(api.reader.update, { pageScaling: 'fit-page', clientUpdatedAt: 1000 });
    expect((await as.query(api.reader.mine, {})).pageScaling).toBe('fit-page');

    // A change stamped earlier (queued on a device that was offline) is dropped.
    await as.mutation(api.reader.update, { pageScaling: 'auto', clientUpdatedAt: 500 });
    expect((await as.query(api.reader.mine, {})).pageScaling).toBe('fit-page');

    // A change stamped later wins.
    await as.mutation(api.reader.update, { pageScaling: 'auto', clientUpdatedAt: 2000 });
    expect((await as.query(api.reader.mine, {})).pageScaling).toBe('auto');
  });

  test("one account cannot see another's preferences", async () => {
    const t = harness();
    const a = await seedUser(t);
    const b = await seedUser(t);

    await t.withIdentity({ subject: a.subject }).mutation(api.reader.update, {
      defaultViewMode: 'single',
    });

    // B has changed nothing, so B reads the defaults — not A's row.
    const bPrefs = await t.withIdentity({ subject: b.subject }).query(api.reader.mine, {});
    expect(bPrefs.defaultViewMode).toBe(READER_DEFAULTS.defaultViewMode);
  });

  test('an unauthenticated caller is refused', async () => {
    const t = harness();
    await expect(t.query(api.reader.mine, {})).rejects.toThrow();
  });
});
