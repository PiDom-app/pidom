import type { SQLiteDatabase } from 'expo-sqlite';

import { log } from '@/lib/logger';
import { preferencesNow, storageCapBytes } from '@/stores/preferences-store';

import * as Documents from '../local/repository/documents';
import * as Files from '../local/repository/files';
import { discardPartial, verifyLocal } from '../local/transfer';
import { sweepDocument } from '../local/sweep';
import { handleFor, OVERRIDE_PRIORITY, TAP_PRIORITY } from './engine';

const SCOPE = 'downloads';

/**
 * What a reader can do to a transfer, as opposed to what the queue does to it.
 *
 * Each of these writes the row and returns; the drain notices on its next tick.
 * Nothing here starts a transfer directly, because two things starting the same
 * transfer is how a download ends up running twice and writing the same partial
 * file from two places.
 */

/** Asks for a document. A tap outranks anything an automatic rule queued. */
export async function request(
  db: SQLiteDatabase,
  documentId: string,
  { byRule = false }: { byRule?: boolean } = {},
): Promise<void> {
  const document = await Documents.documentById(db, documentId);
  if (document === null || !document.isSynced) {
    return;
  }
  await Files.enqueue(db, documentId, {
    priority: byRule ? 0 : TAP_PRIORITY,
    expectedBytes: document.byteSize,
  });
}

/**
 * Agrees to one download over a rule that was holding it.
 *
 * Scoped to the one document, and never to the setting: a reader saying yes to
 * this textbook on mobile data has not said yes to the next six, and a control
 * that quietly turned `wifiOnly` off would be a control that lied.
 */
export async function downloadAnyway(db: SQLiteDatabase, documentId: string): Promise<void> {
  const document = await Documents.documentById(db, documentId);
  await Files.enqueue(db, documentId, {
    priority: OVERRIDE_PRIORITY,
    expectedBytes: document?.byteSize,
  });
}

/**
 * Stops a transfer, keeping what has arrived.
 *
 * Two halves, and both are needed. The native task has to be told, or the bytes
 * keep coming; the row has to be written, or a relaunch finds a `downloading`
 * row with nothing behind it. A row with no live handle — the reader pausing
 * something still queued — is just a row.
 */
export async function pause(db: SQLiteDatabase, documentId: string): Promise<void> {
  const handle = handleFor(documentId);
  if (handle === null) {
    await Files.pause(db, documentId, null);
    return;
  }
  try {
    await Files.pause(db, documentId, await handle.pause());
  } catch (error) {
    log.debug(SCOPE, 'could not pause cleanly', error);
    await Files.pause(db, documentId, null);
  }
}

/** Puts a paused transfer back in the queue, at the front. */
export async function resume(db: SQLiteDatabase, documentId: string): Promise<void> {
  await Files.enqueue(db, documentId, { priority: TAP_PRIORITY });
}

/**
 * Gives up on a transfer and throws away what arrived.
 *
 * The one action here that destroys something, which is why it is separate from
 * pausing rather than a flag on it. What it destroys is a partial file that
 * cannot be read, so it needs no confirmation — unlike removing a download,
 * which destroys a document somebody could open.
 */
export async function cancel(
  db: SQLiteDatabase,
  profileId: string,
  documentId: string,
): Promise<void> {
  handleFor(documentId)?.cancel();
  discardPartial(profileId, documentId);
  await Files.settle(db, documentId, 'missing');
}

/**
 * Reads a file back and says whether it is still the document it claims to be.
 *
 * The manual "Check this file", and the periodic pass. Three outcomes rather
 * than two, and the third is the point: a file that is a perfectly good PDF and
 * no longer the one the account holds is `outdated`, not `corrupt`. It still
 * opens, the reader can go on reading it, and replacing it is an offer rather
 * than something done to them.
 */
export async function verify(
  db: SQLiteDatabase,
  profileId: string,
  documentId: string,
): Promise<'available' | 'outdated' | 'corrupt' | 'missing'> {
  const document = await Documents.documentById(db, documentId);
  if (document === null) {
    return 'missing';
  }

  await Files.settle(db, documentId, 'verifying');
  const { failure, hash } = await verifyLocal(profileId, documentId, {
    byteSize: document.byteSize,
    fingerprint: document.fingerprint,
  });

  if (failure === 'truncated' && !document.isSynced) {
    // Nothing arrived and there is no cloud copy to try again from. `missing`
    // rather than `corrupt`: there is no offer to make.
    await Files.settle(db, documentId, 'missing', { failure });
    return 'missing';
  }

  if (failure !== null) {
    /**
     * A mismatch against the account's fingerprint is the ambiguous one.
     *
     * It means the bytes here are not the bytes the account has — which is
     * either a file that went wrong on this disk, or a document somebody
     * replaced from another device. The second is far commoner and the first is
     * unrecoverable anyway, so a readable PDF is called `outdated` and offered
     * a refresh; only a file that is the wrong size or does not start `%PDF-`
     * is called `corrupt`.
     */
    const state = failure === 'wrong-file' ? 'outdated' : 'corrupt';
    await Files.settle(db, documentId, state, { failure });
    return state;
  }

  await Files.settle(db, documentId, 'available', {
    localBytes: document.byteSize,
    verifiedHash: hash,
    remoteHash: document.fingerprint,
  });
  return 'available';
}

/**
 * Reads every downloaded file back, a few at a time.
 *
 * The manual "Check every download now". It was a toast and nothing else for
 * one commit, which is exactly the failure `docs/security.md` names: a control
 * that says it did something and did nothing is worse than no control, because
 * the reader now believes their library has been checked.
 *
 * Batched and yielding, because it is not free — reading a gigabyte off a disk
 * and hashing the part of it that is small enough would block the queue and the
 * interface if it ran as one pass. `onProgress` is what the screen counts with,
 * and `shouldStop` lets a screen that unmounted stop it mid-library rather than
 * finishing into nothing.
 */
export async function verifyEverything(
  db: SQLiteDatabase,
  profileId: string,
  options: {
    onProgress?: (done: number, total: number) => void;
    shouldStop?: () => boolean;
  } = {},
): Promise<{ checked: number; outdated: number; corrupt: number }> {
  const ids = await Files.verifiableIds(db);
  const out = { checked: 0, outdated: 0, corrupt: 0 };

  for (const documentId of ids) {
    if (options.shouldStop?.() === true) {
      break;
    }
    const outcome = await verify(db, profileId, documentId);
    out.checked += 1;
    if (outcome === 'outdated') {
      out.outdated += 1;
    }
    if (outcome === 'corrupt') {
      out.corrupt += 1;
    }
    options.onProgress?.(out.checked, ids.length);
  }

  return out;
}

/** How long a verified file is trusted before it is read back again. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** At most this many per pass, so a library of four hundred books is not one long stall. */
const VERIFY_BATCH = 3;

/**
 * The documents due a check, given the cadence the reader chose.
 *
 * `always` is deliberately not "on every open" — that would read a hundred
 * megabytes off the disk in front of somebody who just tapped a book. It means
 * the batch runs every pass rather than once a week.
 */
export async function dueForVerification(db: SQLiteDatabase): Promise<string[]> {
  const cadence = preferencesNow().verifyCadence;
  if (cadence === 'never') {
    return [];
  }
  const before = cadence === 'always' ? Date.now() : Date.now() - WEEK_MS;
  return await Files.staleVerifications(db, before, VERIFY_BATCH);
}

/**
 * Makes room, when the reader has set a ceiling and the library has reached it.
 *
 * Two rules, and the second is absolute. **Only a document the account still
 * holds is ever evicted**, because removing the only copy of something to
 * satisfy a number somebody set six months ago is data loss with a settings
 * screen in front of it. A local-only document is never a candidate at any
 * ceiling, and the settings screen says so in words rather than leaving it to
 * be discovered.
 *
 * Eviction goes through `sweepDocument(..., 'download')`, which is the same
 * path "Remove from this device" takes — the PDF, the cover, the page
 * thumbnails, the mirrored text and the stored password. A hand-rolled delete
 * here would be a second thing to keep correct, and the one that got forgotten
 * would be the one leaving somebody's document text on their phone.
 */
export async function evictToCap(db: SQLiteDatabase, profileId: string): Promise<number> {
  const cap = storageCapBytes();
  if (cap === null) {
    return 0;
  }

  let used = await Files.bytesOnDevice(db);
  if (used <= cap) {
    return 0;
  }

  const { evictionOrder, keepFinished } = preferencesNow();
  const candidates = (await Documents.onThisDeviceBySize(db))
    .filter((document) => document.isSynced && document.ownedByMe)
    .filter((document) => !(keepFinished && document.isFinished));

  const ordered =
    evictionOrder === 'largest'
      ? candidates
      : evictionOrder === 'finished-first'
        ? [...candidates].sort((a, b) => Number(b.isFinished) - Number(a.isFinished))
        : [...candidates].sort((a, b) => (a.lastOpenedAt ?? 0) - (b.lastOpenedAt ?? 0));

  let removed = 0;
  for (const document of ordered) {
    if (used <= cap) {
      break;
    }
    sweepDocument(profileId, document.id, 'download');
    await Files.settle(db, document.id, 'missing');
    used -= document.localBytes;
    removed += 1;
  }

  if (removed > 0) {
    log.debug(SCOPE, `evicted ${removed} download(s) to stay under the ceiling`);
  }
  return removed;
}
