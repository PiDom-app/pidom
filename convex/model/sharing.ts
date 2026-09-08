import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { AuthError } from './auth';
import {
  clampToCeiling,
  refuseIfExpired,
  requireAddressed,
  requireAdministrable,
  requireResharable,
} from './access';
import { type PublicProfile, profileOf } from './discovery';
import * as Groups from './groups';
import {
  ANNOTATIONS_PER_DOCUMENT,
  SHARES_PER_DOCUMENT,
  SHARES_PER_OWNER,
  SHARE_LIST_LIMIT,
  SHARE_MESSAGE_MAX,
  cleanOptionalText,
  invalid,
} from './limits';
import { isShareableBy, sharesAGroup, sharingOf } from './settings';
import { record } from './notifications';
import { clientClock } from './sync';

/**
 * Writing the rows that `./access.ts` reads.
 *
 * Two shapes of grant, and one row each. A share with a person names
 * `recipientUserId` and waits for an answer. A share with a group names
 * `groupId` and does not — membership *is* the answer, which is the reason
 * groups exist here: a person joining or leaving changes what they can open
 * with no rows to insert and none to remember to delete.
 *
 * That asymmetry is the only one. Both kinds are the same table, the same
 * resolution path and the same revoke.
 */

/**
 * What a recipient is told about a document before they can open it.
 *
 * Deliberately narrower than `Library.PublicDocument`. Four fields of that one
 * are the sender's own facts about their own file and have no business crossing
 * to somebody else: `fingerprint` would let a recipient confirm whether the
 * sender holds a particular file, `originalFileName` is what the PDF was called
 * in the sender's downloads folder, and `mimeType` and `processing` describe
 * an import the recipient was not part of.
 */
export type SharedDocument = {
  id: Id<'documents'>;
  title: string;
  author: string | null;
  pageCount: number | null;
  byteSize: number;
  hasCover: boolean;
};

export const sharedDocumentValidator = v.object({
  id: v.id('documents'),
  title: v.string(),
  author: v.union(v.string(), v.null()),
  pageCount: v.union(v.number(), v.null()),
  byteSize: v.number(),
  hasCover: v.boolean(),
});

export function toSharedDocument(doc: Doc<'documents'>): SharedDocument {
  return {
    id: doc._id,
    title: doc.title,
    author: doc.author ?? null,
    pageCount: doc.pageCount ?? null,
    byteSize: doc.byteSize,
    hasCover: doc.coverStorageKey !== undefined,
  };
}

export type PublicShare = {
  id: Id<'documentShares'>;
  document: SharedDocument | null;
  /** `incoming` if the caller is on the receiving end of it. */
  direction: 'incoming' | 'outgoing';
  /** The other party: the sender on an incoming share, the recipient on an outgoing one. */
  counterpart: PublicProfile | null;
  group: { id: Id<'groups'>; name: string } | null;
  subject: 'user' | 'group';
  role: 'viewer' | 'annotator';
  canDownload: boolean;
  canReshare: boolean;
  status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
  message: string | null;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export const publicShareValidator = v.object({
  id: v.id('documentShares'),
  document: v.union(sharedDocumentValidator, v.null()),
  direction: v.union(v.literal('incoming'), v.literal('outgoing')),
  counterpart: v.union(
    v.object({
      id: v.id('users'),
      displayName: v.string(),
      handle: v.union(v.string(), v.null()),
      pictureUrl: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  group: v.union(v.object({ id: v.id('groups'), name: v.string() }), v.null()),
  subject: v.union(v.literal('user'), v.literal('group')),
  role: v.union(v.literal('viewer'), v.literal('annotator')),
  canDownload: v.boolean(),
  canReshare: v.boolean(),
  status: v.union(
    v.literal('pending'),
    v.literal('accepted'),
    v.literal('declined'),
    v.literal('revoked'),
    v.literal('expired'),
  ),
  message: v.union(v.string(), v.null()),
  expiresAt: v.union(v.number(), v.null()),
  revokedAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

function refuse(): never {
  throw new ConvexError({ code: AuthError.forbidden });
}

/**
 * The wire shape, from one side or the other.
 *
 * `direction` is computed from the caller rather than stored, because the same
 * row is an outgoing share to the person who made it and an incoming one to the
 * person who got it — and `counterpart` follows from it, so neither side ever
 * has to be told who they themselves are.
 */
export async function toPublicShare(
  ctx: QueryCtx | MutationCtx,
  share: Doc<'documentShares'>,
  viewer: Doc<'users'>,
): Promise<PublicShare> {
  const outgoing = share.ownerId === viewer._id || share.createdBy === viewer._id;
  const doc = await ctx.db.get('documents', share.documentId);

  const counterpartId = outgoing ? share.recipientUserId : share.createdBy;
  const group =
    share.groupId === undefined ? null : await ctx.db.get('groups', share.groupId);

  return {
    id: share._id,
    document: doc === null ? null : toSharedDocument(doc),
    direction: outgoing ? 'outgoing' : 'incoming',
    counterpart: counterpartId === undefined ? null : await profileOf(ctx, counterpartId),
    group: group === null ? null : { id: group._id, name: group.name },
    subject: share.subject,
    role: share.role,
    canDownload: share.canDownload,
    canReshare: share.canReshare,
    status: share.status,
    message: share.message ?? null,
    expiresAt: share.expiresAt ?? null,
    revokedAt: share.revokedAt ?? null,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
  };
}

export type CreateInput = {
  documentId: Id<'documents'>;
  subject: 'user' | 'group';
  recipientUserId?: Id<'users'>;
  groupId?: Id<'groups'>;
  role: 'viewer' | 'annotator';
  canDownload: boolean;
  canReshare: boolean;
  message?: string;
  expiresAt?: number;
  clientOpId?: string;
  clientUpdatedAt?: number;
};

/**
 * Offers a document to one person or one group.
 *
 * The order of the checks is the security of the function, so it is worth
 * reading as a list:
 *
 *  1. **Can the caller share this at all?** `requireResharable` answers that
 *     and returns the ceiling — wide open for the owner, the resharer's own
 *     grant for anybody else.
 *  2. **Is there anything to share?** A document with no `storageKey` exists
 *     only on the sender's phone. Sharing it would create a permission that can
 *     never be exercised, so it is refused with a sentence that says what to do.
 *  3. **Is the target willing?** `isShareableBy` for a person, membership for a
 *     group. Refused as `FORBIDDEN` rather than explained, because a refusal
 *     that names the reason confirms the account exists.
 *  4. **Is this a repeat?** On `clientOpId` first — an outbox can deliver the
 *     same share twice — and then on the pair, so re-sharing with somebody who
 *     already has it updates their permission instead of stacking rows.
 *  5. **Clamp, then insert.** `clampToCeiling` is applied to what the caller
 *     asked for, including for the owner, so there is one path rather than two
 *     that can drift.
 */
/**
 * What a group allows, applied to what the sender asked for.
 *
 * A ceiling rather than a default: asking for `annotator` in a group set to
 * `viewer` gets `viewer`, the same way `clampToCeiling` treats a resharer's own
 * grant. Reading a missing group as "no opinion" would make a deleted group
 * more permissive than a live one, so it refuses instead — and the caller has
 * already proved membership by the time this runs.
 */
async function withinGroup(
  ctx: MutationCtx,
  groupId: Id<'groups'>,
  input: CreateInput,
): Promise<{ role: 'viewer' | 'annotator'; canDownload: boolean; canReshare: boolean }> {
  const group = await ctx.db.get('groups', groupId);
  if (group === null) {
    refuse();
  }
  const settings = Groups.settingsOf(group);
  return {
    role: settings.defaultRole === 'viewer' ? 'viewer' : input.role,
    canDownload: settings.defaultCanDownload && input.canDownload,
    canReshare: input.canReshare,
  };
}

export async function create(
  ctx: MutationCtx,
  user: Doc<'users'>,
  input: CreateInput,
): Promise<Id<'documentShares'>> {
  const ceiling = await requireResharable(ctx, user, input.documentId);
  const doc = ceiling.doc;

  if (doc.storageKey === undefined) {
    invalid(
      'This document is only on this device. Turn on syncing for it before sharing it.',
    );
  }

  if (input.clientOpId !== undefined) {
    const already = await ctx.db
      .query('documentShares')
      .withIndex('by_owner_and_op', (q) =>
        q.eq('ownerId', doc.ownerId).eq('clientOpId', input.clientOpId),
      )
      .unique();
    if (already !== null) {
      return already._id;
    }
  }

  // **A group's own ceiling, applied before the resharer's.** `defaultRole` and
  // `defaultCanDownload` are the group saying what a document dropped into it
  // may be — a reading list that never wants copies leaving is a setting rather
  // than a thing every member has to remember on every share. `clampToCeiling`
  // still runs on top of it, so a reshare can never grant more than the
  // resharer holds whatever a group says.
  const wanted =
    input.subject === 'group'
      ? await withinGroup(ctx, requireGroupId(input), input)
      : { role: input.role, canDownload: input.canDownload, canReshare: input.canReshare };

  const granted = clampToCeiling(wanted, ceiling);
  const message = cleanOptionalText(input.message, SHARE_MESSAGE_MAX, 'Message');
  const now = Date.now();

  const existing =
    input.subject === 'user'
      ? await directShare(ctx, input.documentId, requireRecipient(input))
      : await groupShare(ctx, input.documentId, requireGroupId(input));

  if (existing !== null) {
    // Re-offering is a permission change, not a second row. A revoked or
    // declined share comes back as `pending` so the recipient answers again
    // rather than silently regaining access they once turned down.
    await ctx.db.patch('documentShares', existing._id, {
      ...granted,
      message,
      expiresAt: input.expiresAt,
      status: input.subject === 'group' ? 'accepted' : 'pending',
      revokedAt: undefined,
      respondedAt: undefined,
      ...clientClock(input.clientUpdatedAt),
      updatedAt: now,
    });
    return existing._id;
  }

  await assertRoom(ctx, doc);

  if (input.subject === 'user') {
    const recipientId = requireRecipient(input);
    const recipient = await ctx.db.get('users', recipientId);
    if (recipient === null || !(await isShareableBy(ctx, recipient, user))) {
      refuse();
    }
  } else {
    // Sharing into a group the caller is not in would be posting a document to
    // strangers. Membership is checked here rather than only in `Groups`,
    // because this is the write that grants.
    const groupId = requireGroupId(input);
    const membership = await ctx.db
      .query('groupMembers')
      .withIndex('by_group_and_user', (q) => q.eq('groupId', groupId).eq('userId', user._id))
      .unique();
    if (membership === null) {
      refuse();
    }

    // **`whoCanShare`.** Being in a group is permission to read what is in it,
    // which is not the same as permission to put something there — a reading
    // list somebody curates and a group anybody can drop a file into are
    // different things, and the difference is one setting.
    const group = await ctx.db.get('groups', groupId);
    if (group === null) {
      refuse();
    }
    const settings = Groups.settingsOf(group);
    const mayShare =
      settings.whoCanShare === 'members' ||
      group.ownerId === user._id ||
      membership.role === 'admin';
    if (!mayShare) {
      refuse();
    }
  }

  return await ctx.db.insert('documentShares', {
    documentId: doc._id,
    ownerId: doc.ownerId,
    createdBy: user._id,
    subject: input.subject,
    recipientUserId: input.recipientUserId,
    groupId: input.groupId,
    ...granted,
    // A group share grants on membership, so there is nobody to answer it.
    status: input.subject === 'group' ? 'accepted' : 'pending',
    message,
    expiresAt: input.expiresAt,
    clientOpId: input.clientOpId,
    ...clientClock(input.clientUpdatedAt),
    createdAt: now,
    updatedAt: now,
  });
}

function requireRecipient(input: CreateInput): Id<'users'> {
  if (input.recipientUserId === undefined) {
    invalid('A share with a person needs somebody to share with.');
  }
  return input.recipientUserId;
}

function requireGroupId(input: CreateInput): Id<'groups'> {
  if (input.groupId === undefined) {
    invalid('A share with a group needs a group.');
  }
  return input.groupId;
}

async function directShare(
  ctx: QueryCtx | MutationCtx,
  documentId: Id<'documents'>,
  recipientUserId: Id<'users'>,
): Promise<Doc<'documentShares'> | null> {
  return await ctx.db
    .query('documentShares')
    .withIndex('by_document_and_recipient', (q) =>
      q.eq('documentId', documentId).eq('recipientUserId', recipientUserId),
    )
    .unique();
}

async function groupShare(
  ctx: QueryCtx | MutationCtx,
  documentId: Id<'documents'>,
  groupId: Id<'groups'>,
): Promise<Doc<'documentShares'> | null> {
  const rows = await ctx.db
    .query('documentShares')
    .withIndex('by_group', (q) => q.eq('groupId', groupId).eq('documentId', documentId))
    .take(1);
  return rows[0] ?? null;
}

/** Two ceilings, checked on insert only — an update to an existing row is not growth. */
async function assertRoom(ctx: QueryCtx | MutationCtx, doc: Doc<'documents'>): Promise<void> {
  const onDocument = await ctx.db
    .query('documentShares')
    .withIndex('by_document', (q) => q.eq('documentId', doc._id))
    .take(SHARES_PER_DOCUMENT + 1);
  if (onDocument.length > SHARES_PER_DOCUMENT) {
    invalid(`A document can be shared with at most ${SHARES_PER_DOCUMENT} people or groups.`);
  }

  const byOwner = await ctx.db
    .query('documentShares')
    .withIndex('by_owner_and_updated', (q) => q.eq('ownerId', doc.ownerId))
    .take(SHARES_PER_OWNER + 1);
  if (byOwner.length > SHARES_PER_OWNER) {
    invalid('You have reached the number of shares one account can hold out at once.');
  }
}

/**
 * Accepting or declining an offer.
 *
 * Only the recipient of a direct share can answer, and `requireAddressed`
 * refuses a group share outright — a caller naming one here would be answering
 * on the group's behalf. Idempotent: answering twice is the same answer.
 */
export async function respond(
  ctx: MutationCtx,
  user: Doc<'users'>,
  shareId: Id<'documentShares'>,
  answer: 'accept' | 'decline',
): Promise<Doc<'documentShares'>> {
  const share = await requireAddressed(ctx, user, shareId);
  if (share.status === 'revoked' || share.status === 'expired') {
    refuse();
  }
  await refuseIfExpired(ctx, share);

  const status = answer === 'accept' ? 'accepted' : 'declined';
  if (share.status === status) {
    return share;
  }

  const now = Date.now();
  await ctx.db.patch('documentShares', shareId, {
    status,
    respondedAt: now,
    updatedAt: now,
  });

  await record(ctx, {
    userId: share.createdBy,
    kind: answer === 'accept' ? 'shareAccepted' : 'shareDeclined',
    actorId: user._id,
    shareId,
    documentId: share.documentId,
  });

  const updated = await ctx.db.get('documentShares', shareId);
  if (updated === null) {
    refuse();
  }
  return updated;
}

/**
 * Changing what somebody may do.
 *
 * Clamped against the granter's own ceiling exactly as a create is, so a
 * resharer cannot widen later what they could not grant at the time. The
 * recipient is told, because a permission quietly narrowing is a feature that
 * stops working for no visible reason.
 */
export async function changePermission(
  ctx: MutationCtx,
  user: Doc<'users'>,
  shareId: Id<'documentShares'>,
  next: { role: 'viewer' | 'annotator'; canDownload: boolean; canReshare: boolean },
): Promise<void> {
  const share = await requireAdministrable(ctx, user, shareId);
  const ceiling = await requireResharable(ctx, user, share.documentId);
  const granted = clampToCeiling(next, ceiling);

  if (
    granted.role === share.role &&
    granted.canDownload === share.canDownload &&
    granted.canReshare === share.canReshare
  ) {
    return;
  }

  await ctx.db.patch('documentShares', shareId, { ...granted, updatedAt: Date.now() });

  if (share.recipientUserId !== undefined) {
    await record(ctx, {
      userId: share.recipientUserId,
      kind: 'accessChanged',
      actorId: user._id,
      shareId,
      documentId: share.documentId,
    });
  }
}

/**
 * Taking access away.
 *
 * The row is kept rather than deleted, and marked. A deleted row would leave
 * the recipient's device with a document it can no longer explain — their copy
 * would simply stop working — where a `revoked` row reconciles down to a screen
 * that says who removed it and when.
 *
 * The recipient's own annotations on the document go, because they were written
 * under a permission that no longer exists and the owner should not be left
 * holding somebody else's words on their own document. Their events go for the
 * same reason. **The file on their phone does not go, and nothing here can make
 * it** — which is why `canDownload` is off by default and the dialog says so.
 */
export async function revoke(
  ctx: MutationCtx,
  user: Doc<'users'>,
  shareId: Id<'documentShares'>,
): Promise<void> {
  const share = await requireAdministrable(ctx, user, shareId);
  const now = Date.now();

  if (share.status !== 'revoked') {
    await ctx.db.patch('documentShares', shareId, {
      status: 'revoked',
      revokedAt: now,
      updatedAt: now,
    });
  }

  if (share.recipientUserId !== undefined) {
    await forgetAnnotations(ctx, share.documentId, share.recipientUserId);
    await record(ctx, {
      userId: share.recipientUserId,
      kind: 'accessRevoked',
      actorId: user._id,
      shareId,
      documentId: share.documentId,
    });
  }
}

/**
 * Drops one person's annotations on one document.
 *
 * Bounded by `ANNOTATIONS_PER_DOCUMENT`, which is what the author could have
 * written, and reached through `by_document_and_author` — without that index
 * this would read every annotation on the document to find the handful that
 * are theirs.
 */
export async function forgetAnnotations(
  ctx: MutationCtx,
  documentId: Id<'documents'>,
  authorId: Id<'users'>,
): Promise<void> {
  const theirs = await ctx.db
    .query('documentAnnotations')
    .withIndex('by_document_and_author', (q) =>
      q.eq('documentId', documentId).eq('authorId', authorId),
    )
    .take(ANNOTATIONS_PER_DOCUMENT);
  for (const annotation of theirs) {
    await ctx.db.delete('documentAnnotations', annotation._id);
  }
}

/** Everything shared with this person, newest change first. */
export async function inboxFor(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  status: 'pending' | 'active' | null,
): Promise<Doc<'documentShares'>[]> {
  const direct =
    status === 'pending'
      ? await ctx.db
          .query('documentShares')
          .withIndex('by_recipient_and_status', (q) =>
            q.eq('recipientUserId', user._id).eq('status', 'pending'),
          )
          .take(SHARE_LIST_LIMIT)
      : await ctx.db
          .query('documentShares')
          .withIndex('by_recipient_and_updated', (q) => q.eq('recipientUserId', user._id))
          .order('desc')
          .take(SHARE_LIST_LIMIT);

  if (status === 'pending') {
    return direct;
  }

  // Group shares have no recipient column to index on, so they are reached
  // through the caller's own memberships — their graph, not a scan.
  const memberships = await ctx.db
    .query('groupMembers')
    .withIndex('by_user', (q) => q.eq('userId', user._id))
    .take(SHARE_LIST_LIMIT);

  const throughGroups: Doc<'documentShares'>[] = [];
  for (const membership of memberships) {
    const rows = await ctx.db
      .query('documentShares')
      .withIndex('by_group', (q) => q.eq('groupId', membership.groupId))
      .take(SHARE_LIST_LIMIT);
    for (const row of rows) {
      if (row.ownerId !== user._id) {
        throughGroups.push(row);
      }
    }
  }

  const merged = [...direct, ...throughGroups];
  const seen = new Set<string>();
  return merged
    .filter((row) => (seen.has(row._id) ? false : (seen.add(row._id), true)))
    .filter((row) => (status === 'active' ? row.status === 'accepted' : true))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, SHARE_LIST_LIMIT);
}

/** Everything this person has shared out. */
export async function outboxFor(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
): Promise<Doc<'documentShares'>[]> {
  return await ctx.db
    .query('documentShares')
    .withIndex('by_owner_and_updated', (q) => q.eq('ownerId', user._id))
    .order('desc')
    .take(SHARE_LIST_LIMIT);
}

/** Everybody a document is shared with. The Manage Access list. */
export async function accessListFor(
  ctx: QueryCtx | MutationCtx,
  documentId: Id<'documents'>,
): Promise<Doc<'documentShares'>[]> {
  const rows = await ctx.db
    .query('documentShares')
    .withIndex('by_document', (q) => q.eq('documentId', documentId))
    .take(SHARE_LIST_LIMIT);
  return rows.filter((row) => row.status !== 'declined');
}

/**
 * Drops every share on a document, for the delete cascade.
 *
 * Deleted rather than revoked, because the document itself is going: there is
 * nothing left for a revoked row to describe, and leaving one would put a
 * dangling entry in every recipient's inbox forever.
 */
export async function removeForDocument(
  ctx: MutationCtx,
  documentId: Id<'documents'>,
): Promise<void> {
  const shares = await ctx.db
    .query('documentShares')
    .withIndex('by_document', (q) => q.eq('documentId', documentId))
    .take(SHARES_PER_DOCUMENT);
  for (const share of shares) {
    const events = await ctx.db
      .query('shareEvents')
      .withIndex('by_share', (q) => q.eq('shareId', share._id))
      .take(SHARE_LIST_LIMIT);
    for (const event of events) {
      await ctx.db.delete('shareEvents', event._id);
    }
    await ctx.db.delete('documentShares', share._id);
  }
}

/**
 * Marks shares whose time is up.
 *
 * Not the only enforcement, and not the first one. `Access.grants` compares the
 * same clock on every resolution, so anybody who asks after a share has lapsed
 * is refused immediately. What this adds is the write: a Convex query is not
 * re-run because time advanced, so a screen that subscribed while the share was
 * live goes on rendering it until something it read changes. `status` is that
 * something.
 *
 * It cannot be done lazily from the refusing mutation, which is the obvious
 * design and does not work: a mutation is one transaction, so a handler that
 * patches the row and then throws rolls the patch back with everything else.
 * Hence a cron, and hence fifteen minutes rather than a night.
 */
export async function expireDue(ctx: MutationCtx, limit: number): Promise<number> {
  const now = Date.now();
  let expired = 0;

  for (const status of ['accepted', 'pending'] as const) {
    const due = await ctx.db
      .query('documentShares')
      .withIndex('by_status_and_expiry', (q) =>
        q.eq('status', status).gt('expiresAt', 0).lte('expiresAt', now),
      )
      .take(limit - expired);

    for (const share of due) {
      await ctx.db.patch('documentShares', share._id, { status: 'expired', updatedAt: now });
      expired += 1;
    }
    if (expired >= limit) {
      break;
    }
  }
  return expired;
}

/**
 * Whether these two accounts have anything to do with each other.
 *
 * A group in common, or a share in either direction. It is what stands between
 * `sharing.profile` and an enumeration of every account in the deployment by
 * id — the same thing `Discovery` prevents for search, reached through a
 * different door.
 *
 * Bounded on both sides: the caller's own memberships, and the shares addressed
 * to or created by them. Neither can be made large by the person being asked
 * about.
 */
export async function knowsEachOther(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  other: Id<'users'>,
): Promise<boolean> {
  if (await sharesAGroup(ctx, user._id, other)) {
    return true;
  }

  // Shared with them.
  const sent = await ctx.db
    .query('documentShares')
    .withIndex('by_owner_and_updated', (q) => q.eq('ownerId', user._id))
    .take(SHARE_LIST_LIMIT);
  if (sent.some((share) => share.recipientUserId === other)) {
    return true;
  }

  // Or they shared with the caller.
  const received = await ctx.db
    .query('documentShares')
    .withIndex('by_recipient_and_updated', (q) => q.eq('recipientUserId', user._id))
    .take(SHARE_LIST_LIMIT);
  return received.some((share) => share.ownerId === other || share.createdBy === other);
}

/**
 * What two accounts actually have between them.
 *
 * The same walk `knowsEachOther` does, reporting what it found rather than
 * stopping at the first hit. It is what `ProfileSheet` renders — and the whole
 * of what Pidom will tell one person about another beyond a name, a handle and
 * a picture: how you know them, and how many documents have passed between you.
 * Not what else they are reading, and not their address.
 */
export async function commonGround(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  other: Id<'users'>,
): Promise<{ groups: string[]; documents: number }> {
  const mine = await ctx.db
    .query('groupMembers')
    .withIndex('by_user', (q) => q.eq('userId', user._id))
    .take(SHARE_LIST_LIMIT);

  const groups: string[] = [];
  for (const membership of mine) {
    const theirs = await ctx.db
      .query('groupMembers')
      .withIndex('by_group_and_user', (q) =>
        q.eq('groupId', membership.groupId).eq('userId', other),
      )
      .unique();
    if (theirs === null) {
      continue;
    }
    const group = await ctx.db.get('groups', membership.groupId);
    if (group !== null) {
      groups.push(group.name);
    }
  }

  const sent = await ctx.db
    .query('documentShares')
    .withIndex('by_owner_and_updated', (q) => q.eq('ownerId', user._id))
    .take(SHARE_LIST_LIMIT);
  const received = await ctx.db
    .query('documentShares')
    .withIndex('by_recipient_and_updated', (q) => q.eq('recipientUserId', user._id))
    .take(SHARE_LIST_LIMIT);

  // Counted by document rather than by row: the same document reshared back is
  // one thing between two people, not two.
  const documents = new Set<string>();
  for (const share of sent) {
    if (share.recipientUserId === other) {
      documents.add(share.documentId);
    }
  }
  for (const share of received) {
    if (share.ownerId === other || share.createdBy === other) {
      documents.add(share.documentId);
    }
  }

  return { groups, documents: documents.size };
}

/** Whether this account has said other people may share with it at all. */
export async function acceptsSharesFrom(
  ctx: QueryCtx | MutationCtx,
  target: Doc<'users'>,
): Promise<boolean> {
  return (await sharingOf(ctx, target._id)).shareableBy !== 'nobody';
}
