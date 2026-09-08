import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import { mutation, query } from './_generated/server';
import * as Annotations from './model/annotations';
import { requireDownloadable, requireReadable } from './model/access';
import { AuthError, requireUser } from './model/auth';
import * as Discovery from './model/discovery';
import { publicProfileValidator } from './model/discovery';
import { DISCOVERY_LIMIT, DOWNLOAD_URL_SECONDS, SEARCH_TERM_MAX } from './model/limits';
import * as Notifications from './model/notifications';
import { limit } from './model/rateLimits';
import * as Sharing from './model/sharing';
import { publicShareValidator } from './model/sharing';
import { dispatch } from './push';
import { r2 } from './r2';
import { queueFanOut } from './workflows/share';

/**
 * The sharing API.
 *
 * Same shape as `convex/library.ts`: every function here is an argument
 * contract and one call into a model, so the public surface stays auditable in
 * one read. That matters more here than anywhere else in this backend, because
 * these are the only functions that hand one account something belonging to
 * another.
 *
 * **No function takes an owner id, and no function takes a permission it does
 * not check.** A caller names a document, a person or a group, and what they
 * would like to grant. Whether they may grant it is resolved from the verified
 * JWT through `convex/model/access.ts`, every time, and the requested
 * permission is clamped against what the caller actually holds.
 */

/* ── reads ──────────────────────────────────────────────────────────── */

/**
 * What has been shared with this reader.
 *
 * `pending` is its own index rather than a filter, because Pending is a badge
 * on a row that renders on the home screen and it should not read the whole
 * history to count two things.
 */
export const inbox = query({
  args: { filter: v.union(v.literal('all'), v.literal('active'), v.literal('pending')) },
  returns: v.array(publicShareValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const shares = await Sharing.inboxFor(
      ctx,
      user,
      args.filter === 'all' ? null : args.filter,
    );
    const out = [];
    for (const share of shares) {
      out.push(await Sharing.toPublicShare(ctx, share, user));
    }
    return out;
  },
});

/** What this reader has shared out. */
export const outbox = query({
  args: {},
  returns: v.array(publicShareValidator),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const shares = await Sharing.outboxFor(ctx, user);
    const out = [];
    for (const share of shares) {
      out.push(await Sharing.toPublicShare(ctx, share, user));
    }
    return out;
  },
});

/**
 * Everybody a document is shared with.
 *
 * **Not readable by everybody who can read the document**, which was the first
 * version and was too wide: it let one recipient enumerate every other person
 * the owner had shared with, and being handed a document is not being handed
 * the owner's address book.
 *
 * The owner sees all of it — it is their document and the screen is called Who
 * can open this. Anybody else sees only the shares they made themselves, which
 * is what a resharer needs to be able to take one back.
 */
export const accessList = query({
  args: { documentId: v.id('documents') },
  returns: v.array(publicShareValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const { doc, access } = await requireReadable(ctx, user, args.documentId);

    const shares = await Sharing.accessListFor(ctx, args.documentId);
    const visible =
      access.kind === 'owner'
        ? shares
        : shares.filter((share) => share.createdBy === user._id);
    void doc;

    const out = [];
    for (const share of visible) {
      out.push(await Sharing.toPublicShare(ctx, share, user));
    }
    return out;
  },
});

/**
 * Finding somebody.
 *
 * Two shapes in one function, and neither is a directory: an exact handle or
 * email returns one row or none, and a name prefix reaches only people already
 * in a group with the caller. See `convex/model/discovery.ts` for why there is
 * no search index over accounts, and why there is not going to be one.
 *
 * A query, so it cannot spend a rate-limiter token — which is exactly the
 * constraint that shaped it. What bounds it is that neither branch can return
 * anything the caller could not already reach.
 */
export const findPeople = query({
  args: { term: v.string() },
  returns: v.array(publicProfileValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const term = args.term.slice(0, SEARCH_TERM_MAX);

    const exact = await Discovery.lookupExact(ctx, user, term);
    const nearby = await Discovery.searchWithinGraph(ctx, user, term);

    const seen = new Set(exact.map((profile) => profile.id));
    return [...exact, ...nearby.filter((profile) => !seen.has(profile.id))].slice(
      0,
      DISCOVERY_LIMIT,
    );
  },
});

/**
 * One person, for a profile preview.
 *
 * **Only through a relationship the caller already has**, and the check is here
 * rather than in `Discovery.profileOf` because the two callers want different
 * things. `profileOf` renders a name beside a row the caller is already looking
 * at — who shared this, who is in this group — and being unfindable cannot
 * retroactively blank out the name on a document somebody shared last week.
 *
 * This is the standalone lookup, with no such context: a user id and nothing
 * else. Gated on being authenticated alone it would let any account resolve a
 * name and a handle for any id it could get hold of, which is the enumeration
 * `Discovery` exists to prevent, reached by a different door. So there has to
 * be something between them — a group, or a share in either direction.
 */
export const profile = query({
  args: { userId: v.id('users') },
  returns: v.union(
    v.object({
      profile: publicProfileValidator,
      /** Names of the groups both accounts are in. Empty for a direct share. */
      sharedGroups: v.array(v.string()),
      /** How many documents pass between them, counted by document. */
      sharedDocuments: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.userId === user._id) {
      const self = await Discovery.profileOf(ctx, user._id);
      return self === null ? null : { profile: self, sharedGroups: [], sharedDocuments: 0 };
    }
    if (!(await Sharing.knowsEachOther(ctx, user, args.userId))) {
      // Null rather than `FORBIDDEN`, for the reason a search refusal is empty
      // rather than an error: saying "that account exists but will not talk to
      // you" is the fact being withheld.
      return null;
    }
    const found = await Discovery.profileOf(ctx, args.userId);
    if (found === null) {
      return null;
    }
    // The sheet used to take this as two props no call site passed, so it
    // always said "Nothing shared between you yet" — false by construction on
    // the Access screen, where the two accounts are looking at one document.
    const ground = await Sharing.commonGround(ctx, user, args.userId);
    return {
      profile: found,
      sharedGroups: ground.groups,
      sharedDocuments: ground.documents,
    };
  },
});

/** What has happened, for the in-app inbox. */
export const events = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(Notifications.publicEventValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query('shareEvents')
      .withIndex('by_user_and_created', (q) => q.eq('userId', user._id))
      .order('desc')
      .take(Math.min(args.limit ?? 50, 100));
    const out = [];
    for (const row of rows) {
      out.push(await Notifications.toPublicEvent(ctx, row));
    }
    return out;
  },
});

/* ── writes ─────────────────────────────────────────────────────────── */

/**
 * Offers a document to a person or a group.
 *
 * The mutation commits the grant and the event, then hands the network off:
 * a direct share dispatches one push, a group share starts the fan-out
 * workflow. Neither waits. A reader tapping Share is not made to wait on
 * Expo, and a group of two hundred is not two hundred requests inside one
 * mutation's one-second budget.
 */
export const createShare = mutation({
  args: {
    documentId: v.id('documents'),
    subject: v.union(v.literal('user'), v.literal('group')),
    recipientUserId: v.optional(v.id('users')),
    groupId: v.optional(v.id('groups')),
    role: v.union(v.literal('viewer'), v.literal('annotator')),
    canDownload: v.boolean(),
    canReshare: v.boolean(),
    message: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    clientOpId: v.optional(v.string()),
    clientUpdatedAt: v.optional(v.number()),
  },
  returns: v.id('documentShares'),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'createShare');

    const shareId = await Sharing.create(ctx, user, args);
    const share = await ctx.db.get('documentShares', shareId);
    if (share === null) {
      throw new ConvexError({ code: AuthError.forbidden });
    }

    if (share.subject === 'group') {
      await queueFanOut(ctx, shareId);
      return shareId;
    }

    if (share.recipientUserId !== undefined) {
      const eventId = await Notifications.record(ctx, {
        userId: share.recipientUserId,
        kind: 'shareOffered',
        actorId: user._id,
        shareId,
        documentId: share.documentId,
      });
      await dispatch(ctx, eventId);
    }
    return shareId;
  },
});

/** Accepting or declining an offer. Only the person it was addressed to. */
export const respondToShare = mutation({
  args: {
    shareId: v.id('documentShares'),
    answer: v.union(v.literal('accept'), v.literal('decline')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'respondShare');
    await Sharing.respond(ctx, user, args.shareId, args.answer);
    return null;
  },
});

/** Changing what somebody may do. Clamped against what the caller holds. */
export const changePermission = mutation({
  args: {
    shareId: v.id('documentShares'),
    role: v.union(v.literal('viewer'), v.literal('annotator')),
    canDownload: v.boolean(),
    canReshare: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'editShare');
    await Sharing.changePermission(ctx, user, args.shareId, {
      role: args.role,
      canDownload: args.canDownload,
      canReshare: args.canReshare,
    });
    return null;
  },
});

/**
 * Taking access away.
 *
 * Immediate for everything the server mediates. It does not reach a copy that
 * has already been downloaded, and the screen that calls this says so before
 * the tap rather than after.
 */
export const revokeShare = mutation({
  args: { shareId: v.id('documentShares') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'editShare');
    await Sharing.revoke(ctx, user, args.shareId);
    return null;
  },
});

/**
 * A signed URL for a document somebody else owns.
 *
 * The recipient's `library.downloadUrl`, and deliberately the same shape: a
 * mutation, because a query result is cached and reactive and a cached URL
 * outliving its signature is a download that fails for no visible reason.
 *
 * The differences are the whole point. `requireDownloadable` replaces
 * `requireDocument`, so it resolves a grant instead of ownership, refuses a
 * `canDownload: false` share, and refuses an expired one on a fresh clock
 * rather than waiting for the sweep. And it spends a narrower bucket than the
 * owner's — this is egress billed to the sender, spendable by anybody they
 * ever shared with.
 */
export const shareDownloadUrl = mutation({
  args: {
    documentId: v.id('documents'),
    what: v.union(v.literal('document'), v.literal('cover')),
  },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'shareDownloadUrl');

    const { doc } = await requireDownloadable(ctx, user, args.documentId);
    const key = args.what === 'cover' ? doc.coverStorageKey : doc.storageKey;
    if (key === undefined) {
      return null;
    }
    return await r2.getUrl(key, { expiresIn: DOWNLOAD_URL_SECONDS });
  },
});

/**
 * A cover for a document in the inbox, before anything has been accepted.
 *
 * The one read a pending recipient gets of the file itself, and it is 600px of
 * JPEG rather than the PDF. It exists because an inbox of grey rectangles is an
 * inbox nobody can tell apart, and it is separate from `shareDownloadUrl`
 * because a cover is not governed by `canDownload` — refusing somebody the
 * thumbnail of a document you have just offered them makes no sense.
 */
export const shareCoverUrl = mutation({
  args: { documentId: v.id('documents') },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'shareDownloadUrl');

    const { doc } = await requireReadable(ctx, user, args.documentId);
    if (doc.coverStorageKey === undefined) {
      return null;
    }
    return await r2.getUrl(doc.coverStorageKey, { expiresIn: DOWNLOAD_URL_SECONDS });
  },
});

/** Marks events read, so the badge on Shared clears. */
export const markEventsRead = mutation({
  args: { eventIds: v.array(v.id('shareEvents')) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    for (const eventId of args.eventIds.slice(0, 100)) {
      const event = await ctx.db.get('shareEvents', eventId);
      // Somebody else's event is skipped rather than refused: a client marking
      // a stale list read should not fail the whole call over one row.
      if (event === null || event.userId !== user._id || event.readAt !== undefined) {
        continue;
      }
      await ctx.db.patch('shareEvents', eventId, { readAt: now });
    }
    return null;
  },
});

/**
 * The notes this reader wrote on other people's documents.
 *
 * `library.allAnnotations` walks `by_owner` and so returns everything on the
 * caller's *own* documents — including what their annotators wrote there. This
 * is the mirror: what the caller wrote on documents belonging to somebody else.
 * A device runs both to reconcile, and between them every annotation it is
 * entitled to hold is reachable exactly once. See `Annotations.allForAuthor`.
 */
export const myAnnotationsElsewhere = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(Annotations.ownedAnnotationValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await Annotations.allForAuthor(ctx, user._id, args.paginationOpts);
  },
});
