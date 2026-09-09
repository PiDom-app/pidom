import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { DEVICE_TOKENS_PER_USER, PUSH_TOKEN_MAX, SHARE_LIST_LIMIT, invalid } from './limits';
import { type PublicProfile, profileOf } from './discovery';
import { pushNotifications } from './pushClient';
import { notificationsOf } from './settings';

/**
 * Telling somebody something happened.
 *
 * Two layers, and keeping them apart is the point. A **`shareEvents` row** is
 * the fact: it is written in the same transaction as the thing it describes, it
 * is what the in-app inbox reads, and it survives whether or not a phone was
 * reachable. A **push** is one attempt to get a phone to look at it, and it can
 * fail, be muted, be held for quiet hours, or arrive on a device that has since
 * been wiped — none of which should be able to lose the fact.
 *
 * So `record` is called inside the mutation and `dispatch` is scheduled after
 * it. A share is never held up by Expo, and a notification that could not be
 * delivered is still in the inbox when the app is opened.
 *
 * **An event carries no content.** No title, no author, no message text, no
 * annotation. Everything a screen renders comes from an authenticated query at
 * the moment it renders, which means a row here cannot become a copy of a
 * document's details that outlives access to the document — and it means a push
 * body has nothing to accidentally include.
 */

export type EventKind = Doc<'shareEvents'>['kind'];

export type PublicEvent = {
  id: Id<'shareEvents'>;
  kind: EventKind;
  shareId: Id<'documentShares'> | null;
  documentId: Id<'documents'> | null;
  groupId: Id<'groups'> | null;
  actor: PublicProfile | null;
  read: boolean;
  createdAt: number;
};

export const publicEventValidator = v.object({
  id: v.id('shareEvents'),
  kind: v.union(
    v.literal('shareOffered'),
    v.literal('shareAccepted'),
    v.literal('shareDeclined'),
    v.literal('accessRevoked'),
    v.literal('accessChanged'),
    v.literal('groupJoined'),
    v.literal('groupDocumentShared'),
    v.literal('annotationAdded'),
  ),
  shareId: v.union(v.id('documentShares'), v.null()),
  documentId: v.union(v.id('documents'), v.null()),
  groupId: v.union(v.id('groups'), v.null()),
  actor: v.union(
    v.object({
      id: v.id('users'),
      displayName: v.string(),
      handle: v.union(v.string(), v.null()),
      pictureUrl: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  read: v.boolean(),
  createdAt: v.number(),
});

/** Writes the fact. Never sends anything — see the note above. */
export async function record(
  ctx: MutationCtx,
  input: {
    userId: Id<'users'>;
    kind: EventKind;
    actorId?: Id<'users'>;
    shareId?: Id<'documentShares'>;
    documentId?: Id<'documents'>;
    groupId?: Id<'groups'>;
  },
): Promise<Id<'shareEvents'>> {
  return await ctx.db.insert('shareEvents', {
    userId: input.userId,
    kind: input.kind,
    actorId: input.actorId,
    shareId: input.shareId,
    documentId: input.documentId,
    groupId: input.groupId,
    createdAt: Date.now(),
  });
}

/** Which switch on the settings screen governs this kind. */
export function switchFor(kind: EventKind): keyof Awaited<ReturnType<typeof notificationsOf>> {
  switch (kind) {
    case 'shareOffered':
    case 'groupDocumentShared':
      return 'documentShares';
    case 'shareAccepted':
    case 'shareDeclined':
      return 'shareResponses';
    case 'groupJoined':
      return 'groupActivity';
    case 'accessRevoked':
    case 'accessChanged':
      return 'shareResponses';
    case 'annotationAdded':
      return 'annotationActivity';
  }
}

/**
 * Whether this account wants a push for this kind, right now.
 *
 * Three gates in order: the master switch, the per-kind switch, and quiet
 * hours. A `false` here means the push is not attempted — the event is already
 * recorded, so nothing is lost, and the reader sees it the next time they open
 * the app rather than at two in the morning.
 */
export async function wantsPush(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
  kind: EventKind,
  now: number,
  groupId?: Id<'groups'>,
): Promise<boolean> {
  const settings = await notificationsOf(ctx, userId);
  if (!settings.allow) {
    return false;
  }
  if (settings[switchFor(kind)] !== true) {
    return false;
  }
  // **This member's own answer about this group**, which is a narrower question
  // than the account-wide "tell me about group activity" switch above. A reader
  // in a busy group and a quiet one wants to hear about them differently, and
  // the alternative — turning group activity off entirely — silences both.
  if (groupId !== undefined) {
    const membership = await ctx.db
      .query('groupMembers')
      .withIndex('by_group_and_user', (q) => q.eq('groupId', groupId).eq('userId', userId))
      .unique();
    if (membership?.muted === true) {
      return false;
    }
  }
  return !inQuietHours(settings, now);
}

/**
 * Whether `now` falls inside the reader's quiet hours.
 *
 * The window is minutes past local midnight, and the wrapping case is the
 * normal one — 22:00 to 07:00 is `start > end` — so it is handled first rather
 * than as an edge. A device that has never sent its offset is treated as UTC,
 * which is wrong by up to half a day; that is why the offset is sent with the
 * settings write rather than guessed here.
 */
export function inQuietHours(
  settings: { quietStartMinute?: number; quietEndMinute?: number; utcOffsetMinutes?: number },
  now: number,
): boolean {
  const { quietStartMinute: start, quietEndMinute: end } = settings;
  if (start === undefined || end === undefined || start === end) {
    return false;
  }
  const local = new Date(now + (settings.utcOffsetMinutes ?? 0) * 60_000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  return start > end ? minute >= start || minute < end : minute >= start && minute < end;
}

/**
 * The body a locked screen is allowed to show.
 *
 * Generic on purpose, and generated here rather than at the send site so there
 * is one place to audit. A notification renders on a device nobody has unlocked
 * — often face-up on a desk — so it says that something happened and who by,
 * and never what the document is called. The title, the author and the message
 * are behind `sharing.inbox`, which returns only the caller's own shares.
 */
export function bodyFor(
  kind: EventKind,
  actorName: string | null,
): { title: string; body: string } {
  const who = actorName ?? 'Someone';

  // **The person is the title.** Every notification used to be titled "Pidom"
  // with the name buried in the body, so a lock screen showed the app's name
  // eight different ways and the reader had to read a sentence to find out who
  // it was from. A notification is read at a glance and the glance lands on the
  // title, which is where the one piece of information that varies belongs.
  //
  // The body still never names the document. That rule is the whole reason
  // these strings are generated here rather than at the send site: a lock
  // screen is a public surface, and the title of somebody's PDF is not
  // something to put on one. See `docs/security.md`.
  switch (kind) {
    case 'shareOffered':
      return { title: who, body: 'shared a PDF with you' };
    case 'groupDocumentShared':
      return { title: who, body: 'shared a PDF with one of your groups' };
    case 'shareAccepted':
      return { title: who, body: 'accepted a PDF you shared' };
    case 'shareDeclined':
      return { title: who, body: 'declined a PDF you shared' };
    case 'accessRevoked':
      return { title: who, body: 'removed your access to a PDF' };
    case 'accessChanged':
      return { title: who, body: 'changed what you can do with a PDF' };
    case 'groupJoined':
      return { title: who, body: 'added you to a group' };
    case 'annotationAdded':
      return { title: who, body: 'wrote a note on a PDF you shared' };
  }
}

/**
 * Registers or moves a device's push token.
 *
 * Keyed on the token rather than on the device, because the token is what Expo
 * addresses and what can move between accounts: signing in as somebody else on
 * the same phone must re-point the row, not leave the previous account able to
 * notify this handset. That is the one case where an insert would be a leak.
 */
export async function registerDevice(
  ctx: MutationCtx,
  user: Doc<'users'>,
  input: { token: string; platform: 'ios' | 'android'; deviceName?: string; appVersion?: string },
): Promise<Id<'deviceTokens'>> {
  const token = input.token.trim();
  if (token.length === 0 || token.length > PUSH_TOKEN_MAX) {
    invalid('That is not a push token.');
  }
  // Expo's own format. Refused rather than stored, because anything else here
  // is a string this deployment would later POST to a third party.
  if (!/^Expo(nent)?PushToken\[[^\]\s]+\]$/.test(token)) {
    invalid('That is not an Expo push token.');
  }

  const now = Date.now();
  const existing = await ctx.db
    .query('deviceTokens')
    .withIndex('by_token', (q) => q.eq('token', token))
    .unique();

  if (existing !== null) {
    await ctx.db.patch('deviceTokens', existing._id, {
      userId: user._id,
      platform: input.platform,
      deviceName: input.deviceName,
      appVersion: input.appVersion,
      enabled: true,
      lastSeenAt: now,
      failedAt: undefined,
    });
    return existing._id;
  }

  const deviceId = await ctx.db.insert('deviceTokens', {
    userId: user._id,
    token,
    platform: input.platform,
    deviceName: input.deviceName,
    appVersion: input.appVersion,
    enabled: true,
    lastSeenAt: now,
    createdAt: now,
  });

  await trimDevices(ctx, user._id);
  return deviceId;
}

/**
 * Tells the push component about a device, once the row exists.
 *
 * Separate from `registerDevice` so the id it records is one Pidom minted
 * rather than anything a client sent — and so the local row stays the thing
 * that decides which handsets exist. The component is a delivery address book
 * keyed on it, not the other way round.
 */
export async function recordWithComponent(
  ctx: MutationCtx,
  deviceId: Id<'deviceTokens'>,
): Promise<void> {
  const device = await ctx.db.get('deviceTokens', deviceId);
  if (device === null) {
    return;
  }
  await pushNotifications.recordToken(ctx, {
    userId: device._id,
    pushToken: device.token,
  });
}

/**
 * Drops the least recently seen device once an account has too many.
 *
 * An account that keeps accumulating tokens is an account whose old ones are
 * not being retired by the receipt poll — a reinstall mints a new token and the
 * old one only reports `DeviceNotRegistered` when something is sent to it. This
 * bounds that without waiting.
 */
async function trimDevices(ctx: MutationCtx, userId: Id<'users'>): Promise<void> {
  const devices = await ctx.db
    .query('deviceTokens')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .take(DEVICE_TOKENS_PER_USER * 2);
  if (devices.length <= DEVICE_TOKENS_PER_USER) {
    return;
  }
  const oldestFirst = [...devices].sort((a, b) => a.lastSeenAt - b.lastSeenAt);
  for (const device of oldestFirst.slice(0, devices.length - DEVICE_TOKENS_PER_USER)) {
    await forgetDevice(ctx, device._id);
  }
}

/**
 * Deletes a token, the delivery rows that named it, and its row in the push
 * component.
 *
 * All three. The component addresses handsets by this row's id, so a
 * `deviceTokens` row dropped without `removeToken` leaves it holding a token
 * for a device Pidom no longer believes in — and it goes on accepting sends
 * to it.
 */
export async function forgetDevice(ctx: MutationCtx, tokenId: Id<'deviceTokens'>): Promise<void> {
  const deliveries = await ctx.db
    .query('pushDeliveries')
    .withIndex('by_token', (q) => q.eq('tokenId', tokenId))
    .take(SHARE_LIST_LIMIT);
  for (const delivery of deliveries) {
    await ctx.db.delete('pushDeliveries', delivery._id);
  }
  await pushNotifications.removeToken(ctx, { userId: tokenId });
  await ctx.db.delete('deviceTokens', tokenId);
}

/** Every live token for one recipient. */
export async function devicesOf(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
): Promise<Doc<'deviceTokens'>[]> {
  const devices = await ctx.db
    .query('deviceTokens')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .take(DEVICE_TOKENS_PER_USER);
  return devices.filter((device) => device.enabled && device.failedAt === undefined);
}

export async function toPublicEvent(
  ctx: QueryCtx | MutationCtx,
  event: Doc<'shareEvents'>,
): Promise<PublicEvent> {
  return {
    id: event._id,
    kind: event.kind,
    shareId: event.shareId ?? null,
    documentId: event.documentId ?? null,
    groupId: event.groupId ?? null,
    actor: event.actorId === undefined ? null : await profileOf(ctx, event.actorId),
    read: event.readAt !== undefined,
    createdAt: event.createdAt,
  };
}
