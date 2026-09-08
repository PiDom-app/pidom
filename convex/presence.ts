import { Presence } from '@convex-dev/presence';
import { ConvexError, v } from 'convex/values';

import { components } from './_generated/api';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { AuthError, requireUser } from './model/auth';
import { accessOf } from './model/access';
import { PRESENCE_INTERVAL_MIN_MS, PRESENCE_INTERVAL_MS } from './model/limits';
import { limit } from './model/rateLimits';
import { sharingOf } from './model/settings';

/**
 * Who else is here, right now.
 *
 * The component keeps the state; this file is the door in front of it. Three
 * things about that door are worth stating outright, because each of them is a
 * hole if it is left out.
 *
 * **The client sends a `userId` and it is thrown away.** The React Native hook's
 * signature is `usePresence(api, roomId, userId, interval)`, so a user id
 * crosses the wire on every heartbeat — and a client that can name whose
 * presence it is recording can put anybody in any room. The argument is
 * accepted because the hook sends it, ignored because it is the client's, and
 * replaced with the `users` row resolved from the verified JWT.
 *
 * **A room is not a capability.** `document:<id>` is guessable — a Convex id in
 * a string — so knowing one grants nothing. Every heartbeat resolves the room
 * back to a document or a group and runs the same access check the reader does.
 *
 * **`disconnect` is deliberately unauthenticated.** The hook tears a session
 * down with a bare `fetch` to `/api/mutation` carrying no auth header, at
 * `path: "presence:disconnect"` — a hardcoded string, which is why this file is
 * named what it is and why that export cannot be renamed. What makes it safe is
 * that a session token is minted by the component and unguessable, and the only
 * thing it authorises is ending the session it names. Putting `requireUser` in
 * front of it would not add a check; it would break every clean disconnect and
 * leave rooms full of people who have closed the app.
 */

export const presence = new Presence(components.presence);

/** `document:<id>` or `group:<id>`. Anything else is refused rather than created. */
type Room =
  | { kind: 'document'; documentId: Id<'documents'> }
  | { kind: 'group'; groupId: Id<'groups'> };

/**
 * Takes a room name apart, without trusting either half.
 *
 * `normalizeId` rather than a cast: `ctx.db.get` on a string that is not an id
 * of that table throws, and a thrown validator is a different answer than
 * `FORBIDDEN` — one says "that is not an id", the other says nothing at all.
 */
function parseRoom(ctx: QueryCtx | MutationCtx, roomId: string): Room | null {
  const separator = roomId.indexOf(':');
  if (separator <= 0) {
    return null;
  }
  const kind = roomId.slice(0, separator);
  const rest = roomId.slice(separator + 1);

  if (kind === 'document') {
    const documentId = ctx.db.normalizeId('documents', rest);
    return documentId === null ? null : { kind: 'document', documentId };
  }
  if (kind === 'group') {
    const groupId = ctx.db.normalizeId('groups', rest);
    return groupId === null ? null : { kind: 'group', groupId };
  }
  return null;
}

/** Whether this account may be in this room at all. */
async function mayEnter(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  room: Room,
): Promise<boolean> {
  if (room.kind === 'document') {
    return (await accessOf(ctx, user, room.documentId)) !== null;
  }
  const membership = await ctx.db
    .query('groupMembers')
    .withIndex('by_group_and_user', (q) =>
      q.eq('groupId', room.groupId).eq('userId', user._id),
    )
    .unique();
  return membership !== null;
}

function refuse(): never {
  throw new ConvexError({ code: AuthError.forbidden });
}

/**
 * "Still here."
 *
 * Returns the two tokens the hook needs: a room token it lists with, and a
 * session token it disconnects with. Both come from the component and neither
 * is derived from anything the caller sent, so a token cannot be forged into a
 * room the caller was refused.
 *
 * An account that has asked not to be seen is not refused — it is simply not
 * recorded. Refusing would make the reader's own client retry forever; this way
 * they read the document, see who else is there, and are not themselves in the
 * list. The tokens still come back so the hook has something to hold, and the
 * room token still lists, because seeing others and being seen are two
 * different permissions and both settings are only about the second.
 *
 * **There are two settings, and they are not the same question.**
 * `showOnlineStatus` is whether this account appears beside its name anywhere —
 * a member list, a Manage access row. `showReadingActivity` is narrower and is
 * about a *document*: whether being in a PDF right now is something other
 * people get to see. Somebody can reasonably want the first and not the second,
 * which is why the default for the second is off. Until now it governed nothing
 * at all — it was a switch on a settings screen wired to no behaviour, which is
 * worse than not offering it.
 */
export const heartbeat = mutation({
  args: {
    roomId: v.string(),
    /**
     * The client's idea of who it is. Ignored — see the note at the top of this
     * file. It is declared because the hook sends it and an undeclared argument
     * is a validation error, not because anything reads it.
     */
    userId: v.string(),
    sessionId: v.string(),
    interval: v.number(),
  },
  returns: v.object({ roomToken: v.string(), sessionToken: v.string() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await limit(ctx, user, 'presence');

    const room = parseRoom(ctx, args.roomId);
    if (room === null || !(await mayEnter(ctx, user, room))) {
      refuse();
    }

    // A client asking for a one-second heartbeat is asking this deployment for
    // a mutation per second per open document. The floor is the server's.
    const interval = Math.max(
      PRESENCE_INTERVAL_MIN_MS,
      Number.isFinite(args.interval) ? args.interval : PRESENCE_INTERVAL_MS,
    );

    const settings = await sharingOf(ctx, user._id);
    // A document room is the narrower question, so it takes both answers. A
    // group room asks only the general one: being listed as a member who is
    // around says nothing about what anybody is reading.
    const visible =
      settings.showOnlineStatus &&
      (room.kind === 'group' || settings.showReadingActivity);

    if (!visible) {
      // Enter, then leave. The component hands back the tokens the hook needs
      // and the room is left without this account in it — invisible rather
      // than refused, which is what the setting says.
      const tokens = await presence.heartbeat(
        ctx,
        args.roomId,
        user._id,
        args.sessionId,
        interval,
      );
      await presence.removeRoomUser(ctx, args.roomId, user._id);
      return tokens;
    }

    return await presence.heartbeat(ctx, args.roomId, user._id, args.sessionId, interval);
  },
});

/**
 * Who is in the room this token names.
 *
 * The token is the authorisation: it was minted by `heartbeat`, which checked
 * access, and it cannot be constructed. That is why this takes no room id — a
 * room id is guessable and a token is not.
 *
 * No screen calls it. `usePresence` does: the hook's `PresenceAPI` requires
 * `list` and holds the room token privately, which is why `inRoom` below exists
 * alongside it for the face row, taking a room id and running the check itself.
 */
export const list = query({
  args: { roomToken: v.string() },
  returns: v.array(
    v.object({
      userId: v.string(),
      online: v.boolean(),
      lastDisconnected: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const state = await presence.list(ctx, args.roomToken);
    return state.map((entry) => ({
      userId: entry.userId,
      online: entry.online,
      lastDisconnected: entry.lastDisconnected,
    }));
  },
});

/**
 * Ends a session.
 *
 * Unauthenticated, and it has to be — see the note at the top of this file. The
 * export name is load-bearing: the React Native hook POSTs to the literal path
 * `presence:disconnect` when the app backgrounds or the screen unmounts.
 */
export const disconnect = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await presence.disconnect(ctx, args.sessionToken);
    return null;
  },
});

/**
 * The profiles behind a room's user ids, so a face row can render names.
 *
 * Separate from `list` because the component's state is ids and booleans and
 * knows nothing about accounts — and because this is a read of *other people*,
 * so it goes through the one projection `Discovery.toPublicProfile` defines
 * rather than each caller picking fields off a `users` row.
 *
 * It takes a **room id** rather than a room token, and that is not a
 * weakening. The React Native hook keeps its room token to itself — it returns
 * presence state and nothing else — so a token is not something a screen can
 * hand back. A room id is guessable, which is exactly why this runs the same
 * `mayEnter` check `heartbeat` does before it reads anything.
 */
export const inRoom = query({
  args: { roomId: v.string() },
  returns: v.array(
    v.object({
      id: v.id('users'),
      displayName: v.string(),
      handle: v.union(v.string(), v.null()),
      pictureUrl: v.union(v.string(), v.null()),
      online: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const room = parseRoom(ctx, args.roomId);
    if (room === null || !(await mayEnter(ctx, user, room))) {
      refuse();
    }

    // `listRoom` rather than `list`: the component's own docs call it a helper
    // that carries no authentication of its own, which is precisely why the
    // check above is here and not left to a token.
    const state = await presence.listRoom(ctx, args.roomId, true);

    const out = [];
    for (const entry of state) {
      // The component stores whatever string `heartbeat` gave it, which is
      // always a `users` id — but it is read back through `normalizeId` rather
      // than cast, because a component's table is not this schema's.
      const id = ctx.db.normalizeId('users', entry.userId);
      if (id === null || id === user._id) {
        continue;
      }
      const person = await ctx.db.get('users', id);
      if (person === null) {
        continue;
      }
      out.push({
        id: person._id,
        displayName: person.name ?? (person.handle === undefined ? 'Someone' : `@${person.handle}`),
        handle: person.handle ?? null,
        pictureUrl: person.pictureUrl ?? null,
        online: entry.online,
      });
    }
    return out;
  },
});
