import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import {
  createThread,
  listMessages,
  saveMessage,
  syncStreams,
  vStreamArgs,
  vStreamMessagesReturnValue,
} from '@convex-dev/agent';

import { components, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { requireUser } from './model/auth';
import * as Ai from './model/ai';
import { agent, languageModelFor } from './model/agent';
import {
  AI_PROMPT_MAX,
  AI_THREAD_SWEEP,
  AI_THREADS_PER_USER,
  cleanText,
  invalid,
} from './model/limits';
import { limit } from './model/rateLimits';

/**
 * Ask, from the account's side.
 *
 * **None of the Agent component's own functions is reachable from a client.**
 * Every one of these wraps one — `requireUser`, then an access check, then a
 * rate limit, then one call into the component — which is the pattern
 * `./r2.ts` and `./presence.ts` already hold to and which
 * `_generated/ai/guidelines.md` requires: *perform authentication and
 * authorization in the app functions before calling into a component.*
 *
 * **The client sends page numbers, never text.** `ask` takes a document id and
 * a handful of integers the device's own index chose; `model/ai.ts:contextFor`
 * reads those pages back out of `documentPages` after the same check the reader
 * passed. So the words the model sees are the words this deployment holds, a
 * client cannot attribute invented text to a book, and the wire carries
 * integers instead of a chapter.
 *
 * **A generation is scheduled, not awaited.** `ask` saves the question in a
 * mutation and schedules `respond`, which is what lets the sheet render the
 * question optimistically and the answer stream in. The alternative — an action
 * that does both — would lose the question if the generation failed, and would
 * make a retry post it twice.
 */

/* ── Threads ──────────────────────────────────────────────────────────────── */

/**
 * Deletes one conversation, both halves, and does not let either stop a sweep.
 *
 * `agent.deleteThreadAsync` throws for a thread the component does not have —
 * an id it refuses to parse, a thread already deleted, a restore that brought
 * back `aiThreads` without the component's tables. That throw is a nested
 * mutation's, so it rolls back only the component's own writes and this
 * function can carry on.
 *
 * **It has to carry on.** Both callers walk a page of rows in one transaction,
 * and `expireThreads` is the nightly retention: without this, a single orphaned
 * row at the front of `by_expiry` would abort every pass, forever, and
 * "conversations are deleted after a month" would quietly stop being true for
 * the whole deployment. The row goes either way, because the row is the thing
 * that says the conversation exists.
 */
async function forget(ctx: MutationCtx, row: Doc<'aiThreads'>): Promise<void> {
  try {
    await agent.deleteThreadAsync(ctx, { threadId: row.threadId });
  } catch (error) {
    // The id, never the title and never a message. A thread id is a random
    // string; the rest is the reader's own words about their own document.
    console.error(`could not delete agent thread ${row.threadId}`, error);
  }
  await ctx.db.delete('aiThreads', row._id);
}

export const startThread = mutation({
  args: {
    documentId: v.optional(v.id('documents')),
    /** The first question, used for a title. Not sent to the model from here. */
    title: v.optional(v.string()),
  },
  returns: v.object({ threadId: v.string() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'aiThread');

    const document = await Ai.mayAsk(ctx, user, args.documentId);

    /**
     * Bounded for the reason `SHARES_PER_OWNER` is: an unbounded per-account
     * collection is an unbounded read on the screen that lists it.
     *
     * Expired rows are excluded, and the filter is the point — the nightly
     * sweep is what removes them, so between a thread expiring and the sweep
     * running it is invisible to the reader and would otherwise still count
     * against them. `AI_THREAD_SWEEP` of headroom on the read covers a day's
     * worth of expiries without making this an unbounded scan.
     */
    const now = Date.now();
    const recent = await ctx.db
      .query('aiThreads')
      .withIndex('by_user_and_last', (q) => q.eq('userId', user._id))
      .take(AI_THREADS_PER_USER + AI_THREAD_SWEEP);
    if (recent.filter((thread) => thread.expiresAt > now).length >= AI_THREADS_PER_USER) {
      throw new ConvexError({ code: Ai.AskError.tooMany });
    }

    const settings = await Ai.aiOf(ctx, user._id);
    const title = Ai.titleFrom(args.title, document?.title);

    const threadId = await createThread(ctx, components.agent, {
      userId: user._id,
      title,
    });

    await ctx.db.insert('aiThreads', {
      userId: user._id,
      threadId,
      ...(args.documentId === undefined ? {} : { documentId: args.documentId }),
      title,
      createdAt: now,
      expiresAt: now + Ai.clampRetentionDays(settings.retentionDays) * 24 * 60 * 60 * 1000,
      lastMessageAt: now,
    });

    return { threadId };
  },
});

/**
 * The conversations about a document, or across the library.
 *
 * `now` is an argument rather than a `Date.now()` in the handler, and that is
 * not style: `_generated/ai/guidelines.md` forbids reading the wall clock in a
 * query, because a query is not re-run because time advanced. A cutoff computed
 * here would freeze at whatever it was when the subscription opened, and an
 * expired conversation would sit on the list until something else changed.
 */
export const threads = query({
  args: {
    documentId: v.optional(v.id('documents')),
    now: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(Ai.aiThreadValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const page =
      args.documentId === undefined
        ? await ctx.db
            .query('aiThreads')
            .withIndex('by_user_and_last', (q) => q.eq('userId', user._id))
            .order('desc')
            .paginate(args.paginationOpts)
        : await ctx.db
            .query('aiThreads')
            .withIndex('by_user_and_document', (q) =>
              q.eq('userId', user._id).eq('documentId', args.documentId),
            )
            .order('desc')
            .paginate(args.paginationOpts);

    return {
      ...page,
      page: page.page
        .filter((row) => row.expiresAt > args.now)
        .map((row) => Ai.toPublicThread(row)),
    };
  },
});

export const deleteThread = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const row = await Ai.requireThread(ctx, user, args.threadId);

    // Async rather than sync: the component schedules its own continuations, so
    // a thread with two hundred messages does not have to fit in this
    // mutation's budget and the reader's tap returns immediately.
    await forget(ctx, row);
    return null;
  },
});

/* ── Messages ─────────────────────────────────────────────────────────────── */

/**
 * The conversation, and whatever of it is still arriving.
 *
 * Two halves in one subscription. `listMessages` is the durable history, paged
 * the way every other list in this backend is; `syncStreams` is the deltas of
 * an answer being written right now. The client merges them, which is why the
 * sheet fills in a word at a time without an SSE connection, a long-lived HTTP
 * request, or anything React Native handles differently from a list of
 * bookmarks.
 *
 * `vMessageDoc` rather than a UI-message validator, because the component
 * exports one and not the other. The client calls `toUIMessages` on the result,
 * which is the shape its own hooks document.
 */
export const messages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: v.optional(vStreamArgs),
  },
  // The component's own validator for exactly this pair — a page of messages
  // with an optional block of deltas beside it. Not a hand-written composition
  // of the two: `settings.ts` carries the scar from the time a hand-written
  // copy of a validator fell behind the thing it described and took every
  // settings screen down with it.
  returns: vStreamMessagesReturnValue,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await Ai.requireThread(ctx, user, args.threadId);

    const paginated = await listMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, args);
    return { ...paginated, streams };
  },
});

/**
 * Asks a question.
 *
 * Saves the question, then schedules the answer. The mutation returns the
 * message id so `optimisticallySendMessage` on the client has something to key
 * on — which is what makes the question appear the instant it is sent rather
 * than after a round trip through a model.
 */
export const ask = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    /** The pages the device's own index chose. Integers, never text. */
    pages: v.array(v.number()),
  },
  returns: v.object({ messageId: v.string() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const row = await Ai.requireThread(ctx, user, args.threadId);
    await limit(ctx, user, 'aiMessage');

    /**
     * Re-asked on every question rather than once when the thread was made, so
     * a reader who turns Ask off — or an owner who withdraws it on a shared
     * book — stops the next question in an existing conversation as well as the
     * next conversation.
     *
     * **The document is the thread's, and is not an argument.** It used to be
     * one, optional, defaulting to the thread's — and the check then ran
     * against the value the caller sent while `respond` read pages from the
     * thread's. The two could differ: a recipient could pass a document they
     * own, pass the check on that, and have the pages read from the shared one
     * whose owner had since said no. `contextFor` re-checks at the point of the
     * read and would have refused it, so nothing leaked — but a check that
     * guards a different value from the one it appears to guard is a check
     * nobody can review. The argument is gone rather than validated.
     */
    await Ai.mayAsk(ctx, user, row.documentId);

    const prompt = cleanText(args.prompt, AI_PROMPT_MAX, 'prompt');
    if (prompt.length === 0) {
      invalid('a question with nothing in it');
    }
    if (args.pages.some((page) => !Number.isInteger(page) || page < 1)) {
      invalid('a page that is not a page');
    }

    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      userId: user._id,
      prompt,
    });

    await ctx.db.patch('aiThreads', row._id, { lastMessageAt: Date.now() });

    await ctx.scheduler.runAfter(0, internal.ai.respond, {
      threadId: args.threadId,
      promptMessageId: messageId,
      userId: user._id,
      ...(row.documentId === undefined ? {} : { documentId: row.documentId }),
      pages: args.pages,
    });

    return { messageId };
  },
});

/* ── The generation ───────────────────────────────────────────────────────── */

/**
 * Reads back what a question is allowed to carry.
 *
 * An internal query rather than a read inside the action, because an action has
 * no `ctx.db`. The access check runs again here even though `ask` already made
 * it: this is scheduled work, the two are separated by a scheduler, and a check
 * that happened in a different transaction is a check that may no longer hold.
 */
export const contextFor = internalQuery({
  args: {
    userId: v.id('users'),
    documentId: v.optional(v.id('documents')),
    pages: v.array(v.number()),
  },
  returns: v.object({
    title: v.string(),
    model: v.string(),
    pages: v.array(v.object({ page: v.number(), text: v.string() })),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.db.get('users', args.userId);
    if (user === null) {
      throw new ConvexError({ code: 'FORBIDDEN' });
    }
    const settings = await Ai.aiOf(ctx, user._id);
    const document = await Ai.mayAsk(ctx, user, args.documentId);

    return {
      title: document?.title ?? 'your library',
      model: settings.model,
      pages:
        args.documentId === undefined || document === null
          ? []
          : await Ai.contextFor(ctx, args.documentId, args.pages, settings.contextPages),
    };
  },
});

/**
 * Writes the answer.
 *
 * `saveStreamDeltas` is what makes the sheet fill in a word at a time: the
 * deltas land in the component's own tables and reach the device as an ordinary
 * Convex query subscription, so there is no SSE, no long-lived HTTP request,
 * and nothing about it that React Native handles differently from a list of
 * bookmarks.
 */
export const respond = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    userId: v.id('users'),
    documentId: v.optional(v.id('documents')),
    pages: v.array(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const context = await ctx.runQuery(internal.ai.contextFor, {
      userId: args.userId,
      ...(args.documentId === undefined ? {} : { documentId: args.documentId }),
      pages: args.pages,
    });

    await agent.streamText(
      ctx,
      { threadId: args.threadId, userId: args.userId },
      {
        promptMessageId: args.promptMessageId,
        model: languageModelFor(context.model),
        messages:
          context.pages.length === 0
            ? []
            : [{ role: 'user' as const, content: Ai.fencedPages(context.title, context.pages) }],
      },
      { saveStreamDeltas: true },
    );

    return null;
  },
});

/* ── Retention ────────────────────────────────────────────────────────────── */

/**
 * Deletes conversations whose month is up.
 *
 * Enqueued by the nightly cron. `by_expiry` with an inequality, bounded by
 * `AI_THREAD_SWEEP`, and each row's thread is deleted asynchronously — the
 * component schedules its own continuations, so this mutation spends a
 * scheduling budget rather than a read budget and a conversation with two
 * hundred messages does not have to fit in one transaction.
 *
 * The filter on `threads` is what makes the deletion invisible; this is what
 * makes it true. `expireShares` is the same pair for the same reason.
 */
export const expireThreads = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const due = await ctx.db
      .query('aiThreads')
      .withIndex('by_expiry', (q) => q.lt('expiresAt', Date.now()))
      .take(AI_THREAD_SWEEP);

    for (const row of due) {
      await forget(ctx, row);
    }
    return due.length;
  },
});

/**
 * Every conversation an account has, deleted.
 *
 * Called by the account-deletion phase and by the settings screen's last row.
 * Returns whether there is more to do, so both callers can loop — the deletion
 * workflow reschedules itself and the screen can say how it is going.
 */
export const forgetThreads = internalMutation({
  args: { userId: v.id('users') },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    const rows = await ctx.db
      .query('aiThreads')
      .withIndex('by_user_and_last', (q) => q.eq('userId', args.userId))
      .take(AI_THREAD_SWEEP);

    for (const row of rows) {
      await forget(ctx, row);
    }

    // A full page means there may be more, so it reschedules itself — the
    // pattern `account.ts:step` uses, and the reason it uses it: a mutation has
    // a one-second budget, and an account with three hundred conversations is
    // past it. The first version of this returned "is there more" to a caller
    // that never looped, so "Delete all conversations" deleted fifty and
    // stopped without saying so.
    if (rows.length === AI_THREAD_SWEEP) {
      await ctx.scheduler.runAfter(0, internal.ai.forgetThreads, { userId: args.userId });
    }
    return rows.length;
  },
});

/** The reader-facing half of the row above. */
export const deleteEveryThread = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'aiThread');
    await ctx.scheduler.runAfter(0, internal.ai.forgetThreads, { userId: user._id });
    return null;
  },
});
