/**
 * Grants, on the device.
 *
 * The row carries a copy of the document's title, size and page count, and that
 * is the whole reason the inbox opens with no connection: a share the reader
 * has not accepted has no local file and no `documents` row, so without those
 * fields there would be nothing to draw but a name and a grey rectangle.
 *
 * **`documentId` here is the account's id, not a local one.** Until a share is
 * accepted and downloaded there is no local document to have an id, and after
 * it is, `documents.shareId` points back the other way. Nothing in this file is
 * a path, and nothing in it decides whether a file is on disk — that stays the
 * filesystem's answer, as it is for every other document.
 */
import { type SQLiteDatabase } from 'expo-sqlite';

import { mintId } from './ids';
import {
  asBool,
  asFlag,
  type LibraryShare,
  type ShareRole,
  type ShareStatus,
  type SyncState,
} from './types';
import * as Groups from './groups';

type ShareRow = Omit<
  LibraryShare,
  'hasCover' | 'canDownload' | 'canReshare' | 'role' | 'status' | 'direction' | 'subject' | 'syncState'
> & {
  hasCover: number;
  canDownload: number;
  canReshare: number;
  role: string;
  status: string;
  direction: string;
  subject: string;
  syncState: string;
};

const COLUMNS = `
  id, remoteId, documentId, direction, subject,
  counterpartId, counterpartName, counterpartHandle, counterpartPictureUrl,
  groupId, groupName, title, author, pageCount, byteSize, hasCover,
  role, canDownload, canReshare, status, message, expiresAt, revokedAt,
  createdAt, updatedAt, clientUpdatedAt, syncState
`;

function toShare(row: ShareRow): LibraryShare {
  return {
    ...row,
    direction: row.direction as 'incoming' | 'outgoing',
    subject: row.subject as 'user' | 'group',
    hasCover: asBool(row.hasCover),
    canDownload: asBool(row.canDownload),
    canReshare: asBool(row.canReshare),
    role: row.role as ShareRole,
    status: row.status as ShareStatus,
    syncState: row.syncState as SyncState,
  };
}

/** What the inbox renders. Everything shared with this reader, newest change first. */
export async function incoming(db: SQLiteDatabase): Promise<LibraryShare[]> {
  const rows = await db.getAllAsync<ShareRow>(
    `SELECT ${COLUMNS} FROM shares
      WHERE direction = 'incoming' AND deletedAt IS NULL
      ORDER BY updatedAt DESC`,
  );
  return rows.map(toShare);
}

/** The ones still waiting on an answer. The badge, and the Pending segment. */
export async function pending(db: SQLiteDatabase): Promise<LibraryShare[]> {
  const rows = await db.getAllAsync<ShareRow>(
    `SELECT ${COLUMNS} FROM shares
      WHERE direction = 'incoming' AND status = 'pending' AND deletedAt IS NULL
      ORDER BY createdAt DESC`,
  );
  return rows.map(toShare);
}

/** What this reader has shared out. */
export async function outgoing(db: SQLiteDatabase): Promise<LibraryShare[]> {
  const rows = await db.getAllAsync<ShareRow>(
    `SELECT ${COLUMNS} FROM shares
      WHERE direction = 'outgoing' AND deletedAt IS NULL
      ORDER BY updatedAt DESC`,
  );
  return rows.map(toShare);
}

export async function shareById(db: SQLiteDatabase, id: string): Promise<LibraryShare | null> {
  const row = await db.getFirstAsync<ShareRow>(
    `SELECT ${COLUMNS} FROM shares WHERE id = ? OR remoteId = ? LIMIT 1`,
    [id, id],
  );
  return row === null ? null : toShare(row);
}

/**
 * The live grant on one document, if there is one.
 *
 * Used by the reader to decide whether a shared document still opens and what
 * the reader may do with it. It is a *hint*: the account re-resolves the same
 * question on every call that grants anything, so a stale local row cannot let
 * anybody past a server-side check. What it is for is not offering a button
 * that would be refused.
 */
export async function grantFor(
  db: SQLiteDatabase,
  documentId: string,
): Promise<LibraryShare | null> {
  const row = await db.getFirstAsync<ShareRow>(
    `SELECT ${COLUMNS} FROM shares
      WHERE documentId = ? AND direction = 'incoming' AND deletedAt IS NULL
      ORDER BY updatedAt DESC LIMIT 1`,
    documentId,
  );
  return row === null ? null : toShare(row);
}

/**
 * Whether this document has anything to do with anybody else.
 *
 * Both ids, because the two directions store different ones: an outgoing share
 * names the sender's own local document id, and an incoming one names the
 * account's. A document that is neither is a document nobody shares — which is
 * nearly all of them, and the reason the reader asks this before joining a
 * presence room. A heartbeat every ten seconds to tell an empty room that one
 * person is in it is work nobody asked for.
 */
export async function isShared(
  db: SQLiteDatabase,
  localId: string,
  remoteId: string | null,
): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT 1 AS n FROM shares
      WHERE deletedAt IS NULL
        AND status IN ('pending', 'accepted')
        AND (documentId = ? OR (? IS NOT NULL AND documentId = ?))
      LIMIT 1`,
    [localId, remoteId, remoteId],
  );
  return row !== null;
}

export type NewShare = {
  documentId: string | null;
  direction: 'incoming' | 'outgoing';
  subject: 'user' | 'group';
  counterpartId?: string | null;
  counterpartName?: string | null;
  counterpartHandle?: string | null;
  counterpartPictureUrl?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  title?: string | null;
  author?: string | null;
  pageCount?: number | null;
  byteSize?: number;
  hasCover?: boolean;
  role: ShareRole;
  canDownload: boolean;
  canReshare: boolean;
  message?: string | null;
  expiresAt?: number | null;
};

/**
 * Records a share this device is making, before the account has heard of it.
 *
 * `syncState` starts `local`, like every other create here: the outbox is what
 * turns it into something the recipient can see, and until it drains the row
 * exists so the sender's own Sent list is honest about what they asked for.
 */
export async function addLocalShare(db: SQLiteDatabase, next: NewShare): Promise<string> {
  const id = mintId();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO shares (
       id, documentId, direction, subject, counterpartId, counterpartName,
       counterpartHandle, counterpartPictureUrl, groupId, groupName,
       title, author, pageCount, byteSize, hasCover,
       role, canDownload, canReshare, status, message, expiresAt,
       createdAt, updatedAt, clientUpdatedAt, syncState
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local')`,
    [
      id,
      next.documentId,
      next.direction,
      next.subject,
      next.counterpartId ?? null,
      next.counterpartName ?? null,
      next.counterpartHandle ?? null,
      next.counterpartPictureUrl ?? null,
      next.groupId ?? null,
      next.groupName ?? null,
      next.title ?? null,
      next.author ?? null,
      next.pageCount ?? null,
      next.byteSize ?? 0,
      asFlag(next.hasCover ?? false),
      next.role,
      asFlag(next.canDownload),
      asFlag(next.canReshare),
      // A group share is live the moment it is made — membership is the
      // agreement — so there is nobody to answer it. A person's is pending.
      next.subject === 'group' ? 'accepted' : 'pending',
      next.message ?? null,
      next.expiresAt ?? null,
      now,
      now,
      now,
    ],
  );
  return id;
}

/**
 * Records the reader's answer locally, before it reaches the account.
 *
 * Optimistic on purpose: accepting a share offline should move it out of
 * Pending straight away, and the outbox delivers the answer when it can. If the
 * account refuses — the share was revoked in the meantime — the next reconcile
 * overwrites this with the truth.
 */
export async function answerLocally(
  db: SQLiteDatabase,
  id: string,
  answer: 'accept' | 'decline',
): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `UPDATE shares SET status = ?, updatedAt = ?, clientUpdatedAt = ?,
            syncState = CASE WHEN syncState = 'local' THEN 'local' ELSE 'pending' END
      WHERE id = ?`,
    [answer === 'accept' ? 'accepted' : 'declined', now, now, id],
  );
}

/** Marks one revoked locally, for the same reason `answerLocally` exists. */
export async function revokeLocally(db: SQLiteDatabase, id: string): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `UPDATE shares SET status = 'revoked', revokedAt = ?, updatedAt = ?, clientUpdatedAt = ?,
            syncState = CASE WHEN syncState = 'local' THEN 'local' ELSE 'pending' END
      WHERE id = ?`,
    [now, now, now, id],
  );
}

export async function setPermissionLocally(
  db: SQLiteDatabase,
  id: string,
  next: { role: ShareRole; canDownload: boolean; canReshare: boolean },
): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `UPDATE shares SET role = ?, canDownload = ?, canReshare = ?, updatedAt = ?, clientUpdatedAt = ?,
            syncState = CASE WHEN syncState = 'local' THEN 'local' ELSE 'pending' END
      WHERE id = ?`,
    [next.role, asFlag(next.canDownload), asFlag(next.canReshare), now, now, id],
  );
}

/** The account's id for a row this device created, once the create lands. */
export async function attachShareRemoteId(
  db: SQLiteDatabase,
  id: string,
  remoteId: string,
): Promise<void> {
  await db.runAsync("UPDATE shares SET remoteId = ?, syncState = 'synced' WHERE id = ?", [
    remoteId,
    id,
  ]);
}

export type RemoteShare = LibraryShare & { remoteId: string };

/**
 * Writes what the account says, without clobbering what this device has not sent.
 *
 * The same rule `upsertRemoteAnnotation` follows, and for the same reason: a
 * reconcile that overwrote a pending local change would silently undo a reader
 * who accepted a share in a tunnel.
 */
export async function upsertRemoteShare(
  db: SQLiteDatabase,
  remote: RemoteShare,
): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string; syncState: string }>(
    'SELECT id, syncState FROM shares WHERE remoteId = ? OR id = ? LIMIT 1',
    [remote.remoteId, remote.remoteId],
  );

  if (existing !== null && existing.syncState === 'pending') {
    return;
  }

  // The account names the group by its own id; every reader here asks by this
  // device's. Translating on the way in is what keeps `groupId` meaning one
  // thing in this database. See `Groups.localIdFor`.
  const groupId =
    remote.groupId == null ? null : ((await Groups.localIdFor(db, remote.groupId)) ?? remote.groupId);

  const values = [
    remote.documentId,
    remote.direction,
    remote.subject,
    remote.counterpartId,
    remote.counterpartName,
    remote.counterpartHandle,
    remote.counterpartPictureUrl,
    groupId,
    remote.groupName,
    remote.title,
    remote.author,
    remote.pageCount,
    remote.byteSize,
    asFlag(remote.hasCover),
    remote.role,
    asFlag(remote.canDownload),
    asFlag(remote.canReshare),
    remote.status,
    remote.message,
    remote.expiresAt,
    remote.revokedAt,
    remote.createdAt,
    remote.updatedAt,
  ];

  if (existing === null) {
    await db.runAsync(
      `INSERT INTO shares (
         id, remoteId, documentId, direction, subject, counterpartId, counterpartName,
         counterpartHandle, counterpartPictureUrl, groupId, groupName,
         title, author, pageCount, byteSize, hasCover,
         role, canDownload, canReshare, status, message, expiresAt, revokedAt,
         createdAt, updatedAt, clientUpdatedAt, syncState
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'synced')`,
      [remote.remoteId, remote.remoteId, ...values],
    );
    return;
  }

  await db.runAsync(
    `UPDATE shares SET
       remoteId = ?, documentId = ?, direction = ?, subject = ?, counterpartId = ?,
       counterpartName = ?, counterpartHandle = ?, counterpartPictureUrl = ?,
       groupId = ?, groupName = ?, title = ?, author = ?, pageCount = ?, byteSize = ?,
       hasCover = ?, role = ?, canDownload = ?, canReshare = ?, status = ?, message = ?,
       expiresAt = ?, revokedAt = ?, createdAt = ?, updatedAt = ?,
       deletedAt = NULL, syncState = 'synced'
     WHERE id = ?`,
    [remote.remoteId, ...values, existing.id],
  );
}

/**
 * Drops local rows the account no longer has.
 *
 * A share the owner deleted along with its document leaves nothing behind on
 * the server, so a device that kept its copy would show an inbox entry pointing
 * at a document that cannot be opened or explained. A **revoked** share is not
 * this case — that row still exists and still says who removed the access.
 */
export async function pruneShares(
  db: SQLiteDatabase,
  keep: ReadonlySet<string>,
): Promise<string[]> {
  const rows = await db.getAllAsync<{ id: string; remoteId: string | null }>(
    "SELECT id, remoteId FROM shares WHERE syncState = 'synced' AND remoteId IS NOT NULL",
  );
  const gone = rows.filter((row) => row.remoteId !== null && !keep.has(row.remoteId));
  for (const row of gone) {
    await db.runAsync('DELETE FROM shares WHERE id = ?', row.id);
  }
  return gone.map((row) => row.id);
}

/** Forgets one outright. The outbox has already stopped caring about it. */
export async function purgeShare(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM shares WHERE id = ?', id);
}

/** The remote ids of everything currently held, for the reconcile diff. */
export async function knownRemoteIds(db: SQLiteDatabase): Promise<Map<string, string>> {
  const rows = await db.getAllAsync<{ id: string; remoteId: string }>(
    'SELECT id, remoteId FROM shares WHERE remoteId IS NOT NULL',
  );
  return new Map(rows.map((row) => [row.remoteId, row.id]));
}
