import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

/**
 * What an account has said about being reached, and about being told.
 *
 * **A row only exists once somebody has changed something.** The defaults are
 * the constants below rather than values written at sign-up, for two reasons:
 * a default that lives in a row has to be backfilled onto every existing
 * account when it changes, and a default that lives in code can be corrected
 * in one place the next time it is read. `ensureProfile` therefore writes no
 * settings, and every reader goes through `sharingOf` / `notificationsOf`,
 * which fill in what is missing.
 *
 * The two defaults worth defending:
 *
 * - **`findableBy: 'anyone'`** looks permissive and is not. Finding somebody is
 *   an exact match on a handle they chose or an address the caller already
 *   knows — never a listing, never a prefix over strangers. A sharing feature
 *   nobody can be found in does not work, and the protection belongs in the
 *   shape of the query rather than in a switch most people never open.
 * - **`defaultCanDownload` and `defaultCanReshare` are false**, because they
 *   are the two permissions that survive being taken away. Everything else
 *   stops the moment a row changes; a downloaded PDF is a file on a disk this
 *   deployment cannot reach.
 */

export type SharingSettings = Omit<Doc<'sharingSettings'>, '_id' | '_creationTime' | 'userId' | 'updatedAt'>;
export type NotificationSettings = Omit<
  Doc<'notificationSettings'>,
  '_id' | '_creationTime' | 'userId' | 'updatedAt'
>;

export const SHARING_DEFAULTS: SharingSettings = {
  findableBy: 'anyone',
  shareableBy: 'anyone',
  defaultRole: 'viewer',
  defaultCanDownload: false,
  defaultCanReshare: false,
  showOnlineStatus: true,
  /** Off. Nobody sees which page somebody is on; presence says here, not where. */
  showReadingActivity: false,
  allowGroupInvites: true,
};

export const NOTIFICATION_DEFAULTS: NotificationSettings = {
  allow: true,
  documentShares: true,
  shareResponses: true,
  groupActivity: true,
  /**
   * Off. An annotator working through a shared textbook writes tens of notes in
   * an evening, and a notification each is a notification nobody reads twice.
   * The activity is in the app; this is for things that need somebody told.
   */
  annotationActivity: false,
  quietStartMinute: undefined,
  quietEndMinute: undefined,
  utcOffsetMinutes: undefined,
};

export async function sharingOf(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
): Promise<SharingSettings> {
  const row = await ctx.db
    .query('sharingSettings')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique();
  return row === null ? SHARING_DEFAULTS : stripMeta(row, SHARING_DEFAULTS);
}

export async function notificationsOf(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
): Promise<NotificationSettings> {
  const row = await ctx.db
    .query('notificationSettings')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique();
  return row === null ? NOTIFICATION_DEFAULTS : stripMeta(row, NOTIFICATION_DEFAULTS);
}

/**
 * The stored row, reduced to the fields the defaults declare.
 *
 * Keyed off the defaults rather than off the row, so a field added to the
 * schema and forgotten here reads as its default instead of leaking `_id` and
 * `userId` into whatever the caller returns over the wire.
 */
function stripMeta<T extends object>(row: Record<string, unknown>, shape: T): T {
  const out = { ...shape } as Record<string, unknown>;
  for (const key of Object.keys(shape)) {
    if (row[key] !== undefined) {
      out[key] = row[key];
    }
  }
  return out as T;
}

/** Writes a partial change, creating the row the first time. */
export async function patchSharing(
  ctx: MutationCtx,
  userId: Id<'users'>,
  patch: Partial<SharingSettings>,
): Promise<void> {
  const row = await ctx.db
    .query('sharingSettings')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique();
  if (row === null) {
    await ctx.db.insert('sharingSettings', {
      userId,
      ...SHARING_DEFAULTS,
      ...patch,
      updatedAt: Date.now(),
    });
    return;
  }
  await ctx.db.patch('sharingSettings', row._id, { ...patch, updatedAt: Date.now() });
}

export async function patchNotifications(
  ctx: MutationCtx,
  userId: Id<'users'>,
  patch: Partial<NotificationSettings>,
): Promise<void> {
  const row = await ctx.db
    .query('notificationSettings')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique();
  if (row === null) {
    await ctx.db.insert('notificationSettings', {
      userId,
      ...NOTIFICATION_DEFAULTS,
      ...patch,
      updatedAt: Date.now(),
    });
    return;
  }
  await ctx.db.patch('notificationSettings', row._id, { ...patch, updatedAt: Date.now() });
}

/**
 * Whether two accounts share at least one group.
 *
 * The `groups` value of `findableBy` and `shareableBy` means "people I already
 * have something to do with", and this is that test. It walks the caller's own
 * memberships rather than the target's, because the caller's are what the
 * caller is entitled to know about — and it stops at the first match.
 *
 * Bounded by how many groups one person is in, which `GROUPS_PER_OWNER` bounds
 * for groups they own and membership bounds in practice for the rest.
 */
export async function sharesAGroup(
  ctx: QueryCtx | MutationCtx,
  a: Id<'users'>,
  b: Id<'users'>,
): Promise<boolean> {
  const mine = await ctx.db
    .query('groupMembers')
    .withIndex('by_user', (q) => q.eq('userId', a))
    .take(200);

  for (const membership of mine) {
    const theirs = await ctx.db
      .query('groupMembers')
      .withIndex('by_group_and_user', (q) => q.eq('groupId', membership.groupId).eq('userId', b))
      .unique();
    if (theirs !== null) {
      return true;
    }
  }
  return false;
}

/**
 * Whether `caller` is allowed to see that `target` exists.
 *
 * Asked before any search result is returned, and before a share is created
 * against somebody named by id — a caller who already knows an id must not get
 * a wider answer than a caller who had to look one up.
 */
export async function isFindableBy(
  ctx: QueryCtx | MutationCtx,
  target: Doc<'users'>,
  caller: Doc<'users'>,
): Promise<boolean> {
  if (target._id === caller._id) {
    return true;
  }
  const settings = await sharingOf(ctx, target._id);
  if (settings.findableBy === 'nobody') {
    return false;
  }
  if (settings.findableBy === 'anyone') {
    return true;
  }
  return await sharesAGroup(ctx, caller._id, target._id);
}

/** Whether `caller` may put a document in front of `target`. */
export async function isShareableBy(
  ctx: QueryCtx | MutationCtx,
  target: Doc<'users'>,
  caller: Doc<'users'>,
): Promise<boolean> {
  if (target._id === caller._id) {
    return false;
  }
  const settings = await sharingOf(ctx, target._id);
  if (settings.shareableBy === 'nobody') {
    return false;
  }
  if (settings.shareableBy === 'anyone') {
    return true;
  }
  return await sharesAGroup(ctx, caller._id, target._id);
}
