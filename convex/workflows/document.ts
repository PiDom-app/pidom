import { WorkflowManager, vWorkflowId, type WorkflowId } from '@convex-dev/workflow';
import { vResultValidator } from '@convex-dev/workpool';
import { v } from 'convex/values';

import { components, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from '../_generated/server';
import * as Processing from '../model/processing';
import { EXTRACT_BYTE_MAX, PAGE_DELETE_BUDGET } from '../model/limits';
import { r2 } from '../r2';

/**
 * The extraction pipeline, and the only durable multi-step flow in Pidom.
 *
 * It runs over the copy in R2, so it exists at all only for a document the
 * reader chose to sync. The device half of processing — cover, page count,
 * table of contents — never comes here, because the file is on the phone and
 * `react-native-pdf` answers all three off one load. See
 * `src/features/library/components/document-probe.tsx`.
 *
 * **Why a workflow rather than a scheduled action.** Extraction is four steps
 * with different failure modes: a fetch that can 404, a parse that can hang, a
 * long run of writes, and a finalisation that must happen exactly once. A
 * scheduled action that dies halfway leaves a document `extracting` forever
 * with half its pages in the table and nothing to notice. This survives a
 * server restart, retries the step that failed rather than the whole run, and
 * publishes a status the Details sheet subscribes to.
 *
 * **Determinism is a constraint, not a style note.** The handler must not
 * `fetch`, read the clock, or branch on anything that could differ between the
 * first run and a replay after a restart — every side effect goes through a
 * step. Changing the shape of the steps while runs are in flight fails those
 * runs, so a change here wants the queue drained first.
 */
export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    /**
     * The free plan allows 20 across every pool in the deployment, and the
     * `maintenance` pool takes 2 of them. Four concurrent extraction steps is a
     * reader syncing four books at once, which is already generous.
     */
    maxParallelism: 4,
    retryActionsByDefault: true,
    /**
     * Three attempts, ten seconds apart and doubling. The failures worth
     * retrying are transient — R2 refusing a request, a signed URL that expired
     * between minting and use — and a malformed PDF throws `NonRetryableError`
     * out of the action instead.
     */
    defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 10_000, base: 2 },
  },
});

/* ── the flow ────────────────────────────────────────────────────────── */

export const extractDocument = workflow.define({
  args: { documentId: v.id('documents') },
  // Declared, and the component's docs ask for it: without a `returns` the
  // workflow's type refers to itself through `internal` and TypeScript gives up.
  returns: v.object({ written: v.number(), hasText: v.boolean() }),
  handler: async (step, args): Promise<{ written: number; hasText: boolean }> => {
    const target = await step.runQuery(internal.workflows.document.target, {
      documentId: args.documentId,
    });

    // The document was deleted or unsynced between the enqueue and now. Both
    // of those paths already cleared `textStatus` and the job row on their way
    // through, so there is nothing left to record.
    if (target.kind === 'gone') {
      return { written: 0, hasText: false };
    }

    // Synced, but past what a Node action can parse. This is a terminal answer
    // rather than a failure to retry, and it has to be written down: without it
    // the document sits at `queued` for good and the nightly re-drive picks it
    // up every night to reach the same conclusion.
    if (target.kind === 'too-large') {
      await step.runMutation(internal.workflows.document.finalize, {
        documentId: args.documentId,
        outcome: 'failed',
        written: 0,
        error: 'TOO_LARGE',
      });
      return { written: 0, hasText: false };
    }

    // Clearing the previous run's pages, a bounded batch at a time. Re-extracting
    // a book has to empty the table first or every page ends up in it twice, and
    // deleting a page reads its text — so one mutation cannot do a long book.
    // The loop is bounded so a workflow can never spin: `EXTRACT_PAGE_MAX` over
    // `PAGE_DELETE_BUDGET` is five, and eight leaves room.
    for (let pass = 0; pass < 8; pass += 1) {
      const removed = await step.runMutation(
        internal.workflows.document.clearPages,
        { documentId: args.documentId },
        { name: `clear ${pass}` },
      );
      if (removed < PAGE_DELETE_BUDGET) {
        break;
      }
    }

    const result = await step.runAction(
      internal.node.extract.extractText,
      {
        documentId: args.documentId,
        storageKey: target.storageKey,
        byteSize: target.byteSize,
      },
      { name: 'extract' },
    );

    await step.runMutation(internal.workflows.document.finalize, {
      documentId: args.documentId,
      outcome: result.hasText ? 'ready' : 'none',
      written: result.written,
      totalPages: result.totalPages,
      ...(result.title === null ? {} : { title: result.title }),
      ...(result.author === null ? {} : { author: result.author }),
    });

    return { written: result.written, hasText: result.hasText };
  },
});

/* ── the steps ───────────────────────────────────────────────────────── */

/**
 * What the extraction needs, or why there is nothing to extract.
 *
 * No ownership check here, deliberately: this is `internalQuery`, reachable
 * only from the workflow, and ownership was checked when `attachUpload` or
 * `library.reprocess` started it. The `ownerId` written onto every page comes
 * off this row rather than from any argument.
 */
export const target = internalQuery({
  args: { documentId: v.id('documents') },
  // Three answers rather than a nullable one, because the two ways of having
  // nothing to do want different endings: a deleted document needs no record,
  // and one too large to parse needs a terminal `textStatus` or it is re-driven
  // every night forever.
  returns: v.union(
    v.object({ kind: v.literal('gone') }),
    v.object({ kind: v.literal('too-large') }),
    v.object({
      kind: v.literal('ok'),
      storageKey: v.string(),
      byteSize: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get('documents', args.documentId);
    if (doc === null || doc.storageKey === undefined) {
      return { kind: 'gone' as const };
    }
    if (doc.byteSize > EXTRACT_BYTE_MAX) {
      return { kind: 'too-large' as const };
    }
    return { kind: 'ok' as const, storageKey: doc.storageKey, byteSize: doc.byteSize };
  },
});

export const clearPages = internalMutation({
  args: { documentId: v.id('documents') },
  returns: v.number(),
  handler: async (ctx, args) => {
    return await Processing.deletePages(ctx, args.documentId, PAGE_DELETE_BUDGET);
  },
});

/**
 * Writes one batch of pages and moves the job's counter.
 *
 * Called from inside the extraction action rather than returned through a step,
 * because the workflow component caps a run's total step arguments and returns
 * at 1 MB and a 600-page book's text is far past it. This is the constraint the
 * whole pipeline is shaped around.
 */
export const storePages = internalMutation({
  args: {
    documentId: v.id('documents'),
    pages: v.array(v.object({ page: v.number(), text: v.string() })),
    /** Pages *read* so far, which is what "218 of 499" means to a reader. */
    pagesDone: v.number(),
    pagesTotal: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const written = await Processing.writePages(ctx, args.documentId, args.pages);
    await Processing.updateJob(ctx, args.documentId, {
      status: 'running',
      pagesDone: args.pagesDone,
      pagesTotal: args.pagesTotal,
    });
    return written;
  },
});

/**
 * The terminal write, and the only one that touches `textStatus`.
 *
 * The title and author from the PDF's own metadata fill *gaps* rather than
 * overwrite: the reader typed a title at import, or accepted the filename, and
 * an exporter's idea of the title is not worth replacing a person's with.
 */
export const finalize = internalMutation({
  args: {
    documentId: v.id('documents'),
    outcome: v.union(v.literal('ready'), v.literal('none'), v.literal('failed')),
    written: v.number(),
    totalPages: v.optional(v.number()),
    title: v.optional(v.string()),
    author: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get('documents', args.documentId);
    if (doc === null) {
      return null;
    }

    await ctx.db.patch('documents', doc._id, {
      textStatus: args.outcome,
      // Only when nothing counted the pages before — the device probe is the
      // authority, because it counted them in the viewer that renders them.
      ...(doc.pageCount === undefined && args.totalPages !== undefined
        ? { pageCount: args.totalPages }
        : {}),
      // `author` only when the row has none. The reader's title always wins.
      ...(doc.author === undefined && args.author !== undefined
        ? { author: args.author }
        : {}),
      updatedAt: Date.now(),
    });

    await Processing.updateJob(ctx, args.documentId, {
      status: args.outcome === 'failed' ? 'failed' : 'done',
      pagesDone: args.written,
      ...(args.totalPages === undefined ? {} : { pagesTotal: args.totalPages }),
      ...(args.error === undefined ? {} : { error: args.error }),
    });
    return null;
  },
});

/**
 * The workflow's own completion handler.
 *
 * `finalize` runs as the last step of a successful flow, so this exists for the
 * two outcomes that never reach it: a failure that exhausted its retries, and a
 * cancellation. Without it a document whose parse threw would sit at
 * `extracting` for good, with a job row claiming to be running.
 */
export const onExtractionComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ documentId: v.id('documents') }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.result.kind === 'success') {
      return null;
    }

    // Only for the run the document is still waiting on. A cancelled workflow
    // reports here after its replacement has already started, and without this
    // check the old run's cancellation would mark the new run's job cancelled
    // and leave a live extraction that nothing is watching.
    const current = await ctx.db
      .query('documentJobs')
      .withIndex('by_document', (q) => q.eq('documentId', args.context.documentId))
      .unique();
    if (current === null || current.workflowId !== args.workflowId) {
      return null;
    }

    const doc = await ctx.db.get('documents', args.context.documentId);
    if (doc !== null) {
      await ctx.db.patch('documents', doc._id, {
        textStatus: args.result.kind === 'canceled' ? undefined : 'failed',
        updatedAt: Date.now(),
      });
    }

    await Processing.updateJob(ctx, args.context.documentId, {
      status: args.result.kind === 'canceled' ? 'cancelled' : 'failed',
      // A code, never the thrown message: an error string from pdf.js can carry
      // a fragment of the document, and the client owns the sentence anyway.
      ...(args.result.kind === 'failed' ? { error: 'EXTRACTION_FAILED' } : {}),
    });
    return null;
  },
});

/**
 * A signed URL for an object, minted inside an action.
 *
 * An action rather than a helper because `r2.getUrl` signs with the bucket
 * credentials from the deployment's environment, and an action is where those
 * are reachable. `internalAction`, so a key never reaches it from a client —
 * the only caller is the extraction action, with a key the server minted.
 */
export const signedUrl = internalAction({
  args: { storageKey: v.string() },
  returns: v.string(),
  handler: async (_ctx, args) => {
    // Five minutes, matching `library.downloadUrl`: the fetch begins the moment
    // the URL exists, so the window has no reason to be wider than the act.
    return await r2.getUrl(args.storageKey, { expiresIn: 300 });
  },
});

/* ── starting one ────────────────────────────────────────────────────── */

/**
 * Queues extraction for a document, replacing anything already queued for it.
 *
 * Called from `attachUpload` — the first moment the server can see the file —
 * and from `library.reprocess`. Never public: every caller has already been
 * through `requireUser` and `assertOwner`.
 *
 * A failure to start is swallowed rather than thrown. It is called from the
 * last step of an upload the reader is watching succeed, and losing a whole
 * sync over a queue that is momentarily unavailable would be the wrong trade —
 * the nightly maintenance pass re-drives anything left `queued`.
 */
export async function queueExtraction(
  ctx: MutationCtx,
  documentId: Id<'documents'>,
  ownerId: Id<'users'>,
): Promise<void> {
  try {
    // Whatever was running for this document is replaced, not raced. A reader
    // tapping Reprocess during an extraction, and the nightly re-drive picking
    // up a job that is merely slow, both arrive here — and two live workflows
    // writing pages for one document would interleave a half-cleared table with
    // a fresh run's inserts.
    const existing = await ctx.db
      .query('documentJobs')
      .withIndex('by_document', (q) => q.eq('documentId', documentId))
      .unique();
    if (existing !== null && (existing.status === 'queued' || existing.status === 'running')) {
      // Cancelling stops it starting or retrying; it cannot stop a step already
      // in flight. That step's writes are cleared by the new run's own
      // `clearPages` pass, which is why that pass exists at all.
      await workflow
        .cancel(ctx, existing.workflowId as WorkflowId)
        .catch(() => undefined);
    }

    // `startAsync`, so this returns as soon as the workflow row exists rather
    // than running the first step inside the caller's transaction. The caller
    // is usually `attachUpload`, at the end of an upload the reader is watching
    // finish; a document's text is not worth a second of that.
    const workflowId = await workflow.start(
      ctx,
      internal.workflows.document.extractDocument,
      { documentId },
      {
        onComplete: internal.workflows.document.onExtractionComplete,
        context: { documentId },
        startAsync: true,
      },
    );

    await ctx.db.patch('documents', documentId, {
      textStatus: 'queued',
      updatedAt: Date.now(),
    });
    await Processing.startJob(ctx, documentId, ownerId, workflowId);
  } catch {
    // Swallowed on purpose. This runs at the end of an upload the reader has
    // already watched succeed, and losing a whole 100 MB sync because a queue
    // was momentarily unavailable would be the wrong trade. The row is left
    // saying so, and the nightly re-drive picks it up.
    //
    // The recovery write is itself guarded: if the document went away mid-flight
    // this patch throws, and a throw here would fail the upload after all.
    try {
      await ctx.db.patch('documents', documentId, {
        textStatus: 'failed',
        updatedAt: Date.now(),
      });
    } catch {
      // Nothing left to record it on.
    }
  }
}
