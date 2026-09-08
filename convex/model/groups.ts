import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { AuthError } from './auth';
import {
  GROUPS_PER_OWNER,
  GROUP_MEMBER_MAX,
  GROUP_DESCRIPTION_MAX,
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

export type GroupSettings = {
  description: string | null;
  whoCanAdd: 'owner' | 'admins' | 'members';
  whoCanShare: 'admins' | 'members';
  defaultRole: 'viewer' | 'annotator';
  defaultCanDownload: boolean;
  showMemberHandles: boolean;
  showPresence: boolean;
};

/**
 * What a group is, when nobody has changed anything.
 *
 * In code rather than written into every row, for the reason
 * `model/settings.ts` gives at length: a default that lives in a row has to be
 * backfilled onto every existing group when it changes.
 *
 * The one that is not the permissive option is `whoCanAdd`. Membership decides
 * what somebody can open, so a group where every member can add strangers is a
 * group whose owner has lost track of who can read their documents.
 */
export const GROUP_DEFAULTS: GroupSettings = {
  description: null,
  whoCanAdd: 'admins',
  whoCanShare: 'members',
  defaultRole: 'viewer',
  defaultCanDownload: false,
  showMemberHandles: true,
  showPresence: true,
};

export function settingsOf(group: Doc<'groups'>): GroupSettings {
  return {
    description: group.description ?? GROUP_DEFAULTS.description,
    whoCanAdd: group.whoCanAdd ?? GROUP_DEFAULTS.whoCanAdd,
    whoCanShare: group.whoCanShare ?? GROUP_DEFAULTS.whoCanShare,
    defaultRole: group.defaultRole ?? GROUP_DEFAULTS.defaultRole,
    defaultCanDownload: group.defaultCanDownload ?? GROUP_DEFAULTS.defaultCanDownload,
    showMemberHandles: group.showMemberHandles ?? GROUP_DEFAULTS.showMemberHandles,
    showPresence: group.showPresence ?? GROUP_DEFAULTS.showPresence,
  };
}

export type PublicGroup = {
  id: Id<'groups'>;
  name: string;
  memberCount: number;
  /** The caller's own standing in it. `null` for a group they can see but are not in. */
  role: 'owner' | 'admin' | 'member' | null;
  /** This member's own answer about being told, not the group's. */
  muted: boolean;
  settings: GroupSettings;
  createdAt: number;
  updatedAt: number;
};

export const groupSettingsValidator = v.object({
  description: v.union(v.string(), v.null()),
  whoCanAdd: v.union(v.literal('owner'), v.literal('admins'), v.literal('members')),
  whoCanShare: v.union(v.literal('admins'), v.literal('members')),
  defaultRole: v.union(v.literal('viewer'), v.literal('annotator')),
  defaultCanDownload: v.boolean(),
  showMemberHandles: v.boolean(),
  showPresence: v.boolean(),
});

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
  muted: v.boolean(),
  settings: groupSettingsValidator,
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
): Promise<{ group: Doc<'groups'>; role: 'owner' | 'admin' | 'member'; muted: boolean }> {
  const group = await ctx.db.get('groups', groupId);
  if (group === null) {
    refuse();
  }
  const role = await standingIn(ctx, user, group);
  if (role === null) {
    refuse();
  }
  // The caller's own membership row, for the one setting that lives on it. An
  // owner who is somehow not a member of their own group still gets an answer.
  const membership = await ctx.db
    .query('groupMembers')
    .withIndex('by_group_and_user', (q) => q.eq('groupId', groupId).eq('userId', user._id))
    .unique();
  return { group, role, muted: membership?.muted === true };
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
  muted = false,
): PublicGroup {
  return {
    id: group._id,
    name: group.name,
    memberCount: group.memberCount,
    role,
    muted,
    settings: settingsOf(group),
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
  const group = await ctx.db.get('groups', groupId);
  if (group === null) {
    refuse();
  }
  // **`whoCanAdd`, and it is the reason this no longer just calls
  // `requireAdmin`.** Membership decides what a person can open, so who may
  // grant it is the group's narrowest setting. `members` widens the door;
  // `owner` narrows it past what an admin can do, which is the point of having
  // it at all.
  const standing = await standingIn(ctx, user, group);
  const mayAdd =
    standing === 'owner' ||
    (settingsOf(group).whoCanAdd === 'admins' && standing === 'admin') ||
    (settingsOf(group).whoCanAdd === 'members' && standing !== null);
  if (!mayAdd) {
    refuse();
  }

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
/**
 * Changes the group's own settings. Owner or admin.
 *
 * Every field optional, for the reason `settings.updateSharing` gives: a screen
 * sends the switch that moved rather than the whole object, so two screens
 * racing on one row disagree about one value instead of about all of them.
 *
 * `whoCanAdd` is the one an admin can change and then be bound by, which is
 * deliberate — an admin narrowing it to `owner` is an admin giving up a power
 * they hold, and that needs no special case.
 */
export async function updateSettings(
  ctx: MutationCtx,
  user: Doc<'users'>,
  groupId: Id<'groups'>,
  patch: {
    description?: string;
    whoCanAdd?: 'owner' | 'admins' | 'members';
    whoCanShare?: 'admins' | 'members';
    defaultRole?: 'viewer' | 'annotator';
    defaultCanDownload?: boolean;
    showMemberHandles?: boolean;
    showPresence?: boolean;
  },
): Promise<void> {
  await requireAdmin(ctx, user, groupId);

  const written: Record<string, unknown> = { updatedAt: Date.now() };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      written[key] = value;
    }
  }
  if (patch.description !== undefined) {
    // Empty clears it rather than storing a blank line, the same way an empty
    // display name goes back to the Google claim.
    const trimmed = patch.description.trim();
    written.description =
      trimmed === '' ? undefined : cleanText(trimmed, GROUP_DESCRIPTION_MAX, 'description');
  }

  await ctx.db.patch('groups', groupId, written);
}

/**
 * This member's own answer about being told about this group.
 *
 * Any member, including one who cannot change anything else about the group:
 * it is a decision about their phone rather than about the group, which is why
 * it lives on the membership row and not beside the settings above.
 */
export async function setMuted(
  ctx: MutationCtx,
  user: Doc<'users'>,
  groupId: Id<'groups'>,
  muted: boolean,
): Promise<void> {
  await requireMember(ctx, user, groupId);
  const membership = await ctx.db
    .query('groupMembers')
    .withIndex('by_group_and_user', (q) => q.eq('groupId', groupId).eq('userId', user._id))
    .unique();
  if (membership === null) {
    refuse();
  }
  await ctx.db.patch('groupMembers', membership._id, { muted });
}

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
      toPublicGroup(
        group,
        group.ownerId === user._id ? 'owner' : membership.role,
        membership.muted === true,
      ),
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
  // **`showMemberHandles`.** A group is the one place this deployment shows one
  // account to another without either having searched for the other. The name
  // and the face are what the list is for; the handle is the part somebody
  // could use to find them again outside it, so it is the part a group can
  // withhold.
  const handles = settingsOf(group).showMemberHandles;
  for (const member of members) {
    const profile = await profileOf(ctx, member.userId);
    out.push({
      profile: profile === null || handles ? profile : { ...profile, handle: null },
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
