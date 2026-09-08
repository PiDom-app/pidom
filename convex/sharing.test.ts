/// <reference types="vite/client" />
import actionRetrier from '@convex-dev/action-retrier/test';
import presence from '@convex-dev/presence/test';
import r2 from '@convex-dev/r2/test';
import rateLimiter from '@convex-dev/rate-limiter/test';
import workflow from '@convex-dev/workflow/test';
import workpool from '@convex-dev/workpool/test';
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
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
 * bucket, **notifications** because creating a share enqueues a push job,
 * **workflow** because a group share starts a fan-out, and **presence** because
 * the heartbeat tests call it, and **R2** because deleting a document deletes
 * its objects and because one test asserts that a permitted recipient really
 * does get a URL. The credentials it signs with are the throwaway ones in
 * `vitest.config.ts` and address a bucket that does not exist; signing is local
 * arithmetic, so nothing here reaches Cloudflare.
 */
function harness() {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  workpool.register(t, 'notifications');
  workflow.register(t);
  presence.register(t);
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

/* ── the door ───────────────────────────────────────────────────────── */

describe('a stranger', () => {
  test('cannot read a document nobody shared with them', async () => {
    const t = harness();
    const owner = await signedIn(t, OWNER);
    const stranger = await signedIn(t, STRANGER);
    const documentId = await aSyncedDocument(t, owner);

    await expect(stranger.query(api.sharing.sharedDocument, { documentId })).rejects.toThrow();
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
      .query(api.sharing.sharedDocument, { documentId: real })
      .catch((error: unknown) => (error as { data?: { code?: string } }).data?.code);

    // A well-formed id for a row that was deleted: the same shape of answer.
    const deleted = await aSyncedDocument(t, owner, 'gone');
    await owner.mutation(api.library.remove, { documentId: deleted });
    const onGone = await stranger
      .query(api.sharing.sharedDocument, { documentId: deleted })
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

    const doc = await friend.query(api.sharing.sharedDocument, { documentId });
    expect(doc?.title).toBe('Thinking, Fast and Slow');

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
    await expect(friend.query(api.sharing.sharedDocument, { documentId })).rejects.toThrow();
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

    const share = await friend.query(api.sharing.shareDetail, { shareId });
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
    await expect(friend.query(api.sharing.sharedDocument, { documentId })).rejects.toThrow();
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

    expect(
      (await owner.query(api.sharing.profile, { userId: await userIdOf(t, FRIEND) }))
        ?.displayName,
    ).toBe('A Friend');
    expect(
      (await friend.query(api.sharing.profile, { userId: await userIdOf(t, OWNER) }))
        ?.displayName,
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
    expect((await friend.query(api.sharing.sharedDocument, { documentId }))?.title).toBe(
      'Thinking, Fast and Slow',
    );

    await owner.mutation(api.groups.removeMember, {
      groupId,
      userId: await userIdOf(t, FRIEND),
    });
    await expect(friend.query(api.sharing.sharedDocument, { documentId })).rejects.toThrow();
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
    await expect(stranger.query(api.groups.documents, { groupId })).rejects.toThrow();
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
