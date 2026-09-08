import { Workpool } from '@convex-dev/workpool';
import { v } from 'convex/values';

import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalAction, internalMutation, internalQuery, type MutationCtx } from './_generated/server';
import { profileOf } from './model/discovery';
import { PUSH_RECEIPT_BATCH, PUSH_RECEIPT_DELAY_MS } from './model/limits';
import * as Notifications from './model/notifications';
import { pushNotifications } from './model/pushClient';

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
 * ## Half the component's, half Pidom's, and the seam is deliberate
 *
 * `@convex-dev/expo-push-notifications` owns **sending**: batching to Expo's
 * documented cap of a hundred messages a request, its own workpool, exponential
 * backoff on a failed request, and `needs_retry` for the one ticket error Expo
 * documents as temporary. That is around two hundred lines this file used to
 * carry by hand.
 *
 * It does not own two things, and both matter here.
 *
 * **It is one token per key.** `recordToken` patches the row it finds and
 * `sendPushNotification` reads it back with `.unique()`, so keyed on an account
 * a reader with a phone and a tablet would be notified on whichever registered
 * last. What is recorded is therefore the **device's** id — see
 * `./model/pushClient.ts`.
 *
 * **It never fetches receipts.** Its Expo client calls `/push/send` and stops;
 * `getReceipts` appears nowhere in it, and `DeviceNotRegistered` is treated as
 * a terminal failure of one message rather than a fact about a handset. Expo's
 * own documentation is explicit that a dead token is reported in a receipt,
 * roughly fifteen minutes later. So the poll below stays, and it is the only
 * thing in the system that ever retires a token.
 */

const RECEIPT_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/**
 * The pool the receipt poll runs on.
 *
 * Two at a time. Fetching a receipt is an independent, unordered, idempotent
 * request against a third party — a pool rather than a flow, which is the
 * argument `maintenance` already makes — and a group share to two hundred
 * people leaves two hundred of them due at the same moment. Scheduling them
 * bare would put that burst straight at Expo.
 *
 * Not on the workflow's pool, so a backlog of receipts cannot sit in front of a
 * reader's extraction. The free plan allows 20 across the deployment: workflow
 * takes 4, `maintenance` 2, this 2, and the push component brings its own.
 */
export const receipts = new Workpool(components.receipts, {
  maxParallelism: 2,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 30_000, base: 2 },
});

/**
 * Queues one event for delivery, to every device the recipient has.
 *
 * Called from the mutation that recorded the event. It resolves the recipient's
 * devices and hands the component a batch; the component commits its own rows
 * and schedules its own send, so the caller is not waiting on a third party.
 *
 * `allowUnregisteredTokens` is true because a device Pidom knows about and the
 * component does not is an ordinary state — a row registered before the
 * component was mounted, or one whose `recordToken` failed. Throwing on it
 * would fail the share rather than the notification.
 */
export async function dispatch(ctx: MutationCtx, eventId: Id<'shareEvents'>): Promise<void> {
  const event = await ctx.db.get('shareEvents', eventId);
  if (event === null) {
    return;
  }
  // The event carries the group it is about when it is about one, so a member
  // who muted that group is skipped without touching their account-wide switch.
  if (
    !(await Notifications.wantsPush(ctx, event.userId, event.kind, Date.now(), event.groupId))
  ) {
    return;
  }

  const devices = await Notifications.devicesOf(ctx, event.userId);
  if (devices.length === 0) {
    return;
  }

  const actor = event.actorId === undefined ? null : await profileOf(ctx, event.actorId);
  const { title, body } = Notifications.bodyFor(event.kind, actor?.displayName ?? null);

  const notification = {
    title,
    body,
    // **The avatar cannot ride along, and that is the component's limit rather
    // than a choice.** Expo's push API takes `richContent: { image }`, which
    // Android renders as the thumbnail in the corner of a notification — an
    // avatar, exactly. `@convex-dev/expo-push-notifications` 0.3.1 validates
    // the message against its own `notificationFields`, which has no such key,
    // so passing one is rejected before it leaves. The day the component
    // carries it, this is the line that changes.
    //
    // What is here instead: the sender's name as the title, the event as the
    // body, and the group in `data` so a tap lands on the right screen.
    data: {
      kind: event.kind,
      shareId: event.shareId ?? null,
      groupId: event.groupId ?? null,
    },
    sound: 'default' as const,
    // Android silently drops a notification sent to a channel that does not
    // exist, and this is the one `register.ts` creates.
    channelId: 'shares',
    priority: 'default' as const,
    // A day. Past that the reader has opened the app and read the inbox, and a
    // notification about it is noise.
    ttl: 24 * 60 * 60,
  };

  const sent = await pushNotifications.sendPushNotificationBatch(ctx, {
    notifications: devices.map((device) => ({ userId: device._id, notification })),
    allowUnregisteredTokens: true,
  });

  // One delivery row per device, holding the component's id for the send. It is
  // what the poll walks: the component tracks its own state and has no receipt
  // path, so this is the record Pidom needs in order to ask Expo whether the
  // thing arrived.
  const ids: unknown[] = Array.isArray(sent) ? sent : [];
  const now = Date.now();
  let pending = false;

  for (const [index, device] of devices.entries()) {
    const id = ids[index];
    if (id === null || id === undefined) {
      continue;
    }
    await ctx.db.insert('pushDeliveries', {
      eventId,
      userId: event.userId,
      tokenId: device._id,
      ticketId: String(id),
      status: 'sent',
      sentAt: now,
    });
    pending = true;
  }

  if (pending) {
    await receipts.enqueueAction(ctx, internal.push.collectReceipts, {}, {
      runAfter: PUSH_RECEIPT_DELAY_MS,
    });
  }
}

/**
 * Sends old enough to have a receipt.
 *
 * The component's own id is not an Expo ticket, so the ticket has to be read
 * back off its notification row before Expo can be asked about it. Oldest
 * first, bounded per run.
 */
export const dueReceipts = internalQuery({
  args: {},
  returns: v.array(v.object({ id: v.id('pushDeliveries'), notificationId: v.string() })),
  handler: async (ctx) => {
    const cutoff = Date.now() - PUSH_RECEIPT_DELAY_MS;
    const sent = await ctx.db
      .query('pushDeliveries')
      .withIndex('by_status_and_sent', (q) => q.eq('status', 'sent').lte('sentAt', cutoff))
      .take(PUSH_RECEIPT_BATCH);

    return sent
      .filter(
        (row): row is Doc<'pushDeliveries'> & { ticketId: string } => row.ticketId !== undefined,
      )
      .map((row) => ({ id: row._id, notificationId: row.ticketId }));
  },
});

/** The Expo ticket behind one of the component's notification rows, if it has one. */
export const ticketOf = internalQuery({
  args: { notificationId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const row = await pushNotifications.getNotification(ctx, { id: args.notificationId });
    const ticket = (row as { ticketId?: string | null } | null)?.ticketId;
    return typeof ticket === 'string' && ticket !== '' ? ticket : null;
  },
});

/**
 * Asks Expo whether the notifications it accepted actually arrived.
 *
 * **The only thing that ever retires a dead token**, and the reason this file
 * did not disappear entirely into the component. Expo reports
 * `DeviceNotRegistered` in a receipt rather than in the ticket, so a wiped
 * installation is invisible until roughly fifteen minutes after something was
 * sent to it. Without this, an account accumulates handsets forever and every
 * later send to them is wasted.
 */
export const collectReceipts = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const due = await ctx.runQuery(internal.push.dueReceipts, {});
    if (due.length === 0) {
      return null;
    }

    // A delivery whose ticket cannot be resolved is dropped rather than retried
    // forever — it is a send the component never completed, which its own retry
    // owns.
    const resolved: { id: Id<'pushDeliveries'>; ticketId: string }[] = [];
    for (const row of due) {
      const ticketId = await ctx.runQuery(internal.push.ticketOf, {
        notificationId: row.notificationId,
      });
      if (ticketId !== null) {
        resolved.push({ id: row.id, ticketId });
      }
    }
    if (resolved.length === 0) {
      return null;
    }

    const response = await fetch(RECEIPT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ids: resolved.map((row) => row.ticketId) }),
    });
    if (!response.ok) {
      throw new Error(`expo receipts responded ${response.status}`);
    }

    const payload = (await response.json()) as {
      data?: Record<string, { status: string; details?: { error?: string } }>;
    };
    const answers = payload.data ?? {};

    await ctx.runMutation(internal.push.applyReceipts, {
      results: resolved.map((row) => {
        const receipt = answers[row.ticketId];
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
      await ctx.runMutation(internal.push.pollAgain, {});
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
        // Marked before it is dropped, so the state `deviceTokens.failedAt`
        // describes actually occurs — it used to be a column nothing wrote.
        // The row goes on the same pass; the mark is for anything reading the
        // token between this patch and the delete.
        await ctx.db.patch('deviceTokens', delivery.tokenId, { failedAt: now });
        await Notifications.forgetDevice(ctx, delivery.tokenId);
      }
    }
    return null;
  },
});

/** Queues the next page of receipts, on the pool rather than bare. */
export const pollAgain = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await receipts.enqueueAction(ctx, internal.push.collectReceipts, {});
    return null;
  },
});

/**
 * Drops delivery rows nobody will read again.
 *
 * They exist to connect a send to a receipt, and once that has happened they
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
