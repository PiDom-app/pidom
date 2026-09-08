/**
 * The outbox.
 *
 * Every change a reader makes is written to the device and one row is put here
 * saying the account has not been told yet. The engine drains it when there is
 * a connection. Nothing waits, and nothing is lost to a force-quit — which is
 * what the Convex client's own mutation queue could not promise, because it
 * lives in memory and has no persistence option to turn on.
 *
 * **One row per entity, and that is the whole coalescing strategy.** `opId` is
 * `<entity>:<entityId>` and the primary key, so a reader who turns two hundred
 * pages of a book offline has one row waiting, not two hundred. `payload`
 * records *which* fields moved rather than what they moved to, and the values
 * are read off the entity at the moment of sending — so the account is told
 * where somebody ended up rather than replayed through every page they passed
 * on the way.
 *
 * The op is a three-state machine over that row:
 *
 * ```
 *   (none) ─create─►  create ─update─►  create      a row the account has
 *                            ─remove─►  (annihilated)   never heard of
 *   (none) ─update─►  update ─remove─►  remove
 *   (none) ─remove─►  remove
 * ```
 *
 * The annihilation is the interesting one: a note written and deleted before
 * the phone found a signal is not two operations that cancel at the backend, it
 * is nothing that ever happened.
 */
import { type SQLiteDatabase } from 'expo-sqlite';

export type QueueEntity =
  | 'document'
  | 'bookmark'
  | 'annotation'
  | 'collection'
  | 'membership'
  /**
   * A grant, and the group it may go to.
   *
   * Both are here for the same reason everything else is: a reader who taps
   * Share in a tunnel has made a decision, and the alternative to queueing it
   * is refusing it. The one thing a queued share cannot do is take effect —
   * the recipient hears nothing until the queue drains, which is what the
   * "Waiting for connection" state on the share screen says out loud.
   */
  | 'share'
  | 'group';
export type QueueOp = 'create' | 'update' | 'remove';

export type QueuedOperation = {
  opId: string;
  entity: QueueEntity;
  entityId: string;
  op: QueueOp;
  /** Which fields changed. Empty for a create or a remove, which carry all. */
  fields: string[];
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  status: 'pending' | 'failed';
  lastError: string | null;
};

type QueueRow = Omit<QueuedOperation, 'fields' | 'entity' | 'op' | 'status'> & {
  entity: string;
  op: string;
  payload: string;
  status: string;
};

function toOperation(row: QueueRow): QueuedOperation {
  let fields: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.payload);
    if (Array.isArray(parsed)) {
      fields = parsed.filter((entry): entry is string => typeof entry === 'string');
    }
  } catch {
    // A payload that will not parse is a payload with nothing to say. The
    // operation still sends; it just sends everything the entity currently has.
  }
  return {
    opId: row.opId,
    entity: row.entity as QueueEntity,
    entityId: row.entityId,
    op: row.op as QueueOp,
    fields,
    createdAt: row.createdAt,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    status: row.status === 'failed' ? 'failed' : 'pending',
    lastError: row.lastError,
  };
}

function idOf(entity: QueueEntity, entityId: string): string {
  return `${entity}:${entityId}`;
}

/**
 * Records that something changed.
 *
 * Returns `'annihilated'` when the operation cancelled a create that had never
 * been sent, so the caller can drop the local row entirely rather than leave a
 * tombstone for a thing the account never knew about.
 */
export async function enqueue(
  db: SQLiteDatabase,
  entity: QueueEntity,
  entityId: string,
  op: QueueOp,
  fields: string[] = [],
): Promise<'queued' | 'annihilated'> {
  const opId = idOf(entity, entityId);
  const existing = await db.getFirstAsync<{ op: string; payload: string }>(
    'SELECT op, payload FROM syncQueue WHERE opId = ?',
    opId,
  );

  if (existing !== null && existing.op === 'create' && op === 'remove') {
    await db.runAsync('DELETE FROM syncQueue WHERE opId = ?', opId);
    return 'annihilated';
  }

  // A create stays a create however many times the row is edited afterwards:
  // the account has still never seen it, and the create carries current values.
  // A remove wins over everything, because there is nothing left to update.
  const next =
    existing === null ? op : op === 'remove' ? 'remove' : existing.op === 'create' ? 'create' : op;

  const merged = new Set<string>(fields);
  if (existing !== null) {
    try {
      const parsed: unknown = JSON.parse(existing.payload);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === 'string') {
            merged.add(entry);
          }
        }
      }
    } catch {
      // See `toOperation`.
    }
  }

  const now = Date.now();
  await db.runAsync(
    `INSERT INTO syncQueue (opId, entity, entityId, op, payload, createdAt, attempts, nextAttemptAt, status, lastError)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'pending', NULL)
     ON CONFLICT (opId) DO UPDATE SET
       op = excluded.op,
       payload = excluded.payload,
       attempts = 0,
       nextAttemptAt = 0,
       status = 'pending',
       lastError = NULL`,
    [opId, entity, entityId, next, JSON.stringify([...merged]), now],
  );

  return 'queued';
}

/**
 * Everything a document owns, dropped.
 *
 * Called when a document is deleted: its bookmarks, notes and memberships all
 * go with it at the account, so sending their operations first would be work
 * that the cascade is about to undo — and half of them would come back
 * `FORBIDDEN` from a document that is no longer there.
 */
export async function dropOperationsFor(
  db: SQLiteDatabase,
  entity: QueueEntity,
  entityIds: string[],
): Promise<void> {
  for (const entityId of entityIds) {
    await db.runAsync('DELETE FROM syncQueue WHERE opId = ?', idOf(entity, entityId));
  }
}

/** The next operations due, oldest first. */
export async function claim(
  db: SQLiteDatabase,
  now: number,
  limit: number,
): Promise<QueuedOperation[]> {
  const rows = await db.getAllAsync<QueueRow>(
    `SELECT opId, entity, entityId, op, payload, createdAt, attempts, nextAttemptAt, status, lastError
       FROM syncQueue
      WHERE status = 'pending' AND nextAttemptAt <= ?
      ORDER BY createdAt ASC
      LIMIT ?`,
    [now, limit],
  );
  return rows.map(toOperation);
}

/** Done, or no longer applicable. Either way it leaves the queue. */
export async function acknowledge(db: SQLiteDatabase, opId: string): Promise<void> {
  await db.runAsync('DELETE FROM syncQueue WHERE opId = ?', opId);
}

/**
 * Not now. Comes back when the backoff is up.
 *
 * `countAttempt` is what separates "this failed" from "this is waiting its
 * turn". An attempt is a budget: eight of them and the operation is put in
 * front of a person. Two of the reasons an operation comes back here are not
 * failures at all — it is queued behind a create it depends on, or the account
 * said in so many words how long to wait — and counting those spends a budget
 * that exists for changes the account will never accept. A membership operation
 * behind a slow collection create was deferred every two seconds and
 * dead-lettered on its ninth wait, having never once been refused.
 */
export async function defer(
  db: SQLiteDatabase,
  opId: string,
  nextAttemptAt: number,
  reason: string,
  countAttempt = true,
): Promise<void> {
  await db.runAsync(
    `UPDATE syncQueue
        SET attempts = attempts + ?, nextAttemptAt = ?, lastError = ?
      WHERE opId = ?`,
    [countAttempt ? 1 : 0, nextAttemptAt, reason, opId],
  );
}

/**
 * Never, without help.
 *
 * A dead letter is visible on the sync screen with something the reader can do
 * about it, because an operation that quietly stopped trying is worse than one
 * that failed loudly — the change is in their library and not in their account,
 * and nothing anywhere would say so.
 */
export async function markFailed(
  db: SQLiteDatabase,
  opId: string,
  reason: string,
): Promise<void> {
  await db.runAsync(
    "UPDATE syncQueue SET status = 'failed', attempts = attempts + 1, lastError = ? WHERE opId = ?",
    [reason, opId],
  );
}

/** Put a dead letter back in the queue. The Try again on the sync screen. */
export async function retryFailed(db: SQLiteDatabase, opId: string | null): Promise<void> {
  const where = opId === null ? '' : ' AND opId = ?';
  const params = opId === null ? [] : [opId];
  await db.runAsync(
    `UPDATE syncQueue SET status = 'pending', attempts = 0, nextAttemptAt = 0, lastError = NULL
      WHERE status = 'failed'${where}`,
    params,
  );
}

export async function discardFailed(db: SQLiteDatabase, opId: string | null): Promise<void> {
  const where = opId === null ? '' : ' AND opId = ?';
  const params = opId === null ? [] : [opId];
  await db.runAsync(`DELETE FROM syncQueue WHERE status = 'failed'${where}`, params);
}

export type QueueSummary = { pending: number; failed: number; oldestAt: number | null };

export async function summary(db: SQLiteDatabase): Promise<QueueSummary> {
  const row = await db.getFirstAsync<{
    pending: number;
    failed: number;
    oldestAt: number | null;
  }>(
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
       MIN(createdAt) AS oldestAt
     FROM syncQueue`,
  );
  return {
    pending: row?.pending ?? 0,
    failed: row?.failed ?? 0,
    oldestAt: row?.oldestAt ?? null,
  };
}

export async function failedOperations(db: SQLiteDatabase): Promise<QueuedOperation[]> {
  const rows = await db.getAllAsync<QueueRow>(
    `SELECT opId, entity, entityId, op, payload, createdAt, attempts, nextAttemptAt, status, lastError
       FROM syncQueue WHERE status = 'failed' ORDER BY createdAt ASC`,
  );
  return rows.map(toOperation);
}

/** Whether a given entity still has work waiting. */
export async function isPending(
  db: SQLiteDatabase,
  entity: QueueEntity,
  entityId: string,
): Promise<boolean> {
  const row = await db.getFirstAsync<{ opId: string }>(
    'SELECT opId FROM syncQueue WHERE opId = ?',
    idOf(entity, entityId),
  );
  return row !== null;
}
