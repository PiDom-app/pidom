import { Workpool } from '@convex-dev/workpool';
import { v } from 'convex/values';

import { components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalMutation } from './_generated/server';
import {
  DELIVERY_PRUNE_LIMIT,
  JOB_STALE_MS,
  JOB_SWEEP_LIMIT,
  PAGE_DELETE_BUDGET,
  PRUNE_DOCUMENTS,
  SHARE_EXPIRY_SWEEP,
  WORKFLOW_CLEANUP_LIMIT,
} from './model/limits';
import * as Processing from './model/processing';
import * as Sharing from './model/sharing';
import { queueExtraction, workflow } from './workflows/document';

/**
 * The work that keeps the deployment honest overnight.
 *
 * Four jobs, all repairs for the same class of problem: something that
 * accumulates because nothing else will ever collect it. Neither R2 nor Convex
 * garbage-collects anything, and nothing in any screen can show the wreckage,
 * so without this it grows forever and the reader pays for it.
 *
 * **A pool rather than a flow**, and that is the distinction against
 * `convex/workflows/document.ts` next door. These three are independent,
 * unordered and idempotent: any one can fail and be retried without the others
 * knowing. A workflow's whole value is ordering and a resumable journal, and
 * there is nothing here to order.
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
