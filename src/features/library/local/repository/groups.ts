/**
 * Groups, on the device.
 *
 * A mirror rather than a source. Everything here is written by the reconcile
 * and read by a screen; the only local writes are the optimistic ones a
 * reader's own tap makes, which the outbox then delivers.
 *
 * That asymmetry is deliberate and different from `collections.ts`. A
 * collection is one person's filing and can be made in aeroplane mode with no
 * consequence. A group is a set of *other people*, and a group only this device
 * knows about is a group whose members have not agreed to be in it — so a
 * create is queued like anything else, but membership is never invented here.
 */
import { type SQLiteDatabase } from 'expo-sqlite';

import { mintId } from './ids';
import {
  asBool,
  asFlag,
  type LibraryGroup,
  type LibraryGroupMember,
  type SyncState,
} from './types';
import { inTransaction } from '../transaction';

type GroupRow = Omit<LibraryGroup, 'role' | 'syncState'> & {
  role: string | null;
  syncState: string;
};

const COLUMNS = 'id, remoteId, name, memberCount, role, createdAt, updatedAt, syncState';

function toGroup(row: GroupRow): LibraryGroup {
  return {
    ...row,
    role: (row.role as LibraryGroup['role']) ?? null,
    syncState: row.syncState as SyncState,
  };
}

export async function listGroups(db: SQLiteDatabase): Promise<LibraryGroup[]> {
  const rows = await db.getAllAsync<GroupRow>(
    `SELECT ${COLUMNS} FROM groupsLocal WHERE deletedAt IS NULL ORDER BY updatedAt DESC`,
  );
  return rows.map(toGroup);
}

export async function groupById(db: SQLiteDatabase, id: string): Promise<LibraryGroup | null> {
  const row = await db.getFirstAsync<GroupRow>(
    `SELECT ${COLUMNS} FROM groupsLocal WHERE id = ? OR remoteId = ? LIMIT 1`,
    [id, id],
  );
  return row === null ? null : toGroup(row);
}

export async function membersOf(
  db: SQLiteDatabase,
  groupId: string,
): Promise<LibraryGroupMember[]> {
  const rows = await db.getAllAsync<
    Omit<LibraryGroupMember, 'isOwner' | 'role'> & { isOwner: number; role: string }
  >(
    `SELECT groupId, userId, name, handle, pictureUrl, role, isOwner, addedAt
       FROM groupMembersLocal WHERE groupId = ?
      ORDER BY isOwner DESC, role ASC, addedAt ASC`,
    groupId,
  );
  return rows.map((row) => ({
    ...row,
    role: row.role as 'admin' | 'member',
    isOwner: asBool(row.isOwner),
  }));
}

/** A group this device made, before the account has heard of it. */
export async function createGroup(db: SQLiteDatabase, name: string): Promise<string> {
  const id = mintId();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO groupsLocal (id, name, memberCount, role, createdAt, updatedAt, clientUpdatedAt, syncState)
     VALUES (?, ?, 1, 'owner', ?, ?, ?, 'local')`,
    [id, name, now, now, now],
  );
  return id;
}

export async function renameGroup(
  db: SQLiteDatabase,
  id: string,
  name: string,
): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `UPDATE groupsLocal SET name = ?, updatedAt = ?, clientUpdatedAt = ?,
            syncState = CASE WHEN syncState = 'local' THEN 'local' ELSE 'pending' END
      WHERE id = ?`,
    [name, now, now, id],
  );
}

export async function removeGroup(db: SQLiteDatabase, id: string): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `UPDATE groupsLocal SET deletedAt = ?, updatedAt = ?, clientUpdatedAt = ?, syncState = 'pending'
      WHERE id = ?`,
    [now, now, now, id],
  );
  await db.runAsync('DELETE FROM groupMembersLocal WHERE groupId = ?', id);
}

export async function attachGroupRemoteId(
  db: SQLiteDatabase,
  id: string,
  remoteId: string,
): Promise<void> {
  await db.runAsync("UPDATE groupsLocal SET remoteId = ?, syncState = 'synced' WHERE id = ?", [
    remoteId,
    id,
  ]);
}

export async function upsertRemoteGroup(
  db: SQLiteDatabase,
  remote: {
    id: string;
    name: string;
    memberCount: number;
    role: LibraryGroup['role'];
    createdAt: number;
    updatedAt: number;
  },
): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string; syncState: string }>(
    'SELECT id, syncState FROM groupsLocal WHERE remoteId = ? OR id = ? LIMIT 1',
    [remote.id, remote.id],
  );
  if (existing !== null && existing.syncState === 'pending') {
    return;
  }

  if (existing === null) {
    await db.runAsync(
      `INSERT INTO groupsLocal (id, remoteId, name, memberCount, role, createdAt, updatedAt, clientUpdatedAt, syncState)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'synced')`,
      [remote.id, remote.id, remote.name, remote.memberCount, remote.role, remote.createdAt, remote.updatedAt],
    );
    return;
  }

  await db.runAsync(
    `UPDATE groupsLocal SET remoteId = ?, name = ?, memberCount = ?, role = ?,
            createdAt = ?, updatedAt = ?, deletedAt = NULL, syncState = 'synced'
      WHERE id = ?`,
    [remote.id, remote.name, remote.memberCount, remote.role, remote.createdAt, remote.updatedAt, existing.id],
  );
}

/**
 * Replaces a group's membership wholesale.
 *
 * A diff would be smaller and would be wrong: membership is the thing that
 * decides what somebody can open, so a member this device failed to notice
 * leaving is a member the reader still sees in a list of who can read their
 * document. Replacing is a handful of rows and cannot drift.
 */
export async function replaceMembers(
  db: SQLiteDatabase,
  groupId: string,
  members: LibraryGroupMember[],
): Promise<void> {
  await inTransaction(db, async (txn) => {
    await txn.runAsync('DELETE FROM groupMembersLocal WHERE groupId = ?', groupId);
    for (const member of members) {
      // `OR REPLACE`, because the primary key is (groupId, userId) and this is
      // a replace: one repeated id in the incoming list — or a row this pass
      // has already written — is a value to overwrite rather than a crash.
      // A plain INSERT here threw `UNIQUE constraint failed` out of an effect
      // as an unhandled rejection, which is a hard failure for a list that is
      // only a cache of what the account already told us.
      await txn.runAsync(
        `INSERT OR REPLACE INTO groupMembersLocal
           (groupId, userId, name, handle, pictureUrl, role, isOwner, addedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          groupId,
          member.userId,
          member.name,
          member.handle,
          member.pictureUrl,
          member.role,
          asFlag(member.isOwner),
          member.addedAt,
        ],
      );
    }
  });
}

/** Drops groups the account no longer has. */
export async function pruneGroups(
  db: SQLiteDatabase,
  keep: ReadonlySet<string>,
): Promise<void> {
  const rows = await db.getAllAsync<{ id: string; remoteId: string | null }>(
    "SELECT id, remoteId FROM groupsLocal WHERE syncState = 'synced' AND remoteId IS NOT NULL",
  );
  for (const row of rows) {
    if (row.remoteId !== null && !keep.has(row.remoteId)) {
      await db.runAsync('DELETE FROM groupMembersLocal WHERE groupId = ?', row.id);
      await db.runAsync('DELETE FROM groupsLocal WHERE id = ?', row.id);
    }
  }
}

/**
 * This device's own id for a group the account named.
 *
 * **The mirror keys everything by local id**, with `remoteId` as the one join
 * back to the account — a group created offline has a local id and no remote
 * one, so a mirror keyed the other way could not hold it at all. Everything
 * arriving from the account is therefore translated on the way in, and this is
 * the translation.
 *
 * It was there and unused, which is how a group came to read "0 members · 0
 * documents" while the account plainly held two of one and one of the other:
 * members and group shares were written under the *remote* id and read back
 * under the local one, so the two halves never met.
 */
export async function localIdFor(
  db: SQLiteDatabase,
  remoteId: string,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM groupsLocal WHERE remoteId = ? LIMIT 1',
    remoteId,
  );
  return row?.id ?? null;
}
