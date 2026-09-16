/**
 * The repositories, with the profile resolved.
 *
 * `repository/chunks.ts` and `repository/jobs.ts` take a `db`, which is the
 * convention every other repository in `local/` follows and is what makes them
 * usable inside a transaction the caller already opened. Most callers here have
 * a profile id and no database handle — `sweepDocument` in particular is
 * synchronous and fire-and-forget — so this is the thin layer that resolves one
 * and swallows what it cannot do.
 *
 * `text-index.ts` is the same shape for the same reason, down to the `void`
 * return on the forget: a delete that could not open the database is not a
 * reason to leave a reader looking at a document they asked to remove.
 */
import { database } from '@/features/library/local/db';
import * as Chunks from '@/features/library/local/repository/chunks';
import * as Jobs from '@/features/library/local/repository/jobs';
import { log } from '@/lib/logger';

import { AI_RETENTION_MAX_DAYS } from '@convex/model/limits';

import { ASK_CACHE_MESSAGES, CHUNK_VERSION, MODEL_VERSION } from './model';

const SCOPE = 'intelligence-store';

/**
 * Everything this device worked out about one document, dropped.
 *
 * Called from `sweepDocument`, which is the single place a document's local
 * artifacts are removed. Registering here rather than at each of the three call
 * sites is the whole reason that function exists — the last time an artifact
 * was added, three callers each cleaned a different subset and the reader's own
 * document text stayed on the phone for documents that no longer existed.
 */
export async function forgetIndexFor(profileId: string, documentId: string): Promise<void> {
  try {
    const db = await database(profileId);
    if (db === null) {
      return;
    }
    await Chunks.forgetIndex(db, documentId);
    await Jobs.forgetJobs(db, documentId);
  } catch (error) {
    log.debug(SCOPE, 'could not drop an index', error);
  }
}

/** Every index on this device, dropped. The settings screen's last row. */
export async function forgetEveryIndex(profileId: string): Promise<void> {
  const db = await database(profileId);
  if (db === null) {
    return;
  }
  await Chunks.forgetEverything(db);
  await Jobs.forgetKind(db, Jobs.INDEX_JOB);
}

/** What the settings screen and the tiles read. */
export async function indexedDocumentIds(profileId: string): Promise<ReadonlySet<string>> {
  try {
    const db = await database(profileId);
    if (db === null) {
      return new Set();
    }
    return await Chunks.indexedIds(db, MODEL_VERSION, CHUNK_VERSION);
  } catch (error) {
    log.debug(SCOPE, 'could not read the indexed ids', error);
    return new Set();
  }
}

export async function indexBytesOnDevice(profileId: string): Promise<number> {
  try {
    const db = await database(profileId);
    return db === null ? 0 : await Chunks.indexBytes(db);
  } catch {
    return 0;
  }
}

/** The last few turns of a conversation, so a reopened screen is not blank. */
export async function cacheConversation(
  profileId: string,
  threadId: string,
  messages: readonly { ordinal: number; role: string; body: string }[],
): Promise<void> {
  try {
    const db = await database(profileId);
    if (db === null) {
      return;
    }
    await Chunks.cacheMessages(db, threadId, messages, ASK_CACHE_MESSAGES);
  } catch (error) {
    log.debug(SCOPE, 'could not cache a conversation', error);
  }
}

export async function cachedConversation(
  profileId: string,
  threadId: string,
): Promise<{ ordinal: number; role: string; body: string }[]> {
  try {
    const db = await database(profileId);
    return db === null ? [] : await Chunks.cachedMessages(db, threadId);
  } catch {
    return [];
  }
}

/**
 * Drops cached turns older than the longest a conversation can live.
 *
 * "Deleted after a month" has to be true in both places it was stored, or it is
 * a claim about one of them. The server enforces it on its side; this is the
 * other half, and it runs on every pass of the index queue so there is no
 * window where a phone is holding answers the account has already deleted.
 */
export async function pruneConversations(profileId: string): Promise<number> {
  try {
    const db = await database(profileId);
    if (db === null) {
      return 0;
    }
    return await Chunks.pruneCachedBefore(db, Date.now() - AI_RETENTION_MAX_DAYS * 86_400_000);
  } catch (error) {
    log.debug(SCOPE, 'could not prune the conversation cache', error);
    return 0;
  }
}
