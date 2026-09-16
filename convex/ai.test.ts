/// <reference types="vite/client" />
import agent from '@convex-dev/agent/test';
import rateLimiter from '@convex-dev/rate-limiter/test';
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { AI_CONTEXT_PAGES, AI_THREAD_SWEEP } from './model/limits';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

/**
 * Who may ask a model about a book.
 *
 * `sharing.test.ts` is the model for this file and its header says why: it
 * asserts what a caller is allowed to *reach*, through the public API only,
 * and refusals dominate. Ask adds three new ways to be refused and one new
 * thing worth stealing — somebody else's document, read out of this
 * deployment's own `documentPages` and posted to a third party — so every one
 * of them gets a test.
 *
 * The consent cases are the ones to read first. `allowCloud` and
 * `allowAiOnSharedDocuments` are the two switches this feature rests on, and a
 * switch that reads as a protection and is none is the exact failure
 * `docs/security.md` has a paragraph about.
 */

function harness() {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  // The component's own tables, without which every call into it throws before
  // it reaches the thing the test is about.
  agent.register(t);
  return t;
}

const OWNER = {
  subject: 'google-oauth2|owner',
  issuer: 'https://accounts.google.com',
  email: 'owner@example.com',
  emailVerified: true,
  name: 'Document Owner',
};

const READER = {
  subject: 'google-oauth2|reader',
  issuer: 'https://accounts.google.com',
  email: 'reader@example.com',
  emailVerified: true,
  name: 'A Reader',
};

const STRANGER = {
  subject: 'google-oauth2|stranger',
  issuer: 'https://accounts.google.com',
  email: 'stranger@example.com',
  emailVerified: true,
  name: 'Nobody In Particular',
};

function localId(seed: string): string {
  return seed.padEnd(32, '0').slice(0, 32);
}

async function signedIn(t: ReturnType<typeof convexTest>, identity: typeof OWNER) {
  const as = t.withIdentity(identity);
  await as.mutation(api.users.ensureProfile, {});
  return as;
}

/** The error code a refusal carried, or `undefined` if it did not refuse. */
async function codeOf(work: Promise<unknown>): Promise<string | undefined> {
  return await work.then(
    () => undefined,
    (error: unknown) => (error as { data?: { code?: string } }).data?.code,
  );
}

async function userIdOf(
  t: ReturnType<typeof harness>,
  identity: typeof OWNER,
): Promise<Id<'users'>> {
  const subject = identity.subject.slice(identity.subject.lastIndexOf('|') + 1);
  const row = await t.run(
    async (ctx) =>
      await ctx.db
        .query('users')
        .withIndex('by_subject', (q) => q.eq('subject', subject))
        .unique(),
  );
  if (row === null) {
    throw new Error('no profile');
  }
  return row._id;
}

/**
 * A document in the account, with a copy on the server.
 *
 * `sharing.test.ts` carries the same helper, and the `storageKey` is the reason
 * both need one: a document only on the device cannot be shared, because there
 * is nothing for the recipient to fetch.
 */
async function aDocument(
  t: ReturnType<typeof harness>,
  as: Awaited<ReturnType<typeof signedIn>>,
  identity: typeof OWNER = OWNER,
  seed = 'doc1',
): Promise<Id<'documents'>> {
  const documentId = await as.mutation(api.library.importDocument, {
    title: 'Thinking, Fast and Slow',
    byteSize: 4_100_000,
    localId: localId(seed),
  });
  const ownerId = await userIdOf(t, identity);
  await t.run(async (ctx) => {
    await ctx.db.patch('documents', documentId, {
      storageKey: `${ownerId}/${documentId}.pdf`,
      pageCount: 499,
    });
  });
  return documentId;
}

/** Turns Ask on for an account, which is off by default and deliberately so. */
async function allowAsk(as: Awaited<ReturnType<typeof signedIn>>): Promise<void> {
  await as.mutation(api.settings.updateAi, { allowCloud: true });
}

describe('consent', () => {
  test('is off until somebody says otherwise', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    expect((await owner.query(api.settings.mine, {})).ai.allowCloud).toBe(false);
  });

  test('refuses a thread before it refuses anything else', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const documentId = await aDocument(t, owner);

    expect(await codeOf(owner.mutation(api.ai.startThread, { documentId }))).toBe('AI_NOT_ALLOWED');
  });

  test('taken back mid-conversation stops the next question', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const documentId = await aDocument(t, owner);
    await allowAsk(owner);

    const { threadId } = await owner.mutation(api.ai.startThread, { documentId });
    await owner.mutation(api.ai.ask, { threadId, prompt: 'Why?', pages: [1] });

    // The switch is re-read on every question rather than once when the thread
    // was made. Otherwise turning Ask off would stop new conversations and
    // leave every existing one running.
    await owner.mutation(api.settings.updateAi, { allowCloud: false });
    expect(
      await codeOf(owner.mutation(api.ai.ask, { threadId, prompt: 'And then?', pages: [1] })),
    ).toBe('AI_NOT_ALLOWED');
  });
});

describe('somebody else’s book', () => {
  test('cannot be asked about by a stranger', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const stranger = await signedIn(t, STRANGER);
    const documentId = await aDocument(t, owner);
    await allowAsk(stranger);

    // `FORBIDDEN` rather than one of the Ask codes: a caller who cannot reach
    // the document at all is refused before any question about permission is
    // asked, and identically to how they would be refused for a document that
    // does not exist.
    expect(await codeOf(stranger.mutation(api.ai.startThread, { documentId }))).toBe('FORBIDDEN');
  });

  test('is the owner’s call, and the owner’s default is no', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const reader = await signedIn(t, READER);
    const documentId = await aDocument(t, owner);
    await allowAsk(reader);

    const readerId = await userIdOf(t, READER);
    await owner.mutation(api.sharing.createShare, {
      documentId,
      subject: 'user',
      recipientUserId: readerId,
      role: 'viewer',
      canDownload: false,
      canReshare: false,
    });
    const share = (await reader.query(api.sharing.inbox, { filter: 'pending' }))[0];
    await reader.mutation(api.sharing.respondToShare, { shareId: share.id, answer: 'accept' });

    // The reader can open it. They still cannot send it to a model.
    expect(await codeOf(reader.mutation(api.ai.startThread, { documentId }))).toBe(
      'AI_OWNER_REFUSES',
    );

    await owner.mutation(api.settings.updateSharing, { allowAiOnSharedDocuments: true });
    expect(await codeOf(reader.mutation(api.ai.startThread, { documentId }))).toBe(undefined);
  });
});

describe('a conversation', () => {
  test('cannot be read by anybody but the account that has it', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const stranger = await signedIn(t, STRANGER);
    await allowAsk(owner);
    await allowAsk(stranger);

    const { threadId } = await owner.mutation(api.ai.startThread, {});

    expect(
      await codeOf(
        stranger.query(api.ai.messages, {
          threadId,
          paginationOpts: { cursor: null, numItems: 10 },
        }),
      ),
    ).toBe('FORBIDDEN');
    expect(
      await codeOf(stranger.mutation(api.ai.ask, { threadId, prompt: 'Hello', pages: [] })),
    ).toBe('FORBIDDEN');
    expect(await codeOf(stranger.mutation(api.ai.deleteThread, { threadId }))).toBe('FORBIDDEN');
  });

  test('that does not exist is refused the same way as one that does', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    await allowAsk(owner);

    // Identical codes, so the id space cannot be probed for which threads exist.
    expect(await codeOf(owner.mutation(api.ai.deleteThread, { threadId: 'nothing' }))).toBe(
      'FORBIDDEN',
    );
  });

  test('is gone from the list the moment it expires', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    await allowAsk(owner);
    const { threadId } = await owner.mutation(api.ai.startThread, {});

    const page = async (now: number) =>
      (await owner.query(api.ai.threads, { now, paginationOpts: { cursor: null, numItems: 10 } }))
        .page;

    expect(await page(Date.now())).toHaveLength(1);

    // Back-dated rather than waited for. The read filters on the clock the
    // caller passed, which is why the clock is an argument: a query is not
    // re-run because time advanced.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('aiThreads')
        .withIndex('by_thread', (q) => q.eq('threadId', threadId))
        .unique();
      await ctx.db.patch('aiThreads', row!._id, { expiresAt: Date.now() - 1_000 });
    });

    expect(await page(Date.now())).toHaveLength(0);
  });
});

describe('the ceiling on conversations', () => {
  test('does not count ones that have expired', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    await allowAsk(owner);

    // Two live, then both back-dated. The sweep has not run, so the rows are
    // still there — and an expired conversation the reader cannot see must not
    // be one they are charged for.
    await owner.mutation(api.ai.startThread, {});
    await owner.mutation(api.ai.startThread, {});
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('aiThreads').collect()) {
        await ctx.db.patch('aiThreads', row._id, { expiresAt: Date.now() - 1_000 });
      }
    });

    expect(await codeOf(owner.mutation(api.ai.startThread, {}))).toBe(undefined);
  });
});

describe('what a question may carry', () => {
  test('is bounded at the ceiling, whatever the client asks for', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const documentId = await aDocument(t, owner);
    await allowAsk(owner);

    await t.run(async (ctx) => {
      const doc = await ctx.db.get('documents', documentId);
      for (let page = 1; page <= 40; page += 1) {
        await ctx.db.insert('documentPages', {
          ownerId: doc!.ownerId,
          documentId,
          page,
          text: `page ${page}`,
        });
      }
    });

    const context = await t.run(async (ctx) => {
      const Ai = await import('./model/ai');
      // Forty pages asked for, with the account's own setting also at forty.
      // Both are over the ceiling and the ceiling is what applies.
      return await Ai.contextFor(
        ctx,
        documentId,
        Array.from({ length: 40 }, (_, i) => i + 1),
        40,
      );
    });

    expect(context).toHaveLength(AI_CONTEXT_PAGES);
  });

  test('refuses a page number that is not a page', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const documentId = await aDocument(t, owner);
    await allowAsk(owner);
    const { threadId } = await owner.mutation(api.ai.startThread, { documentId });

    expect(await codeOf(owner.mutation(api.ai.ask, { threadId, prompt: 'Why?', pages: [0] }))).toBe(
      'INVALID',
    );
    expect(
      await codeOf(owner.mutation(api.ai.ask, { threadId, prompt: 'Why?', pages: [-4] })),
    ).toBe('INVALID');
    expect(
      await codeOf(owner.mutation(api.ai.ask, { threadId, prompt: 'Why?', pages: [1.5] })),
    ).toBe('INVALID');
  });

  test('refuses a question with nothing in it', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    await allowAsk(owner);
    const { threadId } = await owner.mutation(api.ai.startThread, {});

    expect(await codeOf(owner.mutation(api.ai.ask, { threadId, prompt: '   ', pages: [] }))).toBe(
      'INVALID',
    );
  });
});

describe('the settings a client sends', () => {
  test('cannot turn a retention policy into a setting', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);

    await owner.mutation(api.settings.updateAi, { retentionDays: 100_000 });
    expect((await owner.query(api.settings.mine, {})).ai.retentionDays).toBe(30);

    await owner.mutation(api.settings.updateAi, { retentionDays: -5 });
    expect((await owner.query(api.settings.mine, {})).ai.retentionDays).toBe(1);
  });

  test('cannot raise the page ceiling', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);

    await owner.mutation(api.settings.updateAi, { contextPages: 500 });
    expect((await owner.query(api.settings.mine, {})).ai.contextPages).toBe(AI_CONTEXT_PAGES);
  });

  test('cannot put arbitrary text where a model name goes', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);

    expect(await codeOf(owner.mutation(api.settings.updateAi, { model: 'x'.repeat(5_000) }))).toBe(
      'INVALID',
    );
    expect(await codeOf(owner.mutation(api.settings.updateAi, { model: 'not a model name' }))).toBe(
      'INVALID',
    );

    await owner.mutation(api.settings.updateAi, { model: 'anthropic/claude-3-5-haiku' });
    expect((await owner.query(api.settings.mine, {})).ai.model).toBe('anthropic/claude-3-5-haiku');
  });
});

describe('deleting every conversation', () => {
  test('finishes, rather than stopping after one page', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    await allowAsk(owner);

    // Past `AI_THREAD_SWEEP`, so the first pass cannot finish the job — and
    // written straight to the table, with thread ids the Agent component has
    // never heard of. That is the case that matters: `deleteThreadAsync` throws
    // for a thread it cannot find, and before `forget` caught it one orphaned
    // row aborted the whole pass and the reschedule with it. The same hole was
    // in the nightly retention sweep, where it would have meant "deleted after
    // a month" quietly stopping for every account.
    const userId = await userIdOf(t, OWNER);
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let at = 0; at < AI_THREAD_SWEEP + 12; at += 1) {
        await ctx.db.insert('aiThreads', {
          userId,
          threadId: `thread-${at}`,
          createdAt: now,
          expiresAt: now + 86_400_000,
          lastMessageAt: now,
        });
      }
    });

    await owner.mutation(api.ai.deleteEveryThread, {});
    await t.finishAllScheduledFunctions(() => undefined);

    expect(await t.run(async (ctx) => (await ctx.db.query('aiThreads').collect()).length)).toBe(0);
  });
});

describe('deleting an account', () => {
  test('takes its conversations with it', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    await allowAsk(owner);
    await owner.mutation(api.ai.startThread, {});

    expect(await t.run(async (ctx) => (await ctx.db.query('aiThreads').collect()).length)).toBe(1);

    await owner.mutation(api.account.deleteAccount, {});
    await t.finishAllScheduledFunctions(() => undefined);

    // Both halves: the retention row here, and the messages in the component's
    // own tables that nothing in this schema's cascade would reach.
    expect(await t.run(async (ctx) => (await ctx.db.query('aiThreads').collect()).length)).toBe(0);
    expect(await t.run(async (ctx) => (await ctx.db.query('aiSettings').collect()).length)).toBe(0);
  });
});
