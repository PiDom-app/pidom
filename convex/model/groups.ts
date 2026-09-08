import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { AuthError } from './auth';
import {
  GROUPS_PER_OWNER,
  GROUP_MEMBER_MAX,
  GROUP_NAME_MAX,
  SHARE_LIST_LIMIT,
  cleanText,
  invalid,
} from './limits';
import { type PublicProfile, profileOf } from './discovery';
import { sharingOf } from './settings';
import { clientClock, isStale } from './sync';

/**
 * A named set of people, and what may be done to it.
 *
 * A group holds no documents. It appears in `documentShares` exactly the way a
 * person does, and access through it is resolved by looking up membership at
 * the moment somebody asks — which is the whole reason it exists. Removing
 * somebody from a group of six that shares four documents is one row deleted,
 * not twenty-four; and nothing has to remember to run.
 *
 * Three roles, and only two of them are stored. `member` and `admin` live on
 * `groupMembers`; owner is `groups.ownerId` and is deliberately not a role,
 * because an owner who demoted themselves would be a group nobody can
 * administer and nobody can delete.
 */

export type PublicGroup = {
  id: Id<'groups'>;
  name: string;
  memberCount: number;
  /** The caller's own standing in it. `null` for a group they can see but are not in. */
  role: 'owner' | 'admin' | 'member' | null;
  createdAt: number;
  updatedAt: number;
};

export const publicGroupValidator = v.object({
  id: v.id('groups'),
  name: v.string(),
  memberCount: v.number(),
  role: v.union(
    v.literal('owner'),
    v.literal('admin'),
    v.literal('member'),
    v.null(),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const publicMemberValidator = v.object({
  profile: v.union(
    v.object({
      id: v.id('users'),
      displayName: v.string(),
      handle: v.union(v.string(), v.null()),
      pictureUrl: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  role: v.union(v.literal('admin'), v.literal('member')),
  isOwner: v.boolean(),
  addedAt: v.number(),
});

function refuse(): never {
  throw new ConvexError({ code: AuthError.forbidden });
}

/** The caller's standing, or `null` if they have none. */
export async function standingIn(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  group: Doc<'groups'>,
): Promise<'owner' | 'admin' | 'member' | null> {
  if (group.ownerId === user._id) {
    return 'owner';
  }
  const membership = await ctx.db
    .query('groupMembers')
    .withIndex('by_group_and_user', (q) => q.eq('groupId', group._id).eq('userId', user._id))
    .unique();
  return membership === null ? null : membership.role;
}

/** A group the caller belongs to in any capacity. Reading requires membership. */
export async function requireMember(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  groupId: Id<'groups'>,
): Promise<{ group: Doc<'groups'>; role: 'owner' | 'admin' | 'member' }> {
  const group = await ctx.db.get('groups', groupId);
  if (group === null) {
    refuse();
  }
  const role = await standingIn(ctx, user, group);
  if (role === null) {
    refuse();
  }
  return { group, role };
}

/** A group the caller can change. Owner or admin; a member is refused. */
export async function requireAdmin(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  groupId: Id<'groups'>,
): Promise<Doc<'groups'>> {
  const { group, role } = await requireMember(ctx, user, groupId);
  if (role === 'member') {
    refuse();
  }
  return group;
}

export function toPublicGroup(
  group: Doc<'groups'>,
  role: 'owner' | 'admin' | 'member' | null,
): PublicGroup {
  return {
    id: group._id,
    name: group.name,
    memberCount: group.memberCount,
    role,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

/**
 * A new group, with its creator already in it.
 *
 * The owner is inserted as an `admin` member as well as being `ownerId`. That
 * looks redundant and is not: every membership walk — access resolution, the
 * fan-out, `sharesAGroup` — reads `groupMembers`, and an owner who is not a row
 * in it would be absent from their own group everywhere except the header.
 *
 * Idempotent on `clientOpId`, for the reason collections are: two groups may
 * legitimately share a name, so there is no natural key, and a create whose
 * reply was lost would otherwise leave two half-populated groups.
 */
export async function create(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  input: { name: string; clientOpId?: string; clientUpdatedAt?: number },
): Promise<Id<'groups'>> {
  if (input.clientOpId !== undefined) {
    const existing = await ctx.db
      .query('groups')
      .withIndex('by_owner_and_op', (q) =>
        q.eq('ownerId', owner._id).eq('clientOpId', input.clientOpId),
      )
      .unique();
    if (existing !== null) {
      return existing._id;
    }
  }

  const mine = await ctx.db
    .query('groups')
    .withIndex('by_owner', (q) => q.eq('ownerId', owner._id))
    .take(GROUPS_PER_OWNER + 1);
  if (mine.length > GROUPS_PER_OWNER) {
    invalid(`You can have at most ${GROUPS_PER_OWNER} groups.`);
  }

  const now = Date.now();
  const groupId = await ctx.db.insert('groups', {
    ownerId: owner._id,
    name: cleanText(input.name, GROUP_NAME_MAX, 'Group name'),
    memberCount: 1,
    clientOpId: input.clientOpId,
    ...clientClock(input.clientUpdatedAt),
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.insert('groupMembers', {
    groupId,
    userId: owner._id,
    role: 'admin',
    addedBy: owner._id,
    addedAt: now,
  });

  return groupId;
}

export async function rename(
  ctx: MutationCtx,
  user: Doc<'users'>,
  groupId: Id<'groups'>,
  name: string,
  clientUpdatedAt?: number,
): Promise<void> {
  const group = await requireAdmin(ctx, user, groupId);
  if (isStale(group.clientUpdatedAt, clientUpdatedAt)) {
    return;
  }
  await ctx.db.patch('groups', group._id, {
    name: cleanText(name, GROUP_NAME_MAX, 'Group name'),
    ...clientClock(clientUpdatedAt),
    updatedAt: Date.now(),
  });
}

/**
 * Deletes a group, its memberships, and every share that went through it.
 *
 * Owner only — an admin can add and remove people, and taking four documents
 * away from six people at once is a different kind of act.
 *
 * The share rows go too, rather than being left pointing at a group that no
 * longer exists. A dangling group share resolves to no membership and so grants
 * nothing, which is safe; but it would sit in the owner's Manage Access list
 * forever, naming a group nobody can open.
 */
export async function remove(
  ctx: MutationCtx,
  user: Doc<'users'>,
  groupId: Id<'groups'>,
): Promise<void> {
  const group = await ctx.db.get('groups', groupId);
  if (group === null || group.ownerId !== user._id) {
    refuse();
  }

  const members = await ctx.db
    .query('groupMembers')
    .withIndex('by_group_and_added', (q) => q.eq('groupId', groupId))
    .take(GROUP_MEMBER_MAX);
  for (const member of members) {
    await ctx.db.delete('groupMembers', member._id);
  }

  const shares = await ctx.db
    .query('documentShares')
    .withIndex('by_group', (q) => q.eq('groupId', groupId))
    .take(SHARE_LIST_LIMIT);
  for (const share of shares) {
    await ctx.db.delete('documentShares', share._id);
  }

  await ctx.db.delete('groups', groupId);
}

/**
 * Adds somebody, if they have not said no to being added.
 *
 * `allowGroupInvites` is checked against the *target's* settings rather than
 * the caller's, and refused as `FORBIDDEN` rather than as a message naming the
 * setting — a refusal that explains itself is a refusal that confirms the
 * account exists.
 */
export async function addMember(
  ctx: MutationCtx,
  user: Doc<'users'>,
  groupId: Id<'groups'>,
  userId: Id<'users'>,
): Promise<void> {
  const group = await requireAdmin(ctx, user, groupId);

  const target = await ctx.db.get('users', userId);
  if (target === null) {
    refuse();
  }
  const settings = await sharingOf(ctx, target._id);
  if (!settings.allowGroupInvites && target._id !== user._id) {
    refuse();
  }

  const already = await ctx.db
    .query('groupMembers')
    .withIndex('by_group_and_user', (q) => q.eq('groupId', groupId).eq('userId', userId))
    .unique();
  if (already !== null) {
    return;
  }

  if (group.memberCount >= GROUP_MEMBER_MAX) {
    invalid(`A group can hold at most ${GROUP_MEMBER_MAX} people.`);
  }

  await ctx.db.insert('groupMembers', {
    groupId,
    userId,
    role: 'member',
    addedBy: user._id,
    addedAt: Date.now(),
  });
  await ctx.db.patch('groups', groupId, {
    memberCount: group.memberCount + 1,
    updatedAt: Date.now(),
  });
}

/**
 * Removes somebody, or lets them leave.
 *
 * Both are this function, because they are the same write and differ only in
 * who is allowed to make it — an admin removing anybody, or anybody removing
 * themselves. The owner cannot be removed at all, including by themselves:
 * leaving a group you own is deleting it, and that is `remove`.
 */
export async function removeMember(
  ctx: MutationCtx,
  user: Doc<'users'>,
  groupId: Id<'groups'>,
  userId: Id<'users'>,
): Promise<void> {
  const group = await ctx.db.get('groups', groupId);
  if (group === null) {
    refuse();
  }
  const standing = await standingIn(ctx, user, group);
  if (standing === null) {
    refuse();
  }
  const leaving = userId === user._id;
  if (!leaving && standing === 'member') {
    refuse();
  }
  if (userId === group.ownerId) {
    refuse();
  }

  const membership = await ctx.db
    .query('groupMembers')
    .withIndex('by_group_and_user', (q) => q.eq('groupId', groupId).eq('userId', userId))
    .unique();
  if (membership === null) {
    return;
  }

  await ctx.db.delete('groupMembers', membership._id);
  await ctx.db.patch('groups', groupId, {
    memberCount: Math.max(0, group.memberCount - 1),
    updatedAt: Date.now(),
  });
}

/** Promotes or demotes. Owner only — an admin cannot make another admin. */
export async function setRole(
  ctx: MutationCtx,
  user: Doc<'users'>,
  groupId: Id<'groups'>,
  userId: Id<'users'>,
  role: 'admin' | 'member',
): Promise<void> {
  const group = await ctx.db.get('groups', groupId);
  if (group === null || group.ownerId !== user._id || userId === group.ownerId) {
    refuse();
  }
  const membership = await ctx.db
    .query('groupMembers')
    .withIndex('by_group_and_user', (q) => q.eq('groupId', groupId).eq('userId', userId))
    .unique();
  if (membership === null) {
    refuse();
  }
  await ctx.db.patch('groupMembers', membership._id, { role });
  await ctx.db.patch('groups', groupId, { updatedAt: Date.now() });
}

/** Every group the caller is in, owned or not. */
export async function listForUser(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
): Promise<PublicGroup[]> {
  const memberships = await ctx.db
    .query('groupMembers')
    .withIndex('by_user', (q) => q.eq('userId', user._id))
    .take(GROUPS_PER_OWNER * 4);

  const out: PublicGroup[] = [];
  for (const membership of memberships) {
    const group = await ctx.db.get('groups', membership.groupId);
    if (group === null) {
      continue;
    }
    out.push(
      toPublicGroup(group, group.ownerId === user._id ? 'owner' : membership.role),
    );
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function membersOf(
  ctx: QueryCtx | MutationCtx,
  group: Doc<'groups'>,
): Promise<
  { profile: PublicProfile | null; role: 'admin' | 'member'; isOwner: boolean; addedAt: number }[]
> {
  const members = await ctx.db
    .query('groupMembers')
    .withIndex('by_group_and_added', (q) => q.eq('groupId', group._id))
    .take(GROUP_MEMBER_MAX);

  const out: {
    profile: PublicProfile | null;
    role: 'admin' | 'member';
    isOwner: boolean;
    addedAt: number;
  }[] = [];
  for (const member of members) {
    out.push({
      profile: await profileOf(ctx, member.userId),
      role: member.role,
      isOwner: member.userId === group.ownerId,
      addedAt: member.addedAt,
    });
  }
  // The owner first, then admins, then everybody in the order they joined.
  return out.sort((a, b) => {
    const rank = (m: (typeof out)[number]) => (m.isOwner ? 0 : m.role === 'admin' ? 1 : 2);
    return rank(a) - rank(b) || a.addedAt - b.addedAt;
  });
}
