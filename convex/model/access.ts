import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { AuthError, assertOwner } from './auth';
import { SHARE_LIST_LIMIT } from './limits';

/**
 * The second way into a document, and the only one.
 *
 * The rules live here; the rows they read are written in `./sharing.ts`.
 *
 * Every other model in this backend answers one question — does this row's
 * `ownerId` equal the caller's `_id` — and `assertOwner` is the whole of it.
 * Sharing cannot be expressed that way: a recipient is not the owner and never
 * becomes one, because there is exactly one `documents` row and exactly one
 * object in R2 however many people can open it.
 *
 * So access is resolved rather than compared, and it is resolved **here**. Any
 * function that reads or writes a document on behalf of somebody who might not
 * own it calls one of the `require*` functions below and nothing else. The
 * rules that hold across all of them:
 *
 * - **The owner path is unchanged.** It is checked first and it is still
 *   `assertOwner`, so sharing cannot have made an owner's own access weaker or
 *   slower. A document nobody has shared resolves in one `get`.
 * - **A grant is read, never remembered.** There is no session, no cached
 *   permission and no field on `documents` saying it is shared. Removing access
 *   is a write to one row, and the next read sees it.
 * - **Refusals are indistinguishable.** A document that does not exist, one
 *   owned by somebody else with no share, and one whose share was revoked all
 *   raise `FORBIDDEN`. Telling them apart would let a caller probe which
 *   document ids exist.
 * - **Expiry is checked twice, and neither check is sufficient alone.** The
 *   clock is compared on every resolution, so a caller who asks after a share
 *   has lapsed is refused — but a Convex query is not re-run because time
 *   advanced, so a screen that subscribed while the share was live goes on
 *   rendering it. What fixes that is `Sharing.expireDue`, which writes `status`
 *   on a schedule; a write is what invalidates a subscription. So: exact for
 *   anybody who asks now, and at most one sweep interval stale for a screen
 *   already open. The sweep runs every fifteen minutes for that reason.
 */

/** What the caller is allowed to do, and how they came by it. */
export type Access =
  | { readonly kind: 'owner' }
  | {
      readonly kind: 'share';
      readonly share: Doc<'documentShares'>;
      readonly role: 'viewer' | 'annotator';
      readonly canDownload: boolean;
      readonly canReshare: boolean;
    };

export type Reachable = { readonly doc: Doc<'documents'>; readonly access: Access };

/** Every refusal in this file is this one. See the note above. */
function refuse(): never {
  throw new ConvexError({ code: AuthError.forbidden });
}

/**
 * Whether a grant is currently granting anything.
 *
 * `accepted` and nothing else: a share the recipient has not answered is a
 * notification and a title, and nothing is readable under it. `revokedAt` is
 * checked as well as `status` because the two are written together and a row
 * that carries one without the other is a row this function should not trust.
 *
 * The clock is read here even though this runs inside queries, and the Convex
 * guidance against that is about reactivity rather than correctness: the value
 * is whatever the time was when the query last ran, so this is exact for a
 * caller asking now and stale for a subscription already open. Leaving it out
 * would make it wrong for both. `Sharing.expireDue` is the other half.
 */
function grants(share: Doc<'documentShares'>): boolean {
  if (share.status !== 'accepted' || share.revokedAt !== undefined) {
    return false;
  }
  return share.expiresAt === undefined || share.expiresAt > Date.now();
}

/**
 * The share this person holds on this document, direct or through a group.
 *
 * Direct first, because it is one index lookup and because a direct grant is
 * the more specific statement — somebody given `annotator` personally keeps it
 * when the group they are also in is only a `viewer`.
 *
 * The group walk is bounded by the document's own share count rather than by
 * the caller's group count, and it stops at the first grant. It is the reason
 * `documentShares.by_group` is ordered by document: one group's shares read as
 * a list rather than a scan.
 */
async function findGrant(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  documentId: Id<'documents'>,
): Promise<Doc<'documentShares'> | null> {
  const direct = await ctx.db
    .query('documentShares')
    .withIndex('by_document_and_recipient', (q) =>
      q.eq('documentId', documentId).eq('recipientUserId', user._id),
    )
    .take(1);

  if (direct.length === 1 && grants(direct[0])) {
    return direct[0];
  }

  // Group shares on this document. Bounded, and read before membership so the
  // membership lookups run only for groups this document is actually shared
  // with — a caller in fifty groups costs nothing on a document shared with one.
  const groupShares = await ctx.db
    .query('documentShares')
    .withIndex('by_document', (q) => q.eq('documentId', documentId))
    .take(SHARE_LIST_LIMIT);

  for (const share of groupShares) {
    if (share.subject !== 'group' || share.groupId === undefined || !grants(share)) {
      continue;
    }
    const membership = await ctx.db
      .query('groupMembers')
      .withIndex('by_group_and_user', (q) =>
        q.eq('groupId', share.groupId as Id<'groups'>).eq('userId', user._id),
      )
      .unique();
    if (membership !== null) {
      return share;
    }
  }

  return null;
}

/**
 * The document, and what the caller may do with it. `FORBIDDEN` otherwise.
 *
 * This is what `Library.requireDocument` becomes for every read that a
 * recipient is entitled to make. Writes to the document row itself — renaming
 * it, filing it, deleting it, syncing it — keep calling `requireDocument`,
 * because those are the owner's and no role here expresses them.
 */
export async function requireReadable(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  documentId: Id<'documents'>,
): Promise<Reachable> {
  const doc = await ctx.db.get('documents', documentId);
  if (doc === null) {
    refuse();
  }
  if (doc.ownerId === user._id) {
    return { doc, access: { kind: 'owner' } };
  }

  const share = await findGrant(ctx, user, documentId);
  if (share === null) {
    refuse();
  }

  return {
    doc,
    access: {
      kind: 'share',
      share,
      role: share.role,
      canDownload: share.canDownload,
      canReshare: share.canReshare,
    },
  };
}

/**
 * The same, for somebody about to write an annotation.
 *
 * An owner always can. A recipient needs `annotator` — and `viewer` is refused
 * here rather than in the screen that hides the button, which is the whole
 * point: the button being absent is a convenience, and this is the rule.
 */
export async function requireAnnotatable(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  documentId: Id<'documents'>,
): Promise<Reachable> {
  const reachable = await requireReadable(ctx, user, documentId);
  if (reachable.access.kind === 'share' && reachable.access.role !== 'annotator') {
    refuse();
  }
  return reachable;
}

/**
 * The same, for somebody about to be handed a signed URL.
 *
 * A mutation, always — a URL is minted at the moment of use — so this is the
 * one place where reading the clock is both allowed and required. An expired
 * share is refused here even if the sweep has not reached it yet, and the row
 * is flipped on the way past so every open subscription learns about it.
 */
export async function requireDownloadable(
  ctx: MutationCtx,
  user: Doc<'users'>,
  documentId: Id<'documents'>,
): Promise<Reachable> {
  const reachable = await requireReadable(ctx, user, documentId);
  if (reachable.access.kind === 'owner') {
    return reachable;
  }
  if (!reachable.access.canDownload) {
    refuse();
  }
  await refuseIfExpired(ctx, reachable.access.share);
  return reachable;
}

/**
 * The same, for somebody about to pass a document on.
 *
 * The cap is the reason this returns the ceiling rather than a boolean: a
 * reshare may never grant more than the resharer holds. `Sharing.create` clamps
 * against what comes back, so there is no path on which a `viewer` hands
 * somebody `annotator`, or a recipient who cannot download lets somebody else.
 */
export type ReshareCeiling = {
  readonly role: 'viewer' | 'annotator';
  readonly canDownload: boolean;
  /** Always false for a recipient. A reshare cannot itself be reshared. */
  readonly canReshare: boolean;
  readonly doc: Doc<'documents'>;
};

export async function requireResharable(
  ctx: MutationCtx,
  user: Doc<'users'>,
  documentId: Id<'documents'>,
): Promise<ReshareCeiling> {
  const reachable = await requireReadable(ctx, user, documentId);
  if (reachable.access.kind === 'owner') {
    return { role: 'annotator', canDownload: true, canReshare: true, doc: reachable.doc };
  }
  if (!reachable.access.canReshare) {
    refuse();
  }
  await refuseIfExpired(ctx, reachable.access.share);
  return {
    role: reachable.access.role,
    canDownload: reachable.access.canDownload,
    canReshare: false,
    doc: reachable.doc,
  };
}

/**
 * Clamps a requested permission to what the granter actually holds.
 *
 * Called on every create, including the owner's own — where the ceiling is
 * wide open and the clamp is a no-op — so there is one code path rather than
 * an owner path and a recipient path that can drift apart.
 */
export function clampToCeiling(
  requested: { role: 'viewer' | 'annotator'; canDownload: boolean; canReshare: boolean },
  ceiling: ReshareCeiling,
): { role: 'viewer' | 'annotator'; canDownload: boolean; canReshare: boolean } {
  return {
    role: ceiling.role === 'viewer' ? 'viewer' : requested.role,
    canDownload: requested.canDownload && ceiling.canDownload,
    canReshare: requested.canReshare && ceiling.canReshare,
  };
}

/**
 * Refuses an expired share.
 *
 * It does **not** write `status` on the way past, and the first version did —
 * which did not work and could not. A Convex mutation is one transaction, so a
 * handler that patches a row and then throws rolls the patch back with
 * everything else: the caller was refused and the row still said `accepted`.
 * The test that caught it is in `convex/sharing.test.ts`.
 *
 * Marking the row is therefore `Sharing.expireDue`'s job, on the cron, in a
 * transaction that commits because nothing in it fails. This is the refusal,
 * and `grants` above is the same comparison on the read path.
 */
export async function refuseIfExpired(
  ctx: MutationCtx,
  share: Doc<'documentShares'>,
): Promise<void> {
  void ctx;
  if (share.expiresAt !== undefined && share.expiresAt <= Date.now()) {
    refuse();
  }
}

/**
 * The caller's own grant on a document, without throwing.
 *
 * For the handful of places that want to render differently rather than refuse
 * — the reader deciding whether to offer Share, the annotations list deciding
 * whether to group by author. Returning `null` where `requireReadable` would
 * throw keeps a screen from having to catch an error to ask a question.
 */
export async function accessOf(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  documentId: Id<'documents'>,
): Promise<Access | null> {
  const doc = await ctx.db.get('documents', documentId);
  if (doc === null) {
    return null;
  }
  if (doc.ownerId === user._id) {
    return { kind: 'owner' };
  }
  const share = await findGrant(ctx, user, documentId);
  return share === null
    ? null
    : {
        kind: 'share',
        share,
        role: share.role,
        canDownload: share.canDownload,
        canReshare: share.canReshare,
      };
}

/**
 * The document a share names, for the person who made the share.
 *
 * A share row can be administered by two people — the document's owner, and
 * whoever created it if that was a reshare — so this is not `assertOwner` on
 * one field. Both are checked explicitly rather than through a helper, because
 * "either of these two" is exactly the kind of rule that gets loosened by
 * accident when it is hidden inside one.
 */
export async function requireAdministrable(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  shareId: Id<'documentShares'>,
): Promise<Doc<'documentShares'>> {
  const share = await ctx.db.get('documentShares', shareId);
  if (share === null || (share.ownerId !== user._id && share.createdBy !== user._id)) {
    refuse();
  }
  return share;
}

/**
 * The share addressed to this caller, for accepting or declining it.
 *
 * Only the recipient of a direct share can answer one. A group share has no
 * recipient to answer it — membership is the answer — so a caller naming one
 * here is refused rather than silently accepted on the group's behalf.
 */
export async function requireAddressed(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  shareId: Id<'documentShares'>,
): Promise<Doc<'documentShares'>> {
  const share = await ctx.db.get('documentShares', shareId);
  if (share === null || share.subject !== 'user' || share.recipientUserId !== user._id) {
    refuse();
  }
  return share;
}

/** Asserts a document belongs to the caller, and returns it. The owner-only path. */
export async function requireOwned(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  documentId: Id<'documents'>,
): Promise<Doc<'documents'>> {
  const doc = await ctx.db.get('documents', documentId);
  assertOwner(doc, user);
  return doc;
}
