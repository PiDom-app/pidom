import { Workpool } from '@convex-dev/workpool';
import { v } from 'convex/values';

import { components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import {
  BLOB_RELEASE_LIMIT,
  DELIVERY_PRUNE_LIMIT,
  EXTRACT_PAGE_MAX,
  JOB_STALE_MS,
  JOB_SWEEP_LIMIT,
  MIGRATE_DOCUMENTS,
  PAGE_DELETE_BUDGET,
  PAGE_DRAIN_PASSES,
  PRUNE_DOCUMENTS,
  READING_ACTIVITY_BACKFILL,
  READING_ACTIVITY_FLIP_MS,
  SHARE_EXPIRY_SWEEP,
  USAGE_RECOUNT_ACCOUNTS,
  WORKFLOW_CLEANUP_LIMIT,
} from './model/limits';
import * as Blobs from './model/blobs';
import { textKey } from './model/library';
import * as Processing from './model/processing';
import * as Sharing from './model/sharing';
import * as Usage from './model/usage';
import { r2 } from './r2';
import { queueExtraction, workflow } from './workflows/document';

/**
 * The work that keeps the deployment honest overnight.
 *
 * Every job here is a repair for the same class of problem: something that
 * accumulates because nothing else will ever collect it. Neither R2 nor Convex
 * garbage-collects anything, and nothing in any screen can show the wreckage,
 * so without this it grows forever and the reader pays for it. Two of them —
 * the page-text backfill and the blob release — are also the halves of a
 * migration that has to converge without anybody watching it.
 *
 * **A pool rather than a flow**, and that is the distinction against
 * `convex/workflows/document.ts` next door. These are independent, unordered
 * and idempotent: any one can fail and be retried without the others knowing.
 * A workflow's whole value is ordering and a resumable journal, and there is
 * nothing here to order.
 *
 * **Its own pool rather than the workflow's**, so a night of maintenance cannot
 * sit in front of a reader's import. Two at a time: the free plan allows 20
 * across every pool in the deployment and the workflow's takes 4, and these run
 * at three in the morning with nobody waiting.
 */
export const maintenance = new Workpool(components.maintenance, {
  maxParallelism: 2,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 30_000, base: 2 },
});

/**
 * The nightly entry point. Queues the jobs and returns.
 *
 * A cron runs one function, and doing them all inline would be one mutation
 * whose time budget is one second. Queueing them puts each on the pool's own
 * retry, so a sweep that fails does not take the re-drive down with it.
 */
export const nightly = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await maintenance.enqueueMutation(ctx, internal.library.sweepOrphanedObjects, {});
    await maintenance.enqueueMutation(ctx, internal.maintenance.redriveStaleJobs, {});
    await maintenance.enqueueMutation(ctx, internal.maintenance.prunePagesOfUnsynced, {});
    // Actions, not mutations: both of these talk to R2. The pool's own retry
    // covers them — `retryActionsByDefault` — which is the point of putting an
    // R2 call in an action rather than beside a database write that would roll
    // back with it.
    await maintenance.enqueueAction(ctx, internal.maintenance.migratePagesToR2, {});
    await maintenance.enqueueAction(ctx, internal.maintenance.releaseBlobs, {});
    await maintenance.enqueueMutation(ctx, internal.maintenance.recountUsage, {});
    await maintenance.enqueueMutation(ctx, internal.maintenance.cleanupWorkflows, {});
    await maintenance.enqueueMutation(ctx, internal.maintenance.prunePushDeliveries, {});
    return null;
  },
});

/**
 * Marks shares whose time is up.
 *
 * **Hourly rather than nightly, and that is a security decision.** Everything
 * else in this file repairs waste — an orphaned object, a stale job, page text
 * outliving a sync. This one ends somebody's access, and a permission that was
 * supposed to lapse at nine in the morning should not still be readable at two
 * in the afternoon.
 *
 * It is not the only enforcement. `Access.refuseIfExpired` checks a fresh clock
 * on every mutation that hands out a signed URL or writes an annotation, so
 * nothing capability-granting waits for this. What the sweep adds is the read
 * path: a Convex query is not re-run because time advanced, so a screen
 * subscribed to a live share goes on rendering it as live until a write
 * invalidates the subscription. This is that write.
 */
export const expireShares = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    return await Sharing.expireDue(ctx, SHARE_EXPIRY_SWEEP);
  },
});

/**
 * Drops delivery rows that have already told us what they were going to.
 *
 * A `pushDeliveries` row exists to connect a ticket to a receipt. Once the
 * receipt has landed it is a log line, and the table grows by one row per
 * notification per device forever without this.
 *
 * A week, because that is long enough to answer "did this reach them" while
 * somebody is still asking.
 */
export const prunePushDeliveries = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    return await ctx.runMutation(internal.push.pruneDeliveries, {
      olderThanMs: 7 * 24 * 60 * 60 * 1000,
      limit: DELIVERY_PRUNE_LIMIT,
    });
  },
});

/**
 * Restarts extractions that died without writing a terminal state.
 *
 * A Node action's own ceiling is ten minutes, so a job still claiming to be
 * `running` an hour later is a job whose process went away — the workflow's
 * `onComplete` never fired and the document sits at `extracting` with half its
 * pages in the table. Nothing else in the system will ever notice.
 *
 * `queued` is swept too, for the narrower case in `queueExtraction`: the row
 * was written and the workflow failed to start.
 */
export const redriveStaleJobs = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - JOB_STALE_MS;
    let restarted = 0;

    for (const status of ['running', 'queued'] as const) {
      const stale = await ctx.db
        .query('documentJobs')
        .withIndex('by_status', (q) => q.eq('status', status).lt('updatedAt', cutoff))
        .take(JOB_SWEEP_LIMIT);

      for (const job of stale) {
        const doc = await ctx.db.get('documents', job.documentId);

        // The document went away, or stopped being synced. There is nothing to
        // extract, so the job goes with it rather than being retried forever.
        if (doc === null || doc.storageKey === undefined) {
          await ctx.db.delete('documentJobs', job._id);
          continue;
        }

        // One enqueue rather than a `queueExtraction` inline. That call is a
        // `workflow.cancel` plus a `workflow.start` against the component's
        // tables, and forty of them in a mutation with a one-second budget is a
        // mutation that does not finish. The pool runs them two at a time with
        // its own retry, which is what it is for.
        await maintenance.enqueueMutation(ctx, internal.maintenance.redriveOne, {
          documentId: doc._id,
        });
        restarted += 1;
      }
    }
    return restarted;
  },
});

/**
 * Restarts one extraction. The unit the pool schedules.
 *
 * Re-checked here rather than trusted from the enqueue: minutes can pass in the
 * queue, and in that time the document can be deleted or unsynced.
 */
export const redriveOne = internalMutation({
  args: { documentId: v.id('documents') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get('documents', args.documentId);
    if (doc === null || doc.storageKey === undefined) {
      return null;
    }
    // `queueExtraction` replaces the job row, so a re-drive is one call rather
    // than a cancel and a restart.
    await queueExtraction(ctx, doc._id, doc.ownerId);
    return null;
  },
});

/**
 * Clears page text for documents that have none left to point at it.
 *
 * It drains a queue rather than hunting. `detachUpload` and `removeDocument`
 * both delete as much as one mutation's read budget allows and then record what
 * they could not reach, so this knows exactly which documents to look at.
 *
 * The version this replaced took the first sixty rows of `documentPages` and
 * checked whether each one's document was still synced. Those sixty are the
 * oldest pages in the deployment — almost always a document that is perfectly
 * fine — so the job swept nothing, every night, while the reader's own document
 * text sat further down the table with nothing pointing at it.
 *
 * Page text is the most sensitive thing Pidom stores. A collector that cannot
 * reach it is worse than no collector, because it reads as one.
 */
export const prunePagesOfUnsynced = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const queued = await ctx.db
      .query('pagePruneQueue')
      .withIndex('by_queued')
      .order('asc')
      .take(PRUNE_DOCUMENTS);

    let deleted = 0;
    for (const row of queued) {
      // A document that came back into sync between the queue and now keeps its
      // text: it is being searched again, and the row was a note about a delete
      // that has since been undone.
      const doc = await ctx.db.get('documents', row.documentId as Id<'documents'>);
      if (doc !== null && doc.storageKey !== undefined) {
        await ctx.db.delete('pagePruneQueue', row._id);
        continue;
      }
      deleted += await Processing.drainPagePrune(ctx, row, PAGE_DELETE_BUDGET);
    }
    return deleted;
  },
});

/**
 * Keeps clearing one document's page rows until they are gone.
 *
 * The other half of `Library.dropPageText`. A delete clears what one mutation's
 * read budget allows and then schedules this, a second apart, up to
 * `PAGE_DRAIN_PASSES` times — so a shelf of long textbooks empties in seconds
 * rather than over the nights it took when the only drain was the nightly
 * queue. This is the reader's own document text, and "it will be gone by
 * Thursday" was never a good answer.
 *
 * Self-limiting in two directions: `passesLeft` counts down, and a pass that
 * finds less than a full batch stops the chain. Whatever a broken chain leaves
 * behind is still on `pagePruneQueue`, which is what the nightly pass drains.
 */
export const drainDocumentPages = internalMutation({
  args: { documentId: v.id('documents'), passesLeft: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const deleted = await Processing.deletePages(ctx, args.documentId, PAGE_DELETE_BUDGET);

    if (deleted < PAGE_DELETE_BUDGET) {
      // Empty. The queue row is the note that said otherwise, so it goes too.
      const queued = await ctx.db
        .query('pagePruneQueue')
        .withIndex('by_document', (q) => q.eq('documentId', args.documentId))
        .unique();
      if (queued !== null) {
        await ctx.db.delete('pagePruneQueue', queued._id);
      }
      return null;
    }

    if (args.passesLeft > 1) {
      await ctx.scheduler.runAfter(1_000, internal.maintenance.drainDocumentPages, {
        documentId: args.documentId,
        passesLeft: args.passesLeft - 1,
      });
    }
    return null;
  },
});

/**
 * Moves page text out of the database and into R2, a few documents a night.
 *
 * The backfill for everything extracted before page text became one object per
 * document. It is the whole reason the old table still exists: dropping it
 * outright would take the text of every book anybody had already synced, and
 * their devices would have nothing to re-mirror from until somebody reprocessed
 * each one by hand.
 *
 * Deliberately slow and repeatable. Each document is one bounded read of its
 * rows, one object written, one patch, and then the rows go — so a run that
 * fails halfway leaves a document either wholly migrated or wholly not, and the
 * next night picks it up again. Nothing here is ordered against anything else.
 *
 * An action rather than a mutation, because writing to R2 needs the bucket
 * credentials from the deployment's environment. The reads and writes on either
 * side of the object are their own mutations, so neither transaction is held
 * open across a network call.
 */
export const migratePagesToR2 = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const pending = await ctx.runQuery(internal.maintenance.pendingMigration, {});

    let moved = 0;
    for (const target of pending) {
      const pages = await ctx.runQuery(internal.maintenance.pagesForMigration, {
        documentId: target.documentId,
      });
      if (pages.length === 0) {
        // Nothing to move. `textStatus: 'ready'` with no rows is a document
        // whose pages were already cleared — marked `none` rather than left to
        // be reconsidered every night for ever.
        await ctx.runMutation(internal.maintenance.finishMigration, {
          documentId: target.documentId,
          textStorageKey: null,
          textBytes: null,
        });
        continue;
      }

      const body = new TextEncoder().encode(
        JSON.stringify({ v: 1, pages: pages.map((page) => ({ p: page.page, t: page.text })) }),
      );
      await r2.store(ctx, body, {
        key: target.textStorageKey,
        type: 'application/json',
        cacheControl: 'private, max-age=31536000, immutable',
      });

      await ctx.runMutation(internal.maintenance.finishMigration, {
        documentId: target.documentId,
        textStorageKey: target.textStorageKey,
        textBytes: body.byteLength,
      });
      moved += 1;
    }
    return moved;
  },
});

/** Documents whose text is still in the database. Bounded, oldest first. */
export const pendingMigration = internalQuery({
  args: {},
  returns: v.array(v.object({ documentId: v.id('documents'), textStorageKey: v.string() })),
  handler: async (ctx) => {
    // Off `by_queued`-style ordering there is nothing to index on — "ready and
    // no text key" is not a shape worth an index for a migration that runs a
    // handful of times. The scan is bounded by `.take`, and it shrinks every
    // night as documents are migrated out of the set it matches.
    const candidates = await ctx.db
      .query('documents')
      .withIndex('by_owner')
      .filter((q) =>
        q.and(q.eq(q.field('textStatus'), 'ready'), q.eq(q.field('textStorageKey'), undefined)),
      )
      .take(MIGRATE_DOCUMENTS);

    return candidates.map((doc) => ({
      documentId: doc._id,
      // Minted here from the row's own ids, like every other key in this
      // backend. The migration never takes one from anywhere.
      textStorageKey: textKey(doc.ownerId, doc._id),
    }));
  },
});

/** One document's pages, in order. The read the object is built from. */
export const pagesForMigration = internalQuery({
  args: { documentId: v.id('documents') },
  returns: v.array(v.object({ page: v.number(), text: v.string() })),
  handler: async (ctx, args) => {
    const pages = await ctx.db
      .query('documentPages')
      .withIndex('by_document_and_page', (q) => q.eq('documentId', args.documentId))
      .take(EXTRACT_PAGE_MAX);
    return pages.map((page) => ({ page: page.page, text: page.text }));
  },
});

/**
 * Records a migrated document and deletes the rows the object replaced.
 *
 * The delete is chained rather than done here for the same reason a document's
 * own delete is: the rows are read before they go, a page holds up to
 * `PAGE_TEXT_MAX`, and a 2,000-page book is past what one mutation may read.
 */
export const finishMigration = internalMutation({
  args: {
    documentId: v.id('documents'),
    textStorageKey: v.union(v.string(), v.null()),
    textBytes: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get('documents', args.documentId);
    if (doc === null) {
      return null;
    }

    if (args.textStorageKey === null) {
      const patch = { textStatus: 'none' as const, updatedAt: Date.now() };
      await Usage.changed(ctx, doc, patch);
      await ctx.db.patch('documents', doc._id, patch);
      return null;
    }

    await ctx.db.patch('documents', doc._id, {
      textStorageKey: args.textStorageKey,
      ...(args.textBytes === null ? {} : { textBytes: args.textBytes }),
      updatedAt: Date.now(),
    });

    // So the next account to import these bytes inherits the object rather than
    // re-parsing the file.
    if (doc.blobId !== undefined) {
      await Blobs.setText(ctx, doc.blobId, {
        textStorageKey: args.textStorageKey,
        ...(args.textBytes === null ? {} : { textBytes: args.textBytes }),
        textStatus: 'ready',
      });
    }

    await Processing.queuePagePrune(ctx, doc._id);
    await ctx.scheduler.runAfter(1_000, internal.maintenance.drainDocumentPages, {
      documentId: doc._id,
      passesLeft: PAGE_DRAIN_PASSES,
    });
    return null;
  },
});

/**
 * Deletes the objects of content nothing points at any more.
 *
 * A blob reaches `refCount === 0` in the transaction that removed the last
 * document referencing it, and that transaction deliberately does not delete
 * anything: an R2 call failing inside it would roll back a delete the reader
 * has already watched succeed. So the bytes are collected here instead, where
 * the worst case of a failure is that tomorrow's run tries again.
 *
 * The row goes with the objects. A released blob kept as a tombstone would
 * shadow the next upload of the same bytes — `by_hash` would find it, hand out
 * a `storageKey` pointing at nothing, and every account that deduped onto it
 * would have a document that 404s.
 */
export const releaseBlobs = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const released = await ctx.runQuery(internal.maintenance.releasedBlobs, {});

    let collected = 0;
    for (const blob of released) {
      await r2.deleteObject(ctx, blob.storageKey).catch(() => undefined);
      if (blob.textStorageKey !== null) {
        await r2.deleteObject(ctx, blob.textStorageKey).catch(() => undefined);
      }
      // Only after the objects are gone. A row dropped first would leave bytes
      // nothing in the deployment can name, which is the one kind of waste the
      // nightly sweep cannot find either — it asks this table what is still in
      // use, and an object with no row reads as an orphan only if its key parses
      // as a document's. A `blobs/` key does not.
      await ctx.runMutation(internal.maintenance.forgetBlob, { blobId: blob.blobId });
      collected += 1;
    }
    return collected;
  },
});

/** Blobs nothing references. The list `releaseBlobs` works from. */
export const releasedBlobs = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      blobId: v.id('contentBlobs'),
      storageKey: v.string(),
      textStorageKey: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('contentBlobs')
      .filter((q) => q.eq(q.field('refCount'), 0))
      .take(BLOB_RELEASE_LIMIT);
    return rows.map((row) => ({
      blobId: row._id,
      storageKey: row.storageKey,
      textStorageKey: row.textStorageKey ?? null,
    }));
  },
});

/** Drops a released blob's row, once its objects are gone. */
export const forgetBlob = internalMutation({
  args: { blobId: v.id('contentBlobs') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const blob = await ctx.db.get('contentBlobs', args.blobId);
    // Re-checked rather than trusted from the enqueue: an account can import
    // the same file in the seconds between the query and here, and a blob that
    // has been claimed again must not lose its row.
    if (blob !== null && blob.refCount === 0) {
      await ctx.db.delete('contentBlobs', blob._id);
    }
    return null;
  },
});

/**
 * Re-derives a few accounts' usage counters from their rows.
 *
 * `users.usage` is maintained incrementally, which is what lets `library.usage`
 * be a single row read instead of a reactive scan of the whole library on every
 * device. The cost of that is drift: a mutation added later that forgets to
 * report, a path nobody thought of. This is the guard — the numbers are wrong
 * for at most a few days, on a screen that shows them to one person, rather
 * than wrong for ever.
 *
 * Oldest count first, so the pass cycles through every account rather than
 * re-checking the same few.
 */
export const recountUsage = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const accounts = await ctx.db.query('users').take(USAGE_RECOUNT_ACCOUNTS * 4);

    // Sorted in memory rather than by an index. An index on `usage.countedAt`
    // would be a write on every document change in the deployment to order a
    // job that runs once a night; this reads a small multiple of what it needs
    // and takes the stalest of them.
    const stalest = accounts
      .sort((a, b) => (a.usage?.countedAt ?? 0) - (b.usage?.countedAt ?? 0))
      .slice(0, USAGE_RECOUNT_ACCOUNTS);

    for (const account of stalest) {
      await Usage.recount(ctx, account._id);
    }
    return stalest.length;
  },
});

/**
 * Deletes the journals of workflows that have finished.
 *
 * The component's own docs are explicit that a completed workflow's state is
 * kept until something calls `cleanup`, and Pidom runs one per document per
 * sync. Left alone, the component's tables grow by a full step journal for
 * every document ever added to any account in the deployment.
 *
 * Oldest first and bounded, so this converges over nights rather than trying to
 * empty a year of history in one mutation.
 */
export const cleanupWorkflows = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const page = await workflow.list(ctx, {
      order: 'asc',
      paginationOpts: { cursor: null, numItems: WORKFLOW_CLEANUP_LIMIT },
    });

    let cleaned = 0;
    for (const run of page.page) {
      // `runResult` is absent while a workflow is still going. Only a finished
      // one has a journal that is safe to drop.
      if (run.runResult === undefined) {
        continue;
      }
      if (await workflow.cleanup(ctx, run.workflowId)) {
        cleaned += 1;
      }
    }
    return cleaned;
  },
});

/**
 * Resets a `showReadingActivity` that was never chosen back to its default.
 *
 * A one-time correction rather than a nightly pass, so it is not queued from
 * `nightly` — run it once by hand with `npx convex run` after deploy.
 *
 * The bug it repairs: `showReadingActivity` shipped defaulting to `false` while
 * it governed nothing, then commit `d122e21` flipped the default to `true` and
 * in the same change made `presence.heartbeat` enforce it. But a default lives
 * in code, and `patchSharing` writes the whole default set into a row the first
 * time any setting changes — so every account that had touched a sharing
 * setting before that commit has `false` baked into its row, and
 * `stripMeta` keeps a stored `false` because it only fills in what is
 * `undefined`. Those readers are invisible in every document room despite never
 * deciding to be. See `convex/model/settings.ts` and `convex/presence.ts`.
 *
 * **The cutoff is what makes this safe.** A row last written before
 * `READING_ACTIVITY_FLIP_MS` and still holding `false` was set by the old
 * default, not by a person — the toggle did nothing then. A row written at or
 * after it holding `false` is somebody who turned presence off on purpose, and
 * this must not touch it. `updatedAt` is the field `patchSharing` moves on
 * every write, so it is the honest "last decided" clock.
 *
 * Self-limiting the way the other batch jobs are: one bounded page, patch the
 * stale rows in it, and reschedule a second later with the cursor until the
 * table is exhausted. Idempotent — a second run patches nothing, because the
 * rows it fixed now read `true`.
 */
export const backfillReadingActivity = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('sharingSettings')
      .paginate({ cursor: args.cursor, numItems: READING_ACTIVITY_BACKFILL });

    for (const row of page.page) {
      if (row.showReadingActivity === false && row.updatedAt < READING_ACTIVITY_FLIP_MS) {
        await ctx.db.patch('sharingSettings', row._id, { showReadingActivity: true });
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(1_000, internal.maintenance.backfillReadingActivity, {
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});

/**
 * How many rows the backfill above would touch, without touching them.
 *
 * The dry run: read it before scheduling `backfillReadingActivity` so the blast
 * radius is a number somebody has seen rather than a hope. Same predicate as the
 * patch — `false` and last written before the flip — so the count is exactly the
 * set that will change.
 */
export const staleReadingActivityCount = internalQuery({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let stale = 0;
    for await (const row of ctx.db.query('sharingSettings')) {
      if (row.showReadingActivity === false && row.updatedAt < READING_ACTIVITY_FLIP_MS) {
        stale += 1;
      }
    }
    return stale;
  },
});
