/// <reference types="vite/client" />
import actionRetrier from '@convex-dev/action-retrier/test';
import pushNotifications from '@convex-dev/expo-push-notifications/test';
import presence from '@convex-dev/presence/test';
import workpool from '@convex-dev/workpool/test';
import r2 from '@convex-dev/r2/test';
import rateLimiter from '@convex-dev/rate-limiter/test';
import workflow from '@convex-dev/workflow/test';
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { DISPLAY_NAME_MAX, GROUP_DESCRIPTION_MAX } from './model/limits';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

/**
 * What sharing has to refuse.
 *
 * Almost every test here asserts that something **does not** work, and that is
 * the point. Sharing is the only feature in this backend that hands one account
 * something belonging to another, so the interesting assertions are the ones
 * about the door being shut: a viewer who cannot annotate, a recipient who
 * cannot download, a revoked share that stops working, a reshare that cannot
 * grant more than the resharer holds.
 *
 * The positive cases are here too, but they are the cheap half. A feature that
 * works and does not refuse is a feature that has not been tested.
 *
 * These call the public API rather than reading the database, which is the
 * opposite of what `sync.test.ts` does — and for the opposite reason. That file
 * asserts what a mutation *wrote*; this one asserts what a caller is *allowed
 * to reach*, and the only honest way to ask that is through the same functions
 * a client would call.
 */

/**
 * A test deployment with the components sharing actually reaches.
 *
 * More than `sync.test.ts` registers, and each one is on the path rather than
 * registered defensively: **rate limiter** because every mutation here spends a
 * bucket, **push notifications** because creating a share hands the component a
 * batch, **workflow** because a group share starts a fan-out, and **presence**
 * because
 * the heartbeat tests call it, and **R2** because deleting a document deletes
 * its objects and because one test asserts that a permitted recipient really
 * does get a URL. The credentials it signs with are the throwaway ones in
 * `vitest.config.ts` and address a bucket that does not exist; signing is local
 * arithmetic, so nothing here reaches Cloudflare.
 */
function harness() {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  workpool.register(t, 'receipts');
  workflow.register(t);
  presence.register(t);
  pushNotifications.register(t);
  r2.register(t);
  // R2 mounts the action retrier beneath itself, so it lives at
  // `r2/actionRetrier`. Its own test helper registers it at the bare
  // `actionRetrier`, which is not where `deleteObject` looks — so the nested
  // name is registered here as well. Harmless if that helper is ever corrected.
  actionRetrier.register(t, 'r2/actionRetrier');
  return t;
}

const OWNER = {
  subject: 'google-oauth2|owner',
  issuer: 'https://accounts.google.com',
  email: 'owner@example.com',
  emailVerified: true,
  name: 'Document Owner',
};

const FRIEND = {
  subject: 'google-oauth2|friend',
  issuer: 'https://accounts.google.com',
  email: 'friend@example.com',
  emailVerified: true,
  name: 'A Friend',
};

const STRANGER = {
  subject: 'google-oauth2|stranger',
  issuer: 'https://accounts.google.com',
  email: 'stranger@example.com',
  emailVerified: true,
  name: 'A Stranger',
};

function localId(seed: string): string {
  return seed.padEnd(32, '0').slice(0, 32);
}

async function signedIn(t: ReturnType<typeof harness>, identity: typeof OWNER) {
  const as = t.withIdentity(identity);
  await as.mutation(api.users.ensureProfile, {});
  return as;
}

async function userIdOf(t: ReturnType<typeof harness>, identity: typeof OWNER) {
  const subject = identity.subject.slice(identity.subject.lastIndexOf('|') + 1);
  const row = await t.run(async (ctx) =>
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
 * A document with a cloud copy.
 *
 * `storageKey` is written directly rather than through `attachUpload`, which
 * would need R2 registered for a fact these tests only need to be true. What
 * matters is that `create` refuses a document without one, and there is a test
 * for exactly that below.
 */
async function aSyncedDocument(
  t: ReturnType<typeof harness>,
  as: Awaited<ReturnType<typeof signedIn>>,
  seed = 'doc1',
): Promise<Id<'documents'>> {
  const documentId = await as.mutation(api.library.importDocument, {
    title: 'Thinking, Fast and Slow',
    byteSize: 4_100_000,
    localId: localId(seed),
  });
  const ownerId = await userIdOf(t, OWNER);
  await t.run(async (ctx) => {
    await ctx.db.patch('documents', documentId, {
      storageKey: `${ownerId}/${documentId}.pdf`,
      pageCount: 499,
    });
  });
  return documentId;
}

/** Offers it, and has the recipient accept. The state most tests start from. */
async function sharedWith(
  t: ReturnType<typeof harness>,
  owner: Awaited<ReturnType<typeof signedIn>>,
  recipient: Awaited<ReturnType<typeof signedIn>>,
  documentId: Id<'documents'>,
  grant: Partial<{ role: 'viewer' | 'annotator'; canDownload: boolean; canReshare: boolean }> = {},
) {
  const recipientUserId = await userIdOf(t, FRIEND);
  const shareId = await owner.mutation(api.sharing.createShare, {
    documentId,
    subject: 'user',
    recipientUserId,
    role: grant.role ?? 'viewer',
    canDownload: grant.canDownload ?? false,
    canReshare: grant.canReshare ?? false,
  });
  await recipient.mutation(api.sharing.respondToShare, { shareId, answer: 'accept' });
  return shareId;
}

/**
 * Whether this account can reach this document at all.
 *
 * `sharing.accessList` is the readability probe the tests use: it is the one
 * surviving public query that runs `requireReadable` and spends no bucket, so
 * it can be asked the same question a hundred times in one file.
 */
async function reaches(
  who: Awaited<ReturnType<typeof signedIn>>,
  documentId: Id<'documents'>,
): Promise<boolean> {
  return await who
    .query(api.sharing.accessList, { documentId })
    .then(() => true)
    .catch(() => false);
}

/** The caller's own view of one share, as their inbox reports it. */
async function inboxEntry(
  who: Awaited<ReturnType<typeof signedIn>>,
  match: (share: { id: string; document: { id: string; title: string } | null }) => boolean,
) {
  const shares = await who.query(api.sharing.inbox, { filter: 'all' });
  return shares.find(match) ?? null;
}

/* ── the door ───────────────────────────────────────────────────────── */

describe('a stranger', () => {
  test('cannot read a document nobody shared with them', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const stranger = await signedIn(t, STRANGER);
    const documentId = await aSyncedDocument(t, owner);

    await expect(stranger.query(api.sharing.accessList, { documentId })).rejects.toThrow();
    await expect(stranger.query(api.library.outline, { documentId })).rejects.toThrow();
    await expect(
      stranger.query(api.library.pagesOf, { documentId, after: 0 }),
    ).rejects.toThrow();
    await expect(
      stranger.mutation(api.sharing.shareDownloadUrl, { documentId, what: 'document' }),
    ).rejects.toThrow();
  });

  test('cannot tell a document that exists from one that does not', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const stranger = await signedIn(t, STRANGER);
    const real = await aSyncedDocument(t, owner);

    const onReal = await stranger
      .query(api.sharing.accessList, { documentId: real })
      .catch((error: unknown) => (error as { data?: { code?: string } }).data?.code);

    // A well-formed id for a row that was deleted: the same shape of answer.
    const deleted = await aSyncedDocument(t, owner, 'gone');
    await owner.mutation(api.library.remove, { documentId: deleted });
    const onGone = await stranger
      .query(api.sharing.accessList, { documentId: deleted })
      .catch((error: unknown) => (error as { data?: { code?: string } }).data?.code);

    expect(onReal).toBe('FORBIDDEN');
    expect(onGone).toBe('FORBIDDEN');
  });

  test('cannot answer a share addressed to somebody else', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const stranger = await signedIn(t, STRANGER);
    const documentId = await aSyncedDocument(t, owner);

    const shareId = await owner.mutation(api.sharing.createShare, {
      documentId,
      subject: 'user',
      recipientUserId: await userIdOf(t, FRIEND),
      role: 'viewer',
      canDownload: false,
      canReshare: false,
    });

    await expect(
      stranger.mutation(api.sharing.respondToShare, { shareId, answer: 'accept' }),
    ).rejects.toThrow();

    // And the person it was for still can.
    await friend.mutation(api.sharing.respondToShare, { shareId, answer: 'accept' });
  });

  test('cannot revoke somebody else’s share', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const stranger = await signedIn(t, STRANGER);
    const documentId = await aSyncedDocument(t, owner);
    const shareId = await sharedWith(t, owner, friend, documentId);

    await expect(
      stranger.mutation(api.sharing.revokeShare, { shareId }),
    ).rejects.toThrow();
  });
});

/* ── what a role actually buys ──────────────────────────────────────── */

describe('a viewer', () => {
  test('can read, and cannot annotate', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    await sharedWith(t, owner, friend, documentId, { role: 'viewer' });

    expect(await reaches(friend, documentId)).toBe(true);
    const entry = await inboxEntry(friend, (share) => share.document?.id === documentId);
    expect(entry?.document?.title).toBe('Thinking, Fast and Slow');

    await expect(
      friend.mutation(api.library.addAnnotation, {
        documentId,
        currentPage: 12,
        kind: 'note',
        note: 'A note I am not allowed to write',
      }),
    ).rejects.toThrow();
  });

  test('cannot download, even after accepting', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    await sharedWith(t, owner, friend, documentId, { canDownload: false });

    await expect(
      friend.mutation(api.sharing.shareDownloadUrl, { documentId, what: 'document' }),
    ).rejects.toThrow();
  });
});

describe('an annotator', () => {
  test('can write a note, and it belongs to them', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    await sharedWith(t, owner, friend, documentId, { role: 'annotator' });

    await friend.mutation(api.library.addAnnotation, {
      documentId,
      currentPage: 12,
      kind: 'note',
      note: 'Chapter 4 is the one we argued about',
    });

    const rows = await t.run(async (ctx) =>
      await ctx.db
        .query('documentAnnotations')
        .withIndex('by_document_and_created', (q) => q.eq('documentId', documentId))
        .collect(),
    );

    expect(rows).toHaveLength(1);
    // The document's owner, so the delete cascade still reaches it...
    expect(rows[0].ownerId).toBe(await userIdOf(t, OWNER));
    // ...and the friend, because they are the one who wrote it.
    expect(rows[0].authorId).toBe(await userIdOf(t, FRIEND));
    expect(rows[0].visibility).toBe('shared');
  });

  test('finds their own note again on the next reconcile', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    await sharedWith(t, owner, friend, documentId, { role: 'annotator' });

    await friend.mutation(api.library.addAnnotation, {
      documentId,
      currentPage: 12,
      kind: 'note',
      note: 'Mine',
    });

    // `by_owner` cannot see it — the row carries the owner's id.
    const throughOwner = await friend.query(api.library.allAnnotations, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(throughOwner.page).toHaveLength(0);

    // `by_author` is what makes it reachable, which is why that index exists.
    const throughAuthor = await friend.query(api.sharing.myAnnotationsElsewhere, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(throughAuthor.page).toHaveLength(1);
    expect(throughAuthor.page[0].note).toBe('Mine');
  });
});

/* ── taking it back ─────────────────────────────────────────────────── */

describe('revoking', () => {
  test('stops everything the share allowed', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    const shareId = await sharedWith(t, owner, friend, documentId, {
      role: 'annotator',
      canDownload: true,
    });

    // Live first, so the test is about the revoke rather than about a share
    // that never worked.
    expect(
      await friend.mutation(api.sharing.shareDownloadUrl, { documentId, what: 'document' }),
    ).toBeTypeOf('string');

    await owner.mutation(api.sharing.revokeShare, { shareId });

    await expect(
      friend.mutation(api.sharing.shareDownloadUrl, { documentId, what: 'document' }),
    ).rejects.toThrow();
    expect(await reaches(friend, documentId)).toBe(false);
    await expect(
      friend.mutation(api.library.addAnnotation, { documentId, currentPage: 1, kind: 'note', note: 'x' }),
    ).rejects.toThrow();
  });

  test('takes the recipient’s notes off the owner’s document', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    const shareId = await sharedWith(t, owner, friend, documentId, { role: 'annotator' });

    await friend.mutation(api.library.addAnnotation, {
      documentId,
      currentPage: 12,
      kind: 'note',
      note: 'Written under a permission that is about to go',
    });
    await owner.mutation(api.sharing.revokeShare, { shareId });

    const rows = await t.run(async (ctx) =>
      await ctx.db
        .query('documentAnnotations')
        .withIndex('by_document_and_created', (q) => q.eq('documentId', documentId))
        .collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test('leaves the share row behind, so the recipient can be told why', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    const shareId = await sharedWith(t, owner, friend, documentId);

    await owner.mutation(api.sharing.revokeShare, { shareId });

    const share = await inboxEntry(friend, (row) => row.id === shareId);
    expect(share?.status).toBe('revoked');
    expect(share?.revokedAt).toBeTypeOf('number');
  });
});

describe('expiry', () => {
  test('refuses on a fresh clock, before the sweep has run', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    const shareId = await sharedWith(t, owner, friend, documentId, { canDownload: true });

    await t.run(async (ctx) => {
      await ctx.db.patch('documentShares', shareId, { expiresAt: Date.now() - 1000 });
    });

    await expect(
      friend.mutation(api.sharing.shareDownloadUrl, { documentId, what: 'document' }),
    ).rejects.toThrow();
    expect(await reaches(friend, documentId)).toBe(false);
  });

  /**
   * The refusal above cannot mark the row, and this is why the cron exists.
   *
   * A Convex mutation is one transaction, so a handler that patches the share
   * and then throws rolls the patch back along with everything else — the
   * caller is refused and the row still says `accepted`. The first version of
   * `refuseIfExpired` did exactly that and this test is what found it.
   */
  test('is written down by the sweep, not by the refusal', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    const shareId = await sharedWith(t, owner, friend, documentId, { canDownload: true });

    await t.run(async (ctx) => {
      await ctx.db.patch('documentShares', shareId, { expiresAt: Date.now() - 1000 });
    });

    await friend
      .mutation(api.sharing.shareDownloadUrl, { documentId, what: 'document' })
      .catch(() => undefined);
    expect(
      (await t.run(async (ctx) => await ctx.db.get('documentShares', shareId)))?.status,
    ).toBe('accepted');

    await t.run(async (ctx) => {
      const { expireDue } = await import('./model/sharing');
      await expireDue(ctx, 100);
    });

    expect(
      (await t.run(async (ctx) => await ctx.db.get('documentShares', shareId)))?.status,
    ).toBe('expired');
  });
});

/* ── a reshare cannot grow ──────────────────────────────────────────── */

describe('resharing', () => {
  test('is refused outright without permission', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    await signedIn(t, STRANGER);
    const documentId = await aSyncedDocument(t, owner);
    await sharedWith(t, owner, friend, documentId, { canReshare: false });

    await expect(
      friend.mutation(api.sharing.createShare, {
        documentId,
        subject: 'user',
        recipientUserId: await userIdOf(t, STRANGER),
        role: 'viewer',
        canDownload: false,
        canReshare: false,
      }),
    ).rejects.toThrow();
  });

  test('cannot grant a higher role than the resharer holds', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    await signedIn(t, STRANGER);
    const documentId = await aSyncedDocument(t, owner);
    await sharedWith(t, owner, friend, documentId, { role: 'viewer', canReshare: true });

    const shareId = await friend.mutation(api.sharing.createShare, {
      documentId,
      subject: 'user',
      recipientUserId: await userIdOf(t, STRANGER),
      // Asking for more than they have, in all three dimensions.
      role: 'annotator',
      canDownload: true,
      canReshare: true,
    });

    const share = await t.run(async (ctx) => await ctx.db.get('documentShares', shareId));
    expect(share?.role).toBe('viewer');
    expect(share?.canDownload).toBe(false);
    // Never, for anybody who is not the owner: a reshare cannot itself be reshared.
    expect(share?.canReshare).toBe(false);
  });
});

/* ── discovery ──────────────────────────────────────────────────────── */

describe('finding people', () => {
  test('matches an exact handle and never a prefix of one', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    await friend.mutation(api.settings.setHandle, { handle: 'afriend' });

    expect(await owner.query(api.sharing.findPeople, { term: '@afriend' })).toHaveLength(1);
    expect(await owner.query(api.sharing.findPeople, { term: 'afriend' })).toHaveLength(1);
    // A prefix reaches nobody the caller has no connection to. This is the
    // whole reason there is no search index over accounts.
    expect(await owner.query(api.sharing.findPeople, { term: 'afrie' })).toHaveLength(0);
    expect(await owner.query(api.sharing.findPeople, { term: 'a' })).toHaveLength(0);
  });

  test('never returns an email address, even when it matched on one', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    await signedIn(t, FRIEND);

    const found = await owner.query(api.sharing.findPeople, { term: 'friend@example.com' });
    expect(found).toHaveLength(1);
    expect(Object.keys(found[0]).sort()).toEqual([
      'displayName',
      'handle',
      'id',
      'pictureUrl',
    ]);
  });

  test('respects an account that has turned discovery off', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    await friend.mutation(api.settings.setHandle, { handle: 'afriend' });
    await friend.mutation(api.settings.updateSharing, { findableBy: 'nobody' });

    expect(await owner.query(api.sharing.findPeople, { term: '@afriend' })).toHaveLength(0);
    expect(
      await owner.query(api.sharing.findPeople, { term: 'friend@example.com' }),
    ).toHaveLength(0);
  });

  test('refuses a share to somebody who accepts none', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    await friend.mutation(api.settings.updateSharing, { shareableBy: 'nobody' });
    const documentId = await aSyncedDocument(t, owner);

    await expect(
      owner.mutation(api.sharing.createShare, {
        documentId,
        subject: 'user',
        recipientUserId: await userIdOf(t, FRIEND),
        role: 'viewer',
        canDownload: false,
        canReshare: false,
      }),
    ).rejects.toThrow();
  });

  test('will not let two accounts hold the same handle', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);

    await owner.mutation(api.settings.setHandle, { handle: 'reader' });
    await expect(
      friend.mutation(api.settings.setHandle, { handle: 'Reader' }),
    ).rejects.toThrow();
  });
});

/* ── the profile other people see ───────────────────────────────────── */

describe('a profile', () => {
  test('follows Google, and takes the photo at a size worth rendering', async () => {
    const t = harness();
    const withPhoto = {
      ...FRIEND,
      name: 'A Friend',
      pictureUrl: 'https://lh3.googleusercontent.com/a/opaque=s96-c',
    };
    const as = t.withIdentity(withPhoto);
    await as.mutation(api.users.ensureProfile, {});

    // 96 device-independent pixels is what Google's claim carries and a third
    // of what the account screen draws.
    expect((await as.query(api.users.me, {}))?.pictureUrl).toBe(
      'https://lh3.googleusercontent.com/a/opaque=s240-c',
    );

    // And a later launch picks up a changed photo and a changed name. This is
    // the branch `useEnsureProfile` could not reach: its guard fired only when
    // `users.me` answered `null`, so every launch after the first returned
    // early and the row stayed frozen at whatever the first token said.
    const renamed = t.withIdentity({
      ...withPhoto,
      name: 'Renamed Friend',
      pictureUrl: 'https://lh3.googleusercontent.com/a/different=s96-c',
    });
    await renamed.mutation(api.users.ensureProfile, {});

    const after = await renamed.query(api.users.me, {});
    expect(after?.name).toBe('Renamed Friend');
    expect(after?.pictureUrl).toBe(
      'https://lh3.googleusercontent.com/a/different=s240-c',
    );
  });

  test('leaves a photo URL that carries no size alone', async () => {
    const t = harness();
    const as = t.withIdentity({ ...OWNER, pictureUrl: 'https://example.test/face.png' });
    await as.mutation(api.users.ensureProfile, {});

    expect((await as.query(api.users.me, {}))?.pictureUrl).toBe(
      'https://example.test/face.png',
    );
  });
});

/* ── the second door into discovery ─────────────────────────────────── */

describe('a profile lookup by id', () => {
  test('is refused between accounts with nothing between them', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    await signedIn(t, STRANGER);

    // Search will not return them, so this is the other way somebody could try
    // to resolve a name: hand the id straight to `profile`. Being authenticated
    // is not a relationship.
    expect(
      await owner.query(api.sharing.profile, { userId: await userIdOf(t, STRANGER) }),
    ).toBeNull();
  });

  test('works once a document has passed between them', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    await sharedWith(t, owner, friend, documentId);

    const seen = await owner.query(api.sharing.profile, {
      userId: await userIdOf(t, FRIEND),
    });
    expect(seen?.profile.displayName).toBe('A Friend');
    // And the context that makes the sheet honest: one document has passed
    // between them, which is why the profile is visible at all.
    expect(seen?.sharedDocuments).toBe(1);
    expect(seen?.sharedGroups).toEqual([]);

    expect(
      (await friend.query(api.sharing.profile, { userId: await userIdOf(t, OWNER) }))?.profile
        .displayName,
    ).toBe('Document Owner');
  });
});

describe('the access list', () => {
  test('shows a recipient only what they shared themselves', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const stranger = await signedIn(t, STRANGER);
    const documentId = await aSyncedDocument(t, owner);

    await sharedWith(t, owner, friend, documentId, { canReshare: true });
    await owner.mutation(api.sharing.createShare, {
      documentId,
      subject: 'user',
      recipientUserId: await userIdOf(t, STRANGER),
      role: 'viewer',
      canDownload: false,
      canReshare: false,
    });

    // The owner sees both grants; a recipient sees neither, because they made
    // neither. Being handed a document is not being handed the owner's address
    // book.
    expect(await owner.query(api.sharing.accessList, { documentId })).toHaveLength(2);
    expect(await friend.query(api.sharing.accessList, { documentId })).toHaveLength(0);
    void stranger;
  });
});

/* ── groups ─────────────────────────────────────────────────────────── */

describe('a group', () => {
  test('grants on membership and takes it back on leaving', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);

    const groupId = await owner.mutation(api.groups.create, { name: 'Reading group' });
    await owner.mutation(api.groups.addMember, {
      groupId,
      userId: await userIdOf(t, FRIEND),
    });
    await owner.mutation(api.sharing.createShare, {
      documentId,
      subject: 'group',
      groupId,
      role: 'viewer',
      canDownload: false,
      canReshare: false,
    });

    // No accept step: being in the group is the agreement.
    const seen = await inboxEntry(friend, (share) => share.document?.id === documentId);
    expect(seen?.document?.title).toBe('Thinking, Fast and Slow');

    await owner.mutation(api.groups.removeMember, {
      groupId,
      userId: await userIdOf(t, FRIEND),
    });
    expect(await reaches(friend, documentId)).toBe(false);
  });

  test('cannot be shared into by somebody who is not in it', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const stranger = await signedIn(t, STRANGER);
    const groupId = await owner.mutation(api.groups.create, { name: 'Reading group' });

    const theirDocument = await stranger.mutation(api.library.importDocument, {
      title: 'Something of theirs',
      byteSize: 100,
      localId: localId('theirs'),
    });
    const strangerId = await userIdOf(t, STRANGER);
    await t.run(async (ctx) => {
      await ctx.db.patch('documents', theirDocument, {
        storageKey: `${strangerId}/${theirDocument}.pdf`,
      });
    });

    await expect(
      stranger.mutation(api.sharing.createShare, {
        documentId: theirDocument,
        subject: 'group',
        groupId,
        role: 'viewer',
        canDownload: false,
        canReshare: false,
      }),
    ).rejects.toThrow();
  });

  test('cannot be read by somebody who is not in it', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const stranger = await signedIn(t, STRANGER);
    const groupId = await owner.mutation(api.groups.create, { name: 'Reading group' });

    await expect(stranger.query(api.groups.detail, { groupId })).rejects.toThrow();
    await expect(
      stranger.mutation(api.groups.addMember, { groupId, userId: await userIdOf(t, STRANGER) }),
    ).rejects.toThrow();
  });
});

/* ── the rules that are not about people ────────────────────────────── */

describe('sharing a document', () => {
  test('is refused when there is no cloud copy to share', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);

    // Imported, never synced: it exists only on the sender's phone.
    const documentId = await owner.mutation(api.library.importDocument, {
      title: 'Local only',
      byteSize: 100,
      localId: localId('local'),
    });

    await expect(
      owner.mutation(api.sharing.createShare, {
        documentId,
        subject: 'user',
        recipientUserId: await userIdOf(t, FRIEND),
        role: 'viewer',
        canDownload: false,
        canReshare: false,
      }),
    ).rejects.toThrow();
    void friend;
  });

  test('delivered twice under one clientOpId makes one share', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    const recipientUserId = await userIdOf(t, FRIEND);

    const args = {
      documentId,
      subject: 'user' as const,
      recipientUserId,
      role: 'viewer' as const,
      canDownload: false,
      canReshare: false,
      clientOpId: localId('op1'),
    };
    const first = await owner.mutation(api.sharing.createShare, args);
    const second = await owner.mutation(api.sharing.createShare, args);

    expect(second).toBe(first);
    expect(await owner.query(api.sharing.outbox, {})).toHaveLength(1);
  });

  test('takes its shares with it when the document is deleted', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    await sharedWith(t, owner, friend, documentId);

    expect(await friend.query(api.sharing.inbox, { filter: 'all' })).toHaveLength(1);

    await owner.mutation(api.library.remove, { documentId });

    expect(await friend.query(api.sharing.inbox, { filter: 'all' })).toHaveLength(0);
  });
});

/* ── what a recipient still cannot do ───────────────────────────────── */

describe('a recipient with full access', () => {
  test('cannot rename, favourite, delete or unsync the document', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    await sharedWith(t, owner, friend, documentId, {
      role: 'annotator',
      canDownload: true,
      canReshare: true,
    });

    // Everything on this list is the owner's, and no role expresses any of it.
    // The device hides them; these are the reason hiding them is only a
    // convenience.
    await expect(
      friend.mutation(api.library.rename, { documentId, title: 'Mine now' }),
    ).rejects.toThrow();
    await expect(
      friend.mutation(api.library.setFavorite, { documentId, isFavorite: true }),
    ).rejects.toThrow();
    await expect(
      friend.mutation(api.library.recordProgress, { documentId, currentPage: 40 }),
    ).rejects.toThrow();
    await expect(friend.mutation(api.library.detachUpload, { documentId })).rejects.toThrow();
    await expect(friend.mutation(api.library.remove, { documentId })).rejects.toThrow();

    // And the document is untouched.
    const doc = await t.run(async (ctx) => await ctx.db.get('documents', documentId));
    expect(doc?.title).toBe('Thinking, Fast and Slow');
    expect(doc?.currentPage).toBe(1);
  });

  test('can read the parts of it that make it usable', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    await sharedWith(t, owner, friend, documentId);

    // A table of contents and the page text: without the first a shared
    // document is navigable only by scrubbing, and without the second it
    // cannot be searched offline like every other document in the library.
    await expect(friend.query(api.library.outline, { documentId })).resolves.toEqual([]);
    await expect(
      friend.query(api.library.pagesOf, { documentId, after: 0 }),
    ).resolves.toEqual({ pages: [], isDone: true });
  });
});

/* ── presence ───────────────────────────────────────────────────────── */

describe('presence', () => {
  test('refuses a room the caller has no access to', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const stranger = await signedIn(t, STRANGER);
    const documentId = await aSyncedDocument(t, owner);

    await expect(
      stranger.mutation(api.presence.heartbeat, {
        roomId: `document:${documentId}`,
        userId: await userIdOf(t, STRANGER),
        sessionId: 'session-1',
        interval: 10_000,
      }),
    ).rejects.toThrow();
  });

  test('showReadingActivity keeps somebody out of a document room, not a group one', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    await sharedWith(t, owner, friend, documentId);

    const groupId = await owner.mutation(api.groups.create, { name: 'Reading group' });
    const friendId = await userIdOf(t, FRIEND);
    await owner.mutation(api.groups.addMember, { groupId, userId: friendId });

    await friend.mutation(api.settings.updateSharing, { showReadingActivity: false });

    // The heartbeat is accepted either way — refusing would make the client
    // retry forever — so what is asserted is who ends up in the room.
    await friend.mutation(api.presence.heartbeat, {
      roomId: `document:${documentId}`,
      userId: friendId,
      sessionId: 'reading',
      interval: 10_000,
    });
    await friend.mutation(api.presence.heartbeat, {
      roomId: `group:${groupId}`,
      userId: friendId,
      sessionId: 'grouped',
      interval: 10_000,
    });

    const inDocument = await owner.query(api.presence.inRoom, {
      roomId: `document:${documentId}`,
    });
    const inGroup = await owner.query(api.presence.inRoom, { roomId: `group:${groupId}` });

    expect(inDocument.some((person) => person.id === friendId && person.online)).toBe(false);
    // The wider setting is still on, so being a member who is around is not
    // hidden by the narrower one.
    expect(inGroup.some((person) => person.id === friendId && person.online)).toBe(true);
  });

  test('showOnlineStatus off hides them from both', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);

    const groupId = await owner.mutation(api.groups.create, { name: 'Reading group' });
    const friendId = await userIdOf(t, FRIEND);
    await owner.mutation(api.groups.addMember, { groupId, userId: friendId });

    await friend.mutation(api.settings.updateSharing, { showOnlineStatus: false });
    await friend.mutation(api.presence.heartbeat, {
      roomId: `group:${groupId}`,
      userId: friendId,
      sessionId: 'grouped',
      interval: 10_000,
    });

    const inGroup = await owner.query(api.presence.inRoom, { roomId: `group:${groupId}` });
    expect(inGroup.some((person) => person.id === friendId && person.online)).toBe(false);
  });

  test('refuses to list a room the caller has no access to', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const stranger = await signedIn(t, STRANGER);
    const documentId = await aSyncedDocument(t, owner);

    // A room id is a guessable string — a Convex id in a prefix — so the read
    // side has to make the same check the heartbeat does rather than trusting
    // that only somebody who joined could know the name.
    await expect(
      stranger.query(api.presence.inRoom, { roomId: `document:${documentId}` }),
    ).rejects.toThrow();
  });

  test('refuses a room name that is not one this backend mints', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);

    for (const roomId of ['everything', 'document:not-an-id', 'users:abc', '']) {
      await expect(
        owner.mutation(api.presence.heartbeat, {
          roomId,
          userId: await userIdOf(t, OWNER),
          sessionId: 'session-1',
          interval: 10_000,
        }),
      ).rejects.toThrow();
    }
  });
});

/* ── the account itself ─────────────────────────────────────────────── */

describe('a profile edit', () => {
  test('takes a name and stops the next sign-in overwriting it', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);

    const updated = await owner.mutation(api.users.updateProfile, {
      displayName: '  Emmanuel G.  ',
      showPhoto: true,
    });
    expect(updated.name).toBe('Emmanuel G.');

    // The client calls `ensureProfile` on every authenticated launch, and it
    // re-reads Google's claims. Without `nameIsCustom` this is where the edit
    // would silently disappear.
    const relaunched = await owner.mutation(api.users.ensureProfile, {});
    expect(relaunched.name).toBe('Emmanuel G.');
  });

  test('refuses a name longer than the limit', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);

    await expect(
      owner.mutation(api.users.updateProfile, { displayName: 'e'.repeat(DISPLAY_NAME_MAX + 1) }),
    ).rejects.toThrow();
  });

  test('an empty name gives Google’s back', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);

    await owner.mutation(api.users.updateProfile, { displayName: 'Something else' });
    await owner.mutation(api.users.updateProfile, { displayName: '' });

    const after = await owner.mutation(api.users.ensureProfile, {});
    expect(after.name).toBe(OWNER.name);
  });

  test('hiding the photo hides it from everybody, not just from a column', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    await sharedWith(t, owner, friend, documentId);

    const ownerId = await userIdOf(t, OWNER);
    await t.run(async (ctx) => {
      await ctx.db.patch('users', ownerId, { pictureUrl: 'https://lh3.example/photo=s240' });
    });

    const before = await friend.query(api.sharing.profile, { userId: ownerId });
    expect(before?.profile.pictureUrl).not.toBeNull();

    await owner.mutation(api.users.updateProfile, { showPhoto: false });

    const after = await friend.query(api.sharing.profile, { userId: ownerId });
    expect(after?.profile.pictureUrl).toBeNull();
  });

  test('cannot be made by somebody who is not signed in', async () => {
    const t = harness();
    await expect(t.mutation(api.users.updateProfile, { displayName: 'Nobody' })).rejects.toThrow();
  });
});

describe('devices', () => {
  test('two handsets are two rows, and one can be muted without the other', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);

    const phone = await owner.mutation(api.notifications.registerDevice, {
      token: 'ExponentPushToken[phone]',
      platform: 'android',
      deviceName: 'Phone',
    });
    const tablet = await owner.mutation(api.notifications.registerDevice, {
      token: 'ExponentPushToken[tablet]',
      platform: 'android',
      deviceName: 'Tablet',
    });

    // The regression the push component's own one-token-per-user shape would
    // have caused. Keying it on the device row rather than the account is what
    // keeps these two apart.
    expect(phone).not.toBe(tablet);
    expect((await owner.query(api.notifications.devices, {})).length).toBe(2);

    await owner.mutation(api.notifications.setDeviceEnabled, {
      deviceId: tablet,
      enabled: false,
    });

    const after = await owner.query(api.notifications.devices, {});
    expect(after.find((device) => device.id === phone)?.enabled).toBe(true);
    expect(after.find((device) => device.id === tablet)?.enabled).toBe(false);
  });

  test('cannot be muted or forgotten by another account', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const stranger = await signedIn(t, STRANGER);

    const phone = await owner.mutation(api.notifications.registerDevice, {
      token: 'ExponentPushToken[phone]',
      platform: 'android',
    });

    // Skipped rather than refused — a stale client is not told whose device it
    // is — so the assertion is that nothing moved.
    await stranger.mutation(api.notifications.setDeviceEnabled, {
      deviceId: phone,
      enabled: false,
    });
    await stranger.mutation(api.notifications.forgetDevice, { deviceId: phone });

    const mine = await owner.query(api.notifications.devices, {});
    expect(mine.length).toBe(1);
    expect(mine[0].enabled).toBe(true);
  });

  test('a DeviceNotRegistered receipt marks the row and then drops it', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);

    const phone = await owner.mutation(api.notifications.registerDevice, {
      token: 'ExponentPushToken[phone]',
      platform: 'android',
    });

    const ownerId = await userIdOf(t, OWNER);
    const deliveryId = await t.run(async (ctx) => {
      const eventId = await ctx.db.insert('shareEvents', {
        userId: ownerId,
        actorId: ownerId,
        kind: 'shareOffered',
        createdAt: Date.now(),
      });
      return await ctx.db.insert('pushDeliveries', {
        eventId,
        userId: ownerId,
        tokenId: phone,
        ticketId: 'ticket-1',
        status: 'sent',
        sentAt: Date.now(),
      });
    });

    await t.mutation(internal.push.applyReceipts, {
      results: [
        { id: deliveryId, delivered: false, error: 'DeviceNotRegistered', answered: true },
      ],
    });

    // The token is the thing that has to go: Expo has said it is dead, and a
    // dead token left registered is a send attempt on every future share.
    expect(await owner.query(api.notifications.devices, {})).toEqual([]);
    expect(await t.run(async (ctx) => await ctx.db.get('deviceTokens', phone))).toBeNull();
  });
});

describe('deleting an account', () => {
  test('signs the reader out and takes their rows with it', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    await sharedWith(t, owner, friend, documentId);
    await owner.mutation(api.notifications.registerDevice, {
      token: 'ExponentPushToken[phone]',
      platform: 'android',
    });
    const groupId = await owner.mutation(api.groups.create, { name: 'Reading group' });
    await owner.mutation(api.groups.addMember, {
      groupId,
      userId: await userIdOf(t, FRIEND),
    });

    const ownerId = await userIdOf(t, OWNER);
    await owner.mutation(api.account.deleteAccount, {});
    await t.finishAllScheduledFunctions(() => {});

    // Nothing of theirs is left, and the row itself is gone.
    const left = await t.run(async (ctx) => ({
      user: await ctx.db.get('users', ownerId),
      documents: await ctx.db
        .query('documents')
        .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
        .take(5),
      shares: await ctx.db
        .query('documentShares')
        .withIndex('by_creator', (q) => q.eq('createdBy', ownerId))
        .take(5),
      groups: await ctx.db
        .query('groups')
        .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
        .take(5),
      members: await ctx.db
        .query('groupMembers')
        .withIndex('by_user', (q) => q.eq('userId', ownerId))
        .take(5),
      events: await ctx.db
        .query('shareEvents')
        .withIndex('by_user_and_created', (q) => q.eq('userId', ownerId))
        .take(5),
      devices: await ctx.db
        .query('deviceTokens')
        .withIndex('by_user', (q) => q.eq('userId', ownerId))
        .take(5),
    }));

    expect(left.user).toBeNull();
    expect(left.documents).toEqual([]);
    expect(left.shares).toEqual([]);
    expect(left.groups).toEqual([]);
    expect(left.members).toEqual([]);
    expect(left.events).toEqual([]);
    expect(left.devices).toEqual([]);
  });

  test('leaves a group they were only a member of counting correctly', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);

    const groupId = await owner.mutation(api.groups.create, { name: 'Reading group' });
    await owner.mutation(api.groups.addMember, { groupId, userId: await userIdOf(t, FRIEND) });
    expect((await owner.query(api.groups.detail, { groupId })).group.memberCount).toBe(2);

    await friend.mutation(api.account.deleteAccount, {});
    await t.finishAllScheduledFunctions(() => {});

    // `memberCount` is maintained rather than derived, so a cascade that
    // deleted the membership row underneath it would leave the owner looking
    // at a group with a member who no longer exists.
    expect((await owner.query(api.groups.detail, { groupId })).group.memberCount).toBe(1);
  });

  test('leaves the other account alone', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const theirs = await aSyncedDocument(t, friend, 'theirs');

    const friendId = await userIdOf(t, FRIEND);
    await owner.mutation(api.account.deleteAccount, {});
    await t.finishAllScheduledFunctions(() => {});

    expect(await t.run(async (ctx) => await ctx.db.get('users', friendId))).not.toBeNull();
    expect(await t.run(async (ctx) => await ctx.db.get('documents', theirs))).not.toBeNull();
    // And they can still use the account they still have.
    expect(await friend.query(api.sharing.inbox, { filter: 'all' })).toEqual([]);
  });

  test('takes no argument naming whose account it is', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const ownerId = await userIdOf(t, OWNER);

    // The public mutation deletes whoever is calling and has no user id to
    // point elsewhere; the cascade that does take one is `internalMutation`.
    // Unauthenticated it refuses outright rather than picking a default.
    await expect(t.mutation(api.account.deleteAccount, {})).rejects.toThrow();
    expect(await t.run(async (ctx) => await ctx.db.get('users', ownerId))).not.toBeNull();
    void owner;
  });
});

/* ── what a group decides ───────────────────────────────────────────── */

describe('group settings', () => {
  test('whoCanAdd narrows who may bring somebody in', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const groupId = await owner.mutation(api.groups.create, { name: 'Reading group' });
    const friendId = await userIdOf(t, FRIEND);
    const strangerId = await userIdOf(t, await signedIn(t, STRANGER).then(() => STRANGER));

    await owner.mutation(api.groups.addMember, { groupId, userId: friendId });

    // A plain member cannot add anybody by default.
    await expect(
      friend.mutation(api.groups.addMember, { groupId, userId: strangerId }),
    ).rejects.toThrow();

    await owner.mutation(api.groups.updateSettings, { groupId, whoCanAdd: 'members' });
    await friend.mutation(api.groups.addMember, { groupId, userId: strangerId });
    expect((await owner.query(api.groups.detail, { groupId })).group.memberCount).toBe(3);

    // And narrower than an admin, which is the point of the third value.
    await owner.mutation(api.groups.setRole, { groupId, userId: friendId, role: 'admin' });
    await owner.mutation(api.groups.updateSettings, { groupId, whoCanAdd: 'owner' });
    await owner.mutation(api.groups.removeMember, { groupId, userId: strangerId });
    await expect(
      friend.mutation(api.groups.addMember, { groupId, userId: strangerId }),
    ).rejects.toThrow();
  });

  test('whoCanShare stops a member putting a document in', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const groupId = await owner.mutation(api.groups.create, { name: 'Reading group' });
    await owner.mutation(api.groups.addMember, { groupId, userId: await userIdOf(t, FRIEND) });

    const theirs = await aSyncedDocument(t, friend, 'theirs');
    await owner.mutation(api.groups.updateSettings, { groupId, whoCanShare: 'admins' });

    await expect(
      friend.mutation(api.sharing.createShare, {
        documentId: theirs,
        subject: 'group',
        groupId,
        role: 'viewer',
        canDownload: false,
        canReshare: false,
      }),
    ).rejects.toThrow();
  });

  test('the group ceiling clamps what a share into it may grant', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const documentId = await aSyncedDocument(t, owner);
    const groupId = await owner.mutation(api.groups.create, { name: 'Reading group' });
    await owner.mutation(api.groups.addMember, { groupId, userId: await userIdOf(t, FRIEND) });

    // The group says read-only and no copies, whatever the sender asks for.
    await owner.mutation(api.groups.updateSettings, {
      groupId,
      defaultRole: 'viewer',
      defaultCanDownload: false,
    });
    await owner.mutation(api.sharing.createShare, {
      documentId,
      subject: 'group',
      groupId,
      role: 'annotator',
      canDownload: true,
      canReshare: false,
    });

    const seen = await inboxEntry(friend, (share) => share.document?.id === documentId);
    expect(seen?.role).toBe('viewer');
    expect(seen?.canDownload).toBe(false);

    // And the annotate refusal is real, not just a label.
    await expect(
      friend.mutation(api.library.addAnnotation, {
        documentId,
        currentPage: 3,
        kind: 'note',
        note: 'not allowed',
      }),
    ).rejects.toThrow();
  });

  test('showMemberHandles withholds the handle and keeps the name', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    await friend.mutation(api.settings.setHandle, { handle: 'afriend' });

    const groupId = await owner.mutation(api.groups.create, { name: 'Reading group' });
    const friendId = await userIdOf(t, FRIEND);
    await owner.mutation(api.groups.addMember, { groupId, userId: friendId });

    const before = await owner.query(api.groups.detail, { groupId });
    expect(before.members.find((m) => m.profile?.id === friendId)?.profile?.handle).toBe('afriend');

    await owner.mutation(api.groups.updateSettings, { groupId, showMemberHandles: false });

    const after = await owner.query(api.groups.detail, { groupId });
    const member = after.members.find((m) => m.profile?.id === friendId);
    expect(member?.profile?.handle).toBeNull();
    // The name is what the list is for, and it stays.
    expect(member?.profile?.displayName).toBe(FRIEND.name);
  });

  test('showPresence keeps members out of the group room', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const groupId = await owner.mutation(api.groups.create, { name: 'Reading group' });
    const friendId = await userIdOf(t, FRIEND);
    await owner.mutation(api.groups.addMember, { groupId, userId: friendId });

    await owner.mutation(api.groups.updateSettings, { groupId, showPresence: false });
    await friend.mutation(api.presence.heartbeat, {
      roomId: `group:${groupId}`,
      userId: friendId,
      sessionId: 'grouped',
      interval: 10_000,
    });

    const inRoom = await owner.query(api.presence.inRoom, { roomId: `group:${groupId}` });
    expect(inRoom.some((person) => person.id === friendId && person.online)).toBe(false);
  });

  test('muting is one member’s own answer, not the group’s', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const groupId = await owner.mutation(api.groups.create, { name: 'Reading group' });
    await owner.mutation(api.groups.addMember, { groupId, userId: await userIdOf(t, FRIEND) });

    // A plain member may mute, and it changes nothing for anybody else.
    await friend.mutation(api.groups.setMuted, { groupId, muted: true });

    expect((await friend.query(api.groups.detail, { groupId })).group.muted).toBe(true);
    expect((await owner.query(api.groups.detail, { groupId })).group.muted).toBe(false);
  });

  test('cannot be changed by a member who is not an administrator', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const friend = await signedIn(t, FRIEND);
    const groupId = await owner.mutation(api.groups.create, { name: 'Reading group' });
    await owner.mutation(api.groups.addMember, { groupId, userId: await userIdOf(t, FRIEND) });

    await expect(
      friend.mutation(api.groups.updateSettings, { groupId, whoCanAdd: 'members' }),
    ).rejects.toThrow();
  });

  test('a description is bounded and can be cleared', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const groupId = await owner.mutation(api.groups.create, { name: 'Reading group' });

    await expect(
      owner.mutation(api.groups.updateSettings, {
        groupId,
        description: 'd'.repeat(GROUP_DESCRIPTION_MAX + 1),
      }),
    ).rejects.toThrow();

    await owner.mutation(api.groups.updateSettings, { groupId, description: '  Tuesdays  ' });
    expect((await owner.query(api.groups.detail, { groupId })).group.settings.description).toBe(
      'Tuesdays',
    );

    await owner.mutation(api.groups.updateSettings, { groupId, description: '' });
    expect(
      (await owner.query(api.groups.detail, { groupId })).group.settings.description,
    ).toBeNull();
  });
});
