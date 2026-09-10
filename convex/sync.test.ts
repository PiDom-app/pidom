/// <reference types="vite/client" />
import rateLimiter from '@convex-dev/rate-limiter/test';
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

/**
 * A test deployment with this app's components attached.
 *
 * `convexTest` builds the database from `schema` and finds this deployment's own
 * functions through `modules`, but it knows nothing about what `convex.config.ts`
 * mounts alongside them — a component is a separate schema and a separate module
 * tree, and an unregistered one throws the moment a function reaches it rather
 * than returning nothing. Nearly every mutation in this backend spends a token
 * bucket first, so without this line twenty of the twenty-two tests below fail
 * in `rateLimits.limit` before they reach the thing they are about.
 *
 * Only the rate limiter is registered because only the rate limiter is on the
 * path these tests take. R2, Workflow and Workpool each ship the same `./test`
 * helper for the day a test reaches one of them; registering them now would be
 * three more component schemas built per test for nothing.
 */
function harness() {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  return t;
}

/**
 * What a replaying client does to a backend written for request and response.
 *
 * Every test here delivers the same operation twice, or delivers one late, and
 * asserts the thing the outbox needs to be true. None of them is hypothetical:
 * the client retries when a reply is lost after a mutation committed, which is
 * exactly what a dropped socket looks like, and it drains hours of queued work
 * in one connection with the clocks all wrong.
 *
 * The negative authorisation cases are here too, because "signed in" and
 * "signed in as the owner" are different questions and the second one is the
 * boundary this app actually defends — see `SECURITY.md`.
 */

const READER = {
  subject: 'google-oauth2|reader-one',
  issuer: 'https://accounts.google.com',
  email: 'reader@example.com',
  emailVerified: true,
  name: 'A Reader',
};

const OTHER = {
  subject: 'google-oauth2|reader-two',
  issuer: 'https://accounts.google.com',
  email: 'other@example.com',
  emailVerified: true,
  name: 'Somebody Else',
};

/** A device-minted id, in the shape `repository/ids.ts` produces. */
function localId(seed: string): string {
  return seed.padEnd(32, '0').slice(0, 32);
}

async function signedIn(t: ReturnType<typeof convexTest>, identity = READER) {
  const as = t.withIdentity(identity);
  await as.mutation(api.users.ensureProfile, {});
  return as;
}

function anImport(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Thinking, Fast and Slow',
    byteSize: 4_100_000,
    localId: localId('abc123'),
    ...overrides,
  };
}

/* ── reading what was stored ────────────────────────────────────────── */

/**
 * These read the database rather than the public API on purpose.
 *
 * What the assertions below are about is what a mutation *wrote* — whether a
 * stale clock overwrote a newer page, whether a second delivery made a second
 * row. Routing that through a query would test two things at once and, worse,
 * would keep a public function alive for no reason other than that a test
 * reads it: `byIds`, `bookmarks` and `annotations` were all still deployed
 * long after the device started answering those questions from SQLite, and a
 * test was the only caller any of them had left.
 */
async function storedDocument(t: ReturnType<typeof harness>, documentId: Id<'documents'>) {
  return await t.run(async (ctx) => await ctx.db.get('documents', documentId));
}

async function storedBookmarks(t: ReturnType<typeof harness>, documentId: Id<'documents'>) {
  return await t.run(
    async (ctx) =>
      await ctx.db
        .query('documentBookmarks')
        .withIndex('by_document', (q) => q.eq('documentId', documentId))
        .collect(),
  );
}

async function storedAnnotations(t: ReturnType<typeof harness>, documentId: Id<'documents'>) {
  return await t.run(
    async (ctx) =>
      await ctx.db
        .query('documentAnnotations')
        .withIndex('by_document_and_created', (q) => q.eq('documentId', documentId))
        .collect(),
  );
}

describe('importDocument', () => {
  test('delivered twice with one localId makes one document', async () => {
    const t = harness();
    const as = await signedIn(t);

    const first = await as.mutation(api.library.importDocument, anImport());
    const second = await as.mutation(api.library.importDocument, anImport());

    expect(second).toBe(first);

    const home = await as.query(api.library.home, {});
    expect(home.recentlyAdded).toHaveLength(1);
  });

  test('two different localIds make two documents', async () => {
    const t = harness();
    const as = await signedIn(t);

    await as.mutation(api.library.importDocument, anImport());
    await as.mutation(api.library.importDocument, anImport({ localId: localId('def456') }));

    const home = await as.query(api.library.home, {});
    expect(home.recentlyAdded).toHaveLength(2);
  });

  test('one reader cannot claim another reader s localId', async () => {
    const t = harness();
    const mine = await signedIn(t);
    const theirs = await signedIn(t, OTHER);

    const first = await mine.mutation(api.library.importDocument, anImport());
    // The same device id, a different account: the lookup is owner-scoped, so
    // this is a new document rather than a handle on somebody else's.
    const second = await theirs.mutation(api.library.importDocument, anImport());

    expect(second).not.toBe(first);
    expect((await theirs.query(api.library.home, {})).recentlyAdded).toHaveLength(1);
  });

  test('a localId that is not one Pidom writes is refused', async () => {
    const t = harness();
    const as = await signedIn(t);

    await expect(
      as.mutation(api.library.importDocument, anImport({ localId: '../../etc/passwd' })),
    ).rejects.toThrow();
  });
});

describe('addAnnotation', () => {
  test('delivered twice with one clientOpId keeps one note', async () => {
    const t = harness();
    const as = await signedIn(t);
    const documentId = await as.mutation(api.library.importDocument, anImport());

    const args = {
      documentId,
      currentPage: 88,
      kind: 'note' as const,
      note: 'The bit about anchoring.',
      clientOpId: localId('note001'),
    };

    const first = await as.mutation(api.library.addAnnotation, args);
    const second = await as.mutation(api.library.addAnnotation, args);

    expect(second).toBe(first);
    expect(await storedAnnotations(t, documentId)).toHaveLength(1);
  });

  test('without a clientOpId two calls are two notes, as they should be', async () => {
    const t = harness();
    const as = await signedIn(t);
    const documentId = await as.mutation(api.library.importDocument, anImport());

    // Two passages from one page are two different sentences. Only an id the
    // device minted can tell a duplicate from a second thought.
    const args = { documentId, currentPage: 88, kind: 'note' as const, note: 'Twice.' };
    await as.mutation(api.library.addAnnotation, args);
    await as.mutation(api.library.addAnnotation, args);

    expect(await storedAnnotations(t, documentId)).toHaveLength(2);
  });
});

describe('deletes delivered twice', () => {
  test('removeAnnotation is silent the second time', async () => {
    const t = harness();
    const as = await signedIn(t);
    const documentId = await as.mutation(api.library.importDocument, anImport());
    const annotationId = await as.mutation(api.library.addAnnotation, {
      documentId,
      currentPage: 12,
      kind: 'note',
      note: 'Gone in a moment.',
    });

    await as.mutation(api.library.removeAnnotation, { annotationId });
    // This is the one that used to throw `FORBIDDEN` and jam the queue for
    // ever, over a note that was already deleted.
    await expect(as.mutation(api.library.removeAnnotation, { annotationId })).resolves.toBeNull();
  });

  test('removeAnnotation still refuses somebody else s note', async () => {
    const t = harness();
    const mine = await signedIn(t);
    const theirs = await signedIn(t, OTHER);

    const documentId = await mine.mutation(api.library.importDocument, anImport());
    const annotationId = await mine.mutation(api.library.addAnnotation, {
      documentId,
      currentPage: 12,
      kind: 'note',
      note: 'Mine.',
    });

    await expect(theirs.mutation(api.library.removeAnnotation, { annotationId })).rejects.toThrow();
  });

  test('removeBookmark is silent on a page that was never marked', async () => {
    const t = harness();
    const as = await signedIn(t);
    const documentId = await as.mutation(api.library.importDocument, anImport());

    await expect(
      as.mutation(api.library.removeBookmark, { documentId, currentPage: 41 }),
    ).resolves.toBeNull();
  });

  test('renameBookmark is silent rather than terminal when the mark is gone', async () => {
    const t = harness();
    const as = await signedIn(t);
    const documentId = await as.mutation(api.library.importDocument, anImport());

    // A reader who named a bookmark and then removed it before the phone found
    // a signal used to leave a dead letter in their outbox for an intention
    // they had already changed their mind about.
    await expect(
      as.mutation(api.library.renameBookmark, { documentId, currentPage: 41, label: 'Anchors' }),
    ).resolves.toBeNull();
  });

  test('addBookmark twice on one page renames rather than duplicates', async () => {
    const t = harness();
    const as = await signedIn(t);
    const documentId = await as.mutation(api.library.importDocument, anImport());

    await as.mutation(api.library.addBookmark, { documentId, currentPage: 152 });
    await as.mutation(api.library.addBookmark, {
      documentId,
      currentPage: 152,
      label: 'Anchors',
    });

    const bookmarks = await storedBookmarks(t, documentId);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]?.label).toBe('Anchors');
  });
});

describe('bookmark labels across two devices', () => {
  test('a label queued yesterday does not overwrite one named since', async () => {
    const t = harness();
    const as = await signedIn(t);
    const documentId = await as.mutation(api.library.importDocument, anImport());
    await as.mutation(api.library.addBookmark, { documentId, currentPage: 142 });

    // The tablet, this morning.
    await as.mutation(api.library.renameBookmark, {
      documentId,
      currentPage: 142,
      label: 'The proof',
      clientUpdatedAt: 9_000,
    });

    // The phone that was in a tunnel when the reader typed this one.
    await as.mutation(api.library.renameBookmark, {
      documentId,
      currentPage: 142,
      label: 'Chapter 9',
      clientUpdatedAt: 1_000,
    });

    // The outbox used to send every rename through `addBookmark`, which takes
    // no clock — so whichever phone reconnected last won, and a label a reader
    // had replaced came back.
    expect((await storedBookmarks(t, documentId))[0]?.label).toBe('The proof');
  });

  test('a newer label still wins', async () => {
    const t = harness();
    const as = await signedIn(t);
    const documentId = await as.mutation(api.library.importDocument, anImport());
    await as.mutation(api.library.addBookmark, { documentId, currentPage: 142 });

    await as.mutation(api.library.renameBookmark, {
      documentId,
      currentPage: 142,
      label: 'Chapter 9',
      clientUpdatedAt: 1_000,
    });
    await as.mutation(api.library.renameBookmark, {
      documentId,
      currentPage: 142,
      label: 'The proof',
      clientUpdatedAt: 9_000,
    });

    expect((await storedBookmarks(t, documentId))[0]?.label).toBe('The proof');
  });
});

describe('outlines', () => {
  test('a second device can read the contents the first one probed', async () => {
    const t = harness();
    const as = await signedIn(t);
    const documentId = await as.mutation(api.library.importDocument, anImport({ pageCount: 433 }));

    // The phone that imported the file: one `<Pdf>` load gives the page count,
    // the cover and the table of contents together.
    await as.mutation(api.library.setProcessed, {
      documentId,
      processing: 'ready',
      pageCount: 433,
      outline: [
        { title: 'Part I', page: 1, depth: 0 },
        { title: 'Anchors', page: 119, depth: 1 },
      ],
    });

    // The tablet, which only ever downloaded it and has never run a probe. Its
    // row arrives with `hasOutline` true and nothing behind it, so Contents was
    // an empty list under a heading promising one until the reconcile learned
    // to ask for this.
    const outline = await as.query(api.library.outline, { documentId });
    expect(outline).toHaveLength(2);
    expect(outline[1]?.page).toBe(119);
  });
});

describe('clientUpdatedAt', () => {
  test('a position that arrives late does not overwrite a newer one', async () => {
    const t = harness();
    const as = await signedIn(t);
    const documentId = await as.mutation(api.library.importDocument, anImport({ pageCount: 499 }));

    // The tablet, at four o'clock.
    await as.mutation(api.library.recordProgress, {
      documentId,
      currentPage: 300,
      clientUpdatedAt: 4_000,
    });

    // The phone that spent the day in a bag, queued at nine and delivered now.
    await as.mutation(api.library.recordProgress, {
      documentId,
      currentPage: 12,
      clientUpdatedAt: 1_000,
    });

    const document = await storedDocument(t, documentId);
    expect(document?.currentPage).toBe(300);
  });

  test('a newer position still wins', async () => {
    const t = harness();
    const as = await signedIn(t);
    const documentId = await as.mutation(api.library.importDocument, anImport({ pageCount: 499 }));

    await as.mutation(api.library.recordProgress, {
      documentId,
      currentPage: 300,
      clientUpdatedAt: 4_000,
    });
    await as.mutation(api.library.recordProgress, {
      documentId,
      currentPage: 438,
      clientUpdatedAt: 9_000,
    });

    const document = await storedDocument(t, documentId);
    expect(document?.currentPage).toBe(438);
  });

  test('a client that sends no clock is applied, as an older one always was', async () => {
    const t = harness();
    const as = await signedIn(t);
    const documentId = await as.mutation(api.library.importDocument, anImport({ pageCount: 499 }));

    await as.mutation(api.library.recordProgress, {
      documentId,
      currentPage: 300,
      clientUpdatedAt: 4_000,
    });
    await as.mutation(api.library.recordProgress, { documentId, currentPage: 77 });

    const document = await storedDocument(t, documentId);
    expect(document?.currentPage).toBe(77);
  });

  test('a stale rename is dropped', async () => {
    const t = harness();
    const as = await signedIn(t);
    const documentId = await as.mutation(api.library.importDocument, anImport());

    await as.mutation(api.library.rename, {
      documentId,
      title: 'The newer title',
      clientUpdatedAt: 4_000,
    });
    await as.mutation(api.library.rename, {
      documentId,
      title: 'The older title',
      clientUpdatedAt: 1_000,
    });

    const document = await storedDocument(t, documentId);
    expect(document?.title).toBe('The newer title');
  });
});

describe('collections', () => {
  test('create delivered twice with one clientOpId makes one collection', async () => {
    const t = harness();
    const as = await signedIn(t);

    const args = { name: 'Contracts', clientOpId: localId('coll001') };
    const first = await as.mutation(api.collections.create, args);
    const second = await as.mutation(api.collections.create, args);

    expect(second).toBe(first);
    expect(await as.query(api.collections.list, {})).toHaveLength(1);
  });

  test('membership is a set: adding twice adds once', async () => {
    const t = harness();
    const as = await signedIn(t);
    const documentId = await as.mutation(api.library.importDocument, anImport());
    const collectionId = await as.mutation(api.collections.create, { name: 'Contracts' });

    await as.mutation(api.collections.addDocument, { collectionId, documentId });
    await as.mutation(api.collections.addDocument, { collectionId, documentId });

    const [collection] = await as.query(api.collections.list, {});
    expect(collection?.documentCount).toBe(1);
  });

  test('a read that names a document refuses one the caller does not own', async () => {
    const t = harness();
    const mine = await signedIn(t);
    const theirs = await signedIn(t, OTHER);
    const documentId = await mine.mutation(api.library.importDocument, anImport());

    // `outline` stands in for the shape rather than for itself: a query whose
    // only argument is a document id, answering `FORBIDDEN` rather than an
    // empty list. An empty list is a different sentence — it says the document
    // exists — and this was the one read path in the backend that gave the same
    // one for both.
    await expect(theirs.query(api.library.outline, { documentId })).rejects.toThrow();
  });
});

describe('the reconcile reads', () => {
  test('snapshot returns the whole account, paged', async () => {
    const t = harness();
    const as = await signedIn(t);

    for (let n = 0; n < 3; n += 1) {
      await as.mutation(
        api.library.importDocument,
        anImport({ localId: localId(`doc${n}`), title: `Document ${n}` }),
      );
    }

    const page = await as.query(api.library.snapshot, {
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(page.page).toHaveLength(3);
    expect(page.isDone).toBe(true);
  });

  test('a snapshot holds only the caller s own documents', async () => {
    const t = harness();
    const mine = await signedIn(t);
    const theirs = await signedIn(t, OTHER);

    await mine.mutation(api.library.importDocument, anImport({ title: 'Mine' }));
    await theirs.mutation(api.library.importDocument, anImport({ title: 'Theirs' }));

    const page = await mine.query(api.library.snapshot, {
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(page.page.map((row) => row.title)).toEqual(['Mine']);
  });

  test('allBookmarks and allAnnotations name their documents', async () => {
    const t = harness();
    const as = await signedIn(t);
    const documentId = await as.mutation(api.library.importDocument, anImport());

    await as.mutation(api.library.addBookmark, { documentId, currentPage: 152 });
    await as.mutation(api.library.addAnnotation, {
      documentId,
      currentPage: 88,
      kind: 'note',
      note: 'Kept.',
    });

    const marks = await as.query(api.library.allBookmarks, {
      paginationOpts: { numItems: 50, cursor: null },
    });
    const notes = await as.query(api.library.allAnnotations, {
      paginationOpts: { numItems: 50, cursor: null },
    });

    expect(marks.page[0]?.documentId).toBe(documentId);
    expect(notes.page[0]?.documentId).toBe(documentId);
  });

  test('a signed-out caller reads nothing', async () => {
    const t = harness();
    await expect(
      t.query(api.library.snapshot, { paginationOpts: { numItems: 50, cursor: null } }),
    ).rejects.toThrow();
  });
});
