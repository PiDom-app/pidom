/// <reference types="vite/client" />
import actionRetrier from '@convex-dev/action-retrier/test';
import r2Component from '@convex-dev/r2/test';
import rateLimiter from '@convex-dev/rate-limiter/test';
import workflow from '@convex-dev/workflow/test';
import workpool from '@convex-dev/workpool/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api, components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { r2 } from './r2';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
/**
 * One file, one object, however many libraries it is in.
 *
 * Page text used to be a row per page in `documentPages`, plus a copy of every
 * one of those rows inside a Convex search index that is metered separately and
 * priced higher. At a couple of kilobytes a page that put a few hundred books
 * between this deployment and a full database, for text the reader's own phone
 * already held a searchable copy of. It is now one immutable object per
 * document in R2 — ten gigabytes free, no egress charge — and identical PDFs
 * share one.
 *
 * Sharing an object between accounts is the part that needs tests rather than
 * argument, because it turns every delete into a question about somebody else's
 * library. The assertions below are the invariants that make it safe:
 *
 *   - the digest a blob is addressed by comes from **R2**, never from a caller;
 *   - a delete removes exactly what nothing else needs, and nothing more;
 *   - the count reaching zero is what releases the bytes, and only then;
 *   - the sweep can tell a shared object from an orphan;
 *   - a forged fingerprint reaches nothing.
 *
 * **No network.** `getMetadata` and `deleteObject` are component *mutations*
 * over a metadata table, so seeding that table is how a test says "R2 holds
 * this object" and reading it back is how it asks whether R2 still does. The
 * S3 call itself rides an action retrier these tests never advance, and signing
 * a URL is an HMAC rather than a request.
 */
function harness() {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  workflow.register(t);
  workpool.register(t, 'maintenance');
  r2Component.register(t);
  // R2 mounts the action retrier beneath itself, so it lives at
  // `r2/actionRetrier` rather than where the retrier's own helper puts it.
  actionRetrier.register(t, 'r2/actionRetrier');
  return t;
}

/**
 * Time does not pass unless a test asks it to.
 *
 * Deleting an object enqueues the real S3 call on the retrier, which cannot
 * reach Cloudflare from here and so backs off and tries again — on a real timer,
 * a second or two later, by which point this test has finished and the next one
 * is running against a different deployment. That is how a suite gets failures
 * that move around when you reorder it. Frozen, nothing scheduled runs at all
 * except where a test advances the clock deliberately, and each deployment stays
 * inside its own test.
 */
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const ALICE = {
  subject: 'google-oauth2|alice',
  issuer: 'https://accounts.google.com',
  email: 'alice@example.com',
  emailVerified: true,
  name: 'Alice',
};

const BOB = {
  subject: 'google-oauth2|bob',
  issuer: 'https://accounts.google.com',
  email: 'bob@example.com',
  emailVerified: true,
  name: 'Bob',
};

const BUCKET = 'pidom-test';
const DAY = 24 * 60 * 60 * 1000;
const BYTES = 4_100_000;

/** `<digits>-<64 hex>`, the only shape `cleanFingerprint` accepts. */
const FINGERPRINT = `${BYTES}-${'ab'.repeat(32)}`;

/** A device-minted id, in the shape the client's `ids.ts` produces. */
function localId(seed: string): string {
  return seed.padEnd(32, '0').slice(0, 32);
}

type Harness = ReturnType<typeof harness>;
type Identity = typeof ALICE;

async function signedIn(t: Harness, identity: Identity = ALICE) {
  const as = t.withIdentity(identity);
  await as.mutation(api.users.ensureProfile, {});
  return as;
}

async function userIdOf(t: Harness, identity: Identity): Promise<Id<'users'>> {
  // `subjectOf` keeps only what follows the last `|`, so the row is not stored
  // under the token's subject verbatim.
  const subject = identity.subject.slice(identity.subject.lastIndexOf('|') + 1);
  return await t.run(async (ctx) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_subject', (q) => q.eq('subject', subject))
      .unique();
    if (user === null) {
      throw new Error('no profile');
    }
    return user._id;
  });
}

/**
 * Says that R2 holds an object, with a digest of this test's choosing.
 *
 * The digest is the whole point of the seeding. `attachUpload` reads it back out
 * of the component rather than taking one from the caller, so "these two
 * documents are the same bytes" is a thing expressed *here* — in the store —
 * and nowhere a client could reach. Omitting it is the other case worth
 * covering: R2 does not always report a sha256, and an upload with no digest
 * gets no blob and behaves exactly as everything did before dedupe existed.
 */
async function objectExists(
  t: Harness,
  key: string,
  options: { sha256?: string; size?: number; contentType?: string; ageMs?: number } = {},
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.runMutation(components.r2.lib.upsertMetadata, {
      key,
      bucket: BUCKET,
      contentType: options.contentType ?? 'application/pdf',
      size: options.size ?? BYTES,
      ...(options.sha256 === undefined ? {} : { sha256: options.sha256 }),
      lastModified: new Date(Date.now() - (options.ageMs ?? 0)).toISOString(),
      link: '',
    });
  });
}

/** Whether the store still has this object. */
async function objectIsThere(t: Harness, key: string): Promise<boolean> {
  return await t.run(async (ctx) => (await r2.getMetadata(ctx, key)) !== null);
}

/**
 * An import, uploaded and attached, exactly the way a client does it.
 *
 * Through the public mutations rather than by patching the row, because what is
 * being tested lives *inside* `attachUpload` — the key check, the digest read
 * and the collapse onto an existing blob all happen there.
 */
async function uploaded(
  t: Harness,
  as: Awaited<ReturnType<typeof signedIn>>,
  identity: Identity,
  options: { seed?: string; sha256?: string; fingerprint?: string } = {},
): Promise<Id<'documents'>> {
  const documentId = await as.mutation(api.library.importDocument, {
    title: 'Thinking, Fast and Slow',
    byteSize: BYTES,
    localId: localId(options.seed ?? 'doc1'),
    ...(options.fingerprint === undefined ? {} : { fingerprint: options.fingerprint }),
  });

  const key = `${await userIdOf(t, identity)}/${documentId}.pdf`;
  await objectExists(t, key, options.sha256 === undefined ? {} : { sha256: options.sha256 });
  await as.mutation(api.library.attachUpload, { documentId, storageKey: key });
  return documentId;
}

async function documentRow(t: Harness, documentId: Id<'documents'>) {
  return await t.run(async (ctx) => await ctx.db.get('documents', documentId));
}

async function blobs(t: Harness) {
  return await t.run(async (ctx) => await ctx.db.query('contentBlobs').collect());
}

/** Marks a document's text as extracted, the way `finalize` does. */
async function extracted(t: Harness, documentId: Id<'documents'>, textStorageKey: string) {
  await t.run(async (ctx) => {
    const doc = await ctx.db.get('documents', documentId);
    await ctx.db.patch('documents', documentId, {
      textStatus: 'ready',
      textStorageKey,
      textBytes: 900,
    });
    if (doc?.blobId !== undefined) {
      await ctx.db.patch('contentBlobs', doc.blobId, {
        textStatus: 'ready',
        textStorageKey,
        textBytes: 900,
      });
    }
  });
}

/* ── the same file, twice ───────────────────────────────────────────── */

describe('two accounts with identical bytes', () => {
  test('end up sharing one object, counted twice', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const bob = await signedIn(t, BOB);

    const hers = await uploaded(t, alice, ALICE, { sha256: 'sha-identical' });
    const his = await uploaded(t, bob, BOB, { seed: 'doc2', sha256: 'sha-identical' });

    const rows = await blobs(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.refCount).toBe(2);

    // Bob's document points at the object *Alice* uploaded, and the duplicate he
    // uploaded is gone. This is the storage saving, and it is the only place it
    // is observable from.
    const aliceId = await userIdOf(t, ALICE);
    const bobId = await userIdOf(t, BOB);
    expect((await documentRow(t, his))?.storageKey).toBe(`${aliceId}/${hers}.pdf`);
    expect(await objectIsThere(t, `${bobId}/${his}.pdf`)).toBe(false);
    expect(await objectIsThere(t, `${aliceId}/${hers}.pdf`)).toBe(true);
  });

  test('stay separate when the bytes differ', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const bob = await signedIn(t, BOB);

    await uploaded(t, alice, ALICE, { sha256: 'sha-one' });
    await uploaded(t, bob, BOB, { seed: 'doc2', sha256: 'sha-two' });

    const rows = await blobs(t);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.refCount === 1)).toBe(true);
  });

  test('get no blob at all when R2 reports no digest', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const bob = await signedIn(t, BOB);

    // The behaviour every document had before dedupe existed, and the reason
    // `contentHash` is optional rather than assumed: with nothing to key on,
    // each account owns its own bytes outright.
    await uploaded(t, alice, ALICE);
    await uploaded(t, bob, BOB, { seed: 'doc2' });

    expect(await blobs(t)).toHaveLength(0);
  });

  test('inherit an extraction rather than running pdf.js twice', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const bob = await signedIn(t, BOB);

    const hers = await uploaded(t, alice, ALICE, { sha256: 'sha-identical' });
    // Alice's extraction finished. The text object is hers, and its key names
    // her document — which is exactly why the sweep has to ask the blob first.
    const text = `${await userIdOf(t, ALICE)}/${hers}.text.json`;
    await extracted(t, hers, text);

    const his = await uploaded(t, bob, BOB, { seed: 'doc2', sha256: 'sha-identical' });

    const row = await documentRow(t, his);
    expect(row?.textStatus).toBe('ready');
    expect(row?.textStorageKey).toBe(text);
  });
});

/* ── letting go ─────────────────────────────────────────────────────── */

describe('deleting a shared document', () => {
  test('leaves the object alone while anybody else still needs it', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const bob = await signedIn(t, BOB);

    const hers = await uploaded(t, alice, ALICE, { sha256: 'sha-identical' });
    await uploaded(t, bob, BOB, { seed: 'doc2', sha256: 'sha-identical' });

    // The *first* uploader deletes. Her id is in the key, so every check that
    // reasons from the key alone would call this object an orphan.
    await alice.mutation(api.library.remove, { documentId: hers });

    const rows = await blobs(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.refCount).toBe(1);
    expect(await objectIsThere(t, `${await userIdOf(t, ALICE)}/${hers}.pdf`)).toBe(true);
  });

  test('and Bob can still fetch it afterwards', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const bob = await signedIn(t, BOB);

    const hers = await uploaded(t, alice, ALICE, { sha256: 'sha-identical' });
    const his = await uploaded(t, bob, BOB, { seed: 'doc2', sha256: 'sha-identical' });

    await alice.mutation(api.library.remove, { documentId: hers });

    const url = await bob.mutation(api.library.downloadUrl, {
      documentId: his,
      what: 'document',
    });
    // A URL for the object Alice uploaded, signed for Bob against his own row.
    expect(url).toContain(`${hers}.pdf`);
  });

  test('releases the bytes only when the last one goes', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const bob = await signedIn(t, BOB);

    const hers = await uploaded(t, alice, ALICE, { sha256: 'sha-identical' });
    const his = await uploaded(t, bob, BOB, { seed: 'doc2', sha256: 'sha-identical' });
    const key = `${await userIdOf(t, ALICE)}/${hers}.pdf`;
    const text = `${await userIdOf(t, ALICE)}/${hers}.text.json`;
    await extracted(t, hers, text);
    await objectExists(t, text, { contentType: 'application/json', size: 900 });

    await alice.mutation(api.library.remove, { documentId: hers });
    await bob.mutation(api.library.remove, { documentId: his });

    // Zero is *collectable*, not collected. Deleting the object inside the
    // mutation would mean a Cloudflare failure rolling back a delete the reader
    // has already watched happen.
    expect((await blobs(t))[0]?.refCount).toBe(0);
    expect(await objectIsThere(t, key)).toBe(true);

    await t.action(internal.maintenance.releaseBlobs, {});

    expect(await blobs(t)).toHaveLength(0);
    expect(await objectIsThere(t, key)).toBe(false);
    // The text goes with the bytes it was read from. Left behind it would be
    // the reader's own document content, in an account that asked to stop
    // holding it, keyed by a name nothing can account for.
    expect(await objectIsThere(t, text)).toBe(false);
  });

  test('collects it exactly once, however often the pass runs', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const hers = await uploaded(t, alice, ALICE, { sha256: 'sha-identical' });

    await alice.mutation(api.library.remove, { documentId: hers });

    expect(await t.action(internal.maintenance.releaseBlobs, {})).toBe(1);
    expect(await t.action(internal.maintenance.releaseBlobs, {})).toBe(0);
  });

  test('keeps the row when the bytes are claimed again before the pass runs', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const bob = await signedIn(t, BOB);

    const hers = await uploaded(t, alice, ALICE, { sha256: 'sha-identical' });
    await alice.mutation(api.library.remove, { documentId: hers });
    expect((await blobs(t))[0]?.refCount).toBe(0);

    // Somebody imports the same file in the seconds between the query that
    // listed this blob and the mutation that would drop its row.
    await uploaded(t, bob, BOB, { seed: 'doc2', sha256: 'sha-identical' });

    const rows = await blobs(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.refCount).toBe(1);

    await t.action(internal.maintenance.releaseBlobs, {});
    expect(await blobs(t)).toHaveLength(1);
  });
});

/* ── nothing left behind ────────────────────────────────────────────── */

describe('deleting a document nobody shares', () => {
  test('takes its objects and every page row with it', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    // No digest, so no blob: this document owns its bytes and they go now
    // rather than on the nightly pass.
    const documentId = await uploaded(t, alice, ALICE);
    const ownerId = await userIdOf(t, ALICE);

    const pdf = `${ownerId}/${documentId}.pdf`;
    const cover = `${ownerId}/${documentId}.cover.jpg`;
    const text = `${ownerId}/${documentId}.text.json`;
    await objectExists(t, cover, { contentType: 'image/jpeg', size: 40_000 });
    await objectExists(t, text, { contentType: 'application/json', size: 900 });

    await t.run(async (ctx) => {
      await ctx.db.patch('documents', documentId, {
        coverStorageKey: cover,
        textStorageKey: text,
        textStatus: 'ready',
      });
      // Text from before page text became an object, which a deployment
      // part-way through the backfill still has.
      for (let page = 1; page <= 20; page += 1) {
        await ctx.db.insert('documentPages', { ownerId, documentId, page, text: `page ${page}` });
      }
    });

    await alice.mutation(api.library.remove, { documentId });

    expect(await objectIsThere(t, pdf)).toBe(false);
    expect(await objectIsThere(t, cover)).toBe(false);
    expect(await objectIsThere(t, text)).toBe(false);
    expect(await t.run(async (ctx) => await ctx.db.query('documentPages').collect())).toHaveLength(
      0,
    );
  });

  test('drains page rows past the inline budget rather than queuing them for days', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const documentId = await uploaded(t, alice, ALICE, { seed: 'doc9' });
    const ownerId = await userIdOf(t, ALICE);

    // Past `PAGE_DELETE_BUDGET`, so the inline pass cannot finish it. A mutation
    // that deleted nine hundred rows would be a mutation that times out; what
    // has to be true is that the rest actually goes — in seconds, chained, and
    // not four documents a night.
    await t.run(async (ctx) => {
      for (let page = 1; page <= 900; page += 1) {
        await ctx.db.insert('documentPages', { ownerId, documentId, page, text: 'x' });
      }
    });

    await alice.mutation(api.library.remove, { documentId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.run(async (ctx) => await ctx.db.query('documentPages').collect())).toHaveLength(
      0,
    );
    // The queue row goes with them, so the nightly pass has nothing to redo.
    expect(await t.run(async (ctx) => await ctx.db.query('pagePruneQueue').collect())).toHaveLength(
      0,
    );
  });

  test('takes the text object when the reader only unsyncs', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const documentId = await uploaded(t, alice, ALICE, { seed: 'doc10' });
    const text = `${await userIdOf(t, ALICE)}/${documentId}.text.json`;
    await extracted(t, documentId, text);
    await objectExists(t, text, { contentType: 'application/json', size: 900 });

    await alice.mutation(api.library.detachUpload, { documentId });

    expect(await objectIsThere(t, text)).toBe(false);
    const row = await documentRow(t, documentId);
    expect(row?.textStorageKey).toBeUndefined();
    expect(row?.storageKey).toBeUndefined();
    // The row itself stays — unsyncing is not deleting.
    expect(row).not.toBeNull();
  });
});

/* ── the sweep ──────────────────────────────────────────────────────── */

describe('the nightly sweep', () => {
  test('spares an object another account is still reading', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const bob = await signedIn(t, BOB);

    const hers = await uploaded(t, alice, ALICE, { sha256: 'sha-identical' });
    await uploaded(t, bob, BOB, { seed: 'doc2', sha256: 'sha-identical' });
    const shared = `${await userIdOf(t, ALICE)}/${hers}.pdf`;

    // Alice deletes, so the key names a document that no longer exists — an
    // orphan by every test that reasons from a key on its own.
    await alice.mutation(api.library.remove, { documentId: hers });
    // A day old, because the sweep spares anything recent: an object uploaded
    // minutes ago may belong to a document still being attached.
    await objectExists(t, shared, { sha256: 'sha-identical', ageMs: 2 * DAY });

    expect(await t.mutation(internal.library.sweepOrphanedObjects, {})).toBe(0);
    expect(await objectIsThere(t, shared)).toBe(true);
  });

  test('collects one nothing points at any more', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);

    // A PUT that landed and an `attachUpload` that never ran — the app killed
    // between the second and third request of the upload flow, which is the
    // case this sweep exists for. The document is real and so is its owner; it
    // simply does not name this key.
    const documentId = await alice.mutation(api.library.importDocument, {
      title: 'Interrupted',
      byteSize: BYTES,
      localId: localId('doc11'),
    });
    const key = `${await userIdOf(t, ALICE)}/${documentId}.pdf`;
    await objectExists(t, key, { ageMs: 2 * DAY });

    expect(await t.mutation(internal.library.sweepOrphanedObjects, {})).toBe(1);
    expect(await objectIsThere(t, key)).toBe(false);
  });

  test('spares a text object the row still names', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const documentId = await uploaded(t, alice, ALICE, { seed: 'doc3' });
    const text = `${await userIdOf(t, ALICE)}/${documentId}.text.json`;

    await extracted(t, documentId, text);
    await objectExists(t, text, {
      contentType: 'application/json',
      size: 900,
      ageMs: 2 * DAY,
    });

    await t.mutation(internal.library.sweepOrphanedObjects, {});
    expect(await objectIsThere(t, text)).toBe(true);
  });

  test('collects a text object nothing names any more', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const documentId = await uploaded(t, alice, ALICE, { seed: 'doc4' });

    // Written by an extraction whose `finalize` never landed, which is the one
    // way a text object outlives the row that should have named it.
    const text = `${await userIdOf(t, ALICE)}/${documentId}.text.json`;
    await objectExists(t, text, {
      contentType: 'application/json',
      size: 900,
      ageMs: 2 * DAY,
    });

    await t.mutation(internal.library.sweepOrphanedObjects, {});
    expect(await objectIsThere(t, text)).toBe(false);
  });

  test('leaves an object it cannot account for alone', async () => {
    const t = harness();
    await signedIn(t, ALICE);

    // The other deployment's, sharing this bucket. Not a shape this backend
    // mints, and an owner id that is not a row here — both of which have to
    // mean "not mine to delete" rather than "orphan".
    await objectExists(t, 'something/else/entirely.bin', { ageMs: 2 * DAY });
    await objectExists(t, `${'u'.repeat(32)}/${'d'.repeat(32)}.pdf`, { ageMs: 2 * DAY });

    expect(await t.mutation(internal.library.sweepOrphanedObjects, {})).toBe(0);
  });
});

/* ── what a caller cannot do ────────────────────────────────────────── */

describe('a forged fingerprint', () => {
  test('reaches nothing of somebody else’s', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const bob = await signedIn(t, BOB);

    await uploaded(t, alice, ALICE, { sha256: 'sha-identical', fingerprint: FINGERPRINT });

    // Bob claims Alice's fingerprint on an import he never uploads. It covers
    // 128 KB of a file and is forgeable in an afternoon, so the only safe thing
    // it may ever match is a row the caller already owns.
    const his = await bob.mutation(api.library.importDocument, {
      title: 'Not mine',
      byteSize: BYTES,
      localId: localId('doc2'),
      fingerprint: FINGERPRINT,
    });

    const row = await documentRow(t, his);
    expect(row?.storageKey).toBeUndefined();
    expect(row?.blobId).toBeUndefined();
    expect(row?.contentHash).toBeUndefined();
    expect((await blobs(t))[0]?.refCount).toBe(1);
  });

  test('does reuse the caller’s own upload, with no second one', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);

    const first = await uploaded(t, alice, ALICE, {
      sha256: 'sha-identical',
      fingerprint: FINGERPRINT,
    });

    // The same reader importing the same file again after a reinstall. Telling
    // somebody about their own library leaks nothing, so this one skips the
    // upload entirely — no PUT, no pdf.js, no second object.
    const second = await alice.mutation(api.library.importDocument, {
      title: 'Thinking, Fast and Slow',
      byteSize: BYTES,
      localId: localId('doc2'),
      fingerprint: FINGERPRINT,
    });

    const row = await documentRow(t, second);
    expect(row?.storageKey).toBe(`${await userIdOf(t, ALICE)}/${first}.pdf`);
    expect((await blobs(t))[0]?.refCount).toBe(2);
  });

  test('is refused outright when it is not the shape Pidom writes', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);

    // Not a hash check — it is never parsed, only compared. What this stops is
    // a client putting an arbitrary string into an indexed field.
    await expect(
      alice.mutation(api.library.importDocument, {
        title: 'Anything',
        byteSize: BYTES,
        localId: localId('doc2'),
        fingerprint: 'not-a-fingerprint',
      }),
    ).rejects.toThrow();
  });
});

describe('uploadUrl', () => {
  test('refuses to overwrite bytes another account is reading', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const bob = await signedIn(t, BOB);

    const hers = await uploaded(t, alice, ALICE, { sha256: 'sha-identical' });
    await uploaded(t, bob, BOB, { seed: 'doc2', sha256: 'sha-identical' });

    // Her own key, her own document — and now also the only copy of a book in
    // somebody else's library. A presigned PUT overwrites, and the previous
    // version of this cleared the way for one unconditionally.
    await expect(
      alice.mutation(api.library.uploadUrl, { documentId: hers, what: 'document' }),
    ).rejects.toThrow();
    expect(await objectIsThere(t, `${await userIdOf(t, ALICE)}/${hers}.pdf`)).toBe(true);
  });

  test('still clears the way for an ordinary re-sync', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const documentId = await uploaded(t, alice, ALICE, { seed: 'doc5' });
    const key = `${await userIdOf(t, ALICE)}/${documentId}.pdf`;

    const target = await alice.mutation(api.library.uploadUrl, { documentId, what: 'document' });
    expect(target.key).toBe(key);
    // Gone, so the PUT that follows lands on a key the component will accept.
    expect(await objectIsThere(t, key)).toBe(false);
  });
});

/* ── the counters ───────────────────────────────────────────────────── */

describe('usage', () => {
  test('follows a document from local-only to synced and out again', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);

    // Zero on a row a moment old, which is what keeps this a read of one field
    // rather than the scan of the whole library it replaced.
    expect(await alice.query(api.library.usage, {})).toEqual({
      syncedCount: 0,
      syncedBytes: 0,
      localOnlyCount: 0,
      scanCount: 0,
    });

    const documentId = await alice.mutation(api.library.importDocument, {
      title: 'Thinking, Fast and Slow',
      byteSize: BYTES,
      localId: localId('doc6'),
    });
    expect(await alice.query(api.library.usage, {})).toMatchObject({
      localOnlyCount: 1,
      syncedCount: 0,
      syncedBytes: 0,
    });

    const key = `${await userIdOf(t, ALICE)}/${documentId}.pdf`;
    await objectExists(t, key, { sha256: 'sha-counted' });
    await alice.mutation(api.library.attachUpload, { documentId, storageKey: key });

    // Gaining a cloud copy moves two of the four numbers, in opposite
    // directions — which is why `changed` takes both versions of the row.
    expect(await alice.query(api.library.usage, {})).toMatchObject({
      localOnlyCount: 0,
      syncedCount: 1,
      syncedBytes: BYTES,
    });

    await alice.mutation(api.library.remove, { documentId });
    expect(await alice.query(api.library.usage, {})).toMatchObject({
      localOnlyCount: 0,
      syncedCount: 0,
      syncedBytes: 0,
    });
  });

  test('is re-derived by the nightly pass when it drifts', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    await uploaded(t, alice, ALICE, { seed: 'doc7', sha256: 'sha-drift' });

    // Numbers nothing could have produced, standing in for a mutation added
    // later that forgets to report. Incremental counters drift; one that drifts
    // with no way back would be worse than the scan.
    const ownerId = await userIdOf(t, ALICE);
    await t.run(async (ctx) => {
      await ctx.db.patch('users', ownerId, {
        usage: {
          syncedCount: 99,
          syncedBytes: 99,
          localOnlyCount: 99,
          scanCount: 99,
          countedAt: 0,
        },
      });
    });

    await t.mutation(internal.maintenance.recountUsage, {});

    expect(await alice.query(api.library.usage, {})).toMatchObject({
      syncedCount: 1,
      syncedBytes: BYTES,
      localOnlyCount: 0,
      scanCount: 0,
    });
  });
});

/* ── the text object ────────────────────────────────────────────────── */

describe('textUrl', () => {
  test('signs the key the row names, and nothing when there is none', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const documentId = await uploaded(t, alice, ALICE, { seed: 'doc8' });

    // Nothing extracted yet. `null` rather than a refusal: the caller tries
    // again when `textStatus` next changes, and a throw would read as forbidden.
    expect(await alice.mutation(api.library.textUrl, { documentId })).toBeNull();

    const text = `${await userIdOf(t, ALICE)}/${documentId}.text.json`;
    await extracted(t, documentId, text);

    const url = await alice.mutation(api.library.textUrl, { documentId });
    expect(url).toContain('.text.json');
    // Signed, and for a window rather than for good. This is document content.
    expect(url).toContain('X-Amz-Expires=300');
  });

  test('is refused to somebody the document was never shared with', async () => {
    const t = harness();
    const alice = await signedIn(t, ALICE);
    const bob = await signedIn(t, BOB);
    const documentId = await uploaded(t, alice, ALICE, { seed: 'doc8' });
    await extracted(t, documentId, `${await userIdOf(t, ALICE)}/${documentId}.text.json`);

    // Access is bound to the document row, never to the object. Two accounts
    // sharing one text object gives neither a path to the other's library.
    await expect(bob.mutation(api.library.textUrl, { documentId })).rejects.toThrow();
  });
});
