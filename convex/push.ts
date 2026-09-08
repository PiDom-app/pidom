import { Workpool } from '@convex-dev/workpool';
import { v } from 'convex/values';

import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from './_generated/server';
import { profileOf } from './model/discovery';
import { PUSH_BATCH, PUSH_RECEIPT_BATCH, PUSH_RECEIPT_DELAY_MS } from './model/limits';
import * as Notifications from './model/notifications';

/**
 * Getting a phone to look at something that already happened.
 *
 * The fact is written first, inside the mutation, as a `shareEvents` row. This
 * file is the attempt to draw attention to it, and every part of it is allowed
 * to fail without losing anything: a muted account, a device that was wiped, a
 * quiet hour, Expo being down. The inbox is still right.
 *
 * **A body says nothing about the document.** "Amina shared a PDF with you" and
 * no title, no author, no message — a notification renders on a locked screen,
 * often face-up on a desk, and the reader has not proved they are the reader.
 * `Notifications.bodyFor` is the one place those strings are written so there
 * is one place to audit them. The payload carries `{ kind, shareId }`, which
 * are identifiers the app trades for content through an authenticated query.
 *
 * **A send is two steps.** Expo answers with a ticket, and whether the thing
 * arrived is only knowable from a receipt fetched later. So `deliver` records
 * tickets and schedules `collectReceipts`, and a `DeviceNotRegistered` receipt
 * is what finally deletes a dead token. Without that second half a reinstalled
 * phone accumulates tokens nobody ever retires.
 */

/**
 * Its own pool, at four.
 *
 * The free plan allows 20 across the deployment; the workflow's takes 4 and
 * `maintenance` takes 2. Four here is a group share to two hundred people
 * moving in batches of a hundred while somebody else's share of one goes out
 * beside it, rather than behind it.
 *
 * Retried, because every failure this pool sees is a network one — Expo
 * refusing, a socket dying mid-POST. A malformed payload is refused before it
 * gets here, in `Notifications.registerDevice`.
 */
export const notifications = new Workpool(components.notifications, {
  maxParallelism: 4,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 15_000, base: 2 },
});

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPT_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/**
 * Queues one event for delivery.
 *
 * Called from the mutation that recorded the event, and it does two things
 * only: puts a job on the pool and returns. The mutation commits; the network
 * happens afterwards, on somebody else's time.
 */
export async function dispatch(
  ctx: MutationCtx,
  eventId: Id<'shareEvents'>,
): Promise<void> {
  await notifications.enqueueAction(ctx, internal.push.deliver, { eventId });
}

/**
 * Everything `deliver` needs, resolved server-side.
 *
 * A query rather than arguments, because the action must not be handed a token
 * — an action's arguments are logged, and a push token identifies a handset to
 * a third party. It reads the settings gate here too, so a muted account costs
 * one query and no request at all.
 */
export const target = internalQuery({
  args: { eventId: v.id('shareEvents') },
  returns: v.union(
    v.null(),
    v.object({
      title: v.string(),
      body: v.string(),
      data: v.object({
        kind: v.string(),
        shareId: v.union(v.string(), v.null()),
      }),
      devices: v.array(v.object({ tokenId: v.id('deviceTokens'), token: v.string() })),
      userId: v.id('users'),
    }),
  ),
  handler: async (ctx, args) => {
    const event = await ctx.db.get('shareEvents', args.eventId);
    if (event === null) {
      return null;
    }
    if (!(await Notifications.wantsPush(ctx, event.userId, event.kind, Date.now()))) {
      return null;
    }

    const devices = await Notifications.devicesOf(ctx, event.userId);
    if (devices.length === 0) {
      return null;
    }

    const actor = event.actorId === undefined ? null : await profileOf(ctx, event.actorId);
    const { title, body } = Notifications.bodyFor(event.kind, actor?.displayName ?? null);

    return {
      title,
      body,
      data: { kind: event.kind, shareId: event.shareId ?? null },
      devices: devices.map((device) => ({ tokenId: device._id, token: device.token })),
      userId: event.userId,
    };
  },
});

type Ticket = { status: 'ok'; id: string } | { status: 'error'; message?: string; details?: { error?: string } };

/**
 * POSTs one event to every device the recipient has.
 *
 * A plain action rather than a `"use node"` one: this is a `fetch` and a JSON
 * body, and nothing here wants a Node builtin. Keeping it in the Convex runtime
 * means it starts in milliseconds instead of cold-starting a Node isolate for
 * every notification.
 *
 * Batched at a hundred, which is Expo's own cap on a single request — and the
 * reason a group share does not become two hundred requests and walk into the
 * project-wide ceiling of 600 notifications a second.
 */
export const deliver = internalAction({
  args: { eventId: v.id('shareEvents') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internal.push.target, { eventId: args.eventId });
    if (target === null) {
      return null;
    }

    for (let i = 0; i < target.devices.length; i += PUSH_BATCH) {
      const batch = target.devices.slice(i, i + PUSH_BATCH);
      const messages = batch.map((device) => ({
        to: device.token,
        title: target.title,
        body: target.body,
        data: target.data,
        sound: 'default' as const,
        // Android needs a channel that the client created at registration.
        channelId: 'shares',
        priority: 'default' as const,
        // A day. Past that the reader has opened the app and read the inbox,
        // and a notification about it is noise.
        ttl: 24 * 60 * 60,
      }));

      const response = await fetch(SEND_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(messages),
      });

      if (!response.ok) {
        // Thrown, so the pool retries with backoff. A 4xx from Expo is almost
        // always a malformed body and will not get better, but distinguishing
        // that from a 502 by status code is guesswork; three attempts is cheap.
        throw new Error(`expo push responded ${response.status}`);
      }

      const payload = (await response.json()) as { data?: Ticket[] };
      const tickets = payload.data ?? [];

      await ctx.runMutation(internal.push.recordTickets, {
        eventId: args.eventId,
        userId: target.userId,
        results: batch.map((device, index) => {
          const ticket = tickets[index];
          return {
            tokenId: device.tokenId,
            ticketId: ticket?.status === 'ok' ? ticket.id : undefined,
            error: ticket?.status === 'error' ? (ticket.details?.error ?? 'Unknown') : undefined,
          };
        }),
      });
    }

    return null;
  },
});

/**
 * Writes down what Expo said, and schedules the second half.
 *
 * A ticket that already came back `DeviceNotRegistered` retires its token here
 * rather than waiting for a receipt — Expo reports it either way, and there is
 * no reason to keep sending to a handset that has told us twice.
 */
export const recordTickets = internalMutation({
  args: {
    eventId: v.id('shareEvents'),
    userId: v.id('users'),
    results: v.array(
      v.object({
        tokenId: v.id('deviceTokens'),
        ticketId: v.optional(v.string()),
        error: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    let anyPending = false;

    for (const result of args.results) {
      if (result.error === 'DeviceNotRegistered') {
        await Notifications.forgetDevice(ctx, result.tokenId);
        continue;
      }
      await ctx.db.insert('pushDeliveries', {
        eventId: args.eventId,
        userId: args.userId,
        tokenId: result.tokenId,
        ticketId: result.ticketId,
        status: result.error === undefined ? 'sent' : 'failed',
        error: result.error,
        sentAt: now,
      });
      if (result.error === undefined && result.ticketId !== undefined) {
        anyPending = true;
      }
    }

    if (anyPending) {
      await ctx.scheduler.runAfter(PUSH_RECEIPT_DELAY_MS, internal.push.collectReceipts, {});
    }
    return null;
  },
});

/** Tickets old enough to have a receipt. Oldest first, bounded per run. */
export const dueReceipts = internalQuery({
  args: {},
  returns: v.array(v.object({ id: v.id('pushDeliveries'), ticketId: v.string() })),
  handler: async (ctx) => {
    const cutoff = Date.now() - PUSH_RECEIPT_DELAY_MS;
    const sent = await ctx.db
      .query('pushDeliveries')
      .withIndex('by_status_and_sent', (q) => q.eq('status', 'sent').lte('sentAt', cutoff))
      .take(PUSH_RECEIPT_BATCH);
    return sent
      .filter((row): row is Doc<'pushDeliveries'> & { ticketId: string } => row.ticketId !== undefined)
      .map((row) => ({ id: row._id, ticketId: row.ticketId }));
  },
});

/**
 * Asks Expo whether the notifications it accepted actually arrived.
 *
 * This is the only thing that ever retires a dead token, so it is the
 * difference between an account that accumulates handsets forever and one that
 * does not. It reschedules itself while there is a backlog rather than looping,
 * which keeps each run inside an action's budget.
 */
export const collectReceipts = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const due = await ctx.runQuery(internal.push.dueReceipts, {});
    if (due.length === 0) {
      return null;
    }

    const response = await fetch(RECEIPT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ids: due.map((row) => row.ticketId) }),
    });
    if (!response.ok) {
      throw new Error(`expo receipts responded ${response.status}`);
    }

    const payload = (await response.json()) as {
      data?: Record<string, { status: string; details?: { error?: string } }>;
    };
    const receipts = payload.data ?? {};

    await ctx.runMutation(internal.push.applyReceipts, {
      results: due.map((row) => {
        const receipt = receipts[row.ticketId];
        return {
          id: row.id,
          delivered: receipt?.status === 'ok',
          error: receipt?.details?.error,
          // A ticket with no receipt yet stays `sent` and is picked up next
          // time rather than being called a failure.
          answered: receipt !== undefined,
        };
      }),
    });

    if (due.length === PUSH_RECEIPT_BATCH) {
      await ctx.scheduler.runAfter(0, internal.push.collectReceipts, {});
    }
    return null;
  },
});

export const applyReceipts = internalMutation({
  args: {
    results: v.array(
      v.object({
        id: v.id('pushDeliveries'),
        delivered: v.boolean(),
        error: v.optional(v.string()),
        answered: v.boolean(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const result of args.results) {
      if (!result.answered) {
        continue;
      }
      const delivery = await ctx.db.get('pushDeliveries', result.id);
      if (delivery === null) {
        continue;
      }
      await ctx.db.patch('pushDeliveries', result.id, {
        status: result.delivered ? 'delivered' : 'failed',
        error: result.error,
        receiptAt: now,
      });
      if (result.error === 'DeviceNotRegistered') {
        await Notifications.forgetDevice(ctx, delivery.tokenId);
      }
    }
    return null;
  },
});

/**
 * Drops delivery rows nobody will read again.
 *
 * They exist to connect a ticket to a receipt, and once that has happened they
 * are a log. The nightly cron runs this; without it the table grows by one row
 * per notification per device, forever.
 */
export const pruneDeliveries = internalMutation({
  args: { olderThanMs: v.number(), limit: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.olderThanMs;
    let dropped = 0;

    for (const status of ['delivered', 'failed'] as const) {
      const rows = await ctx.db
        .query('pushDeliveries')
        .withIndex('by_status_and_sent', (q) => q.eq('status', status).lte('sentAt', cutoff))
        .take(args.limit - dropped);
      for (const row of rows) {
        await ctx.db.delete('pushDeliveries', row._id);
        dropped += 1;
      }
      if (dropped >= args.limit) {
        break;
      }
    }
    return dropped;
  },
});
