import type { ConvexReactClient } from 'convex/react';
import type { SQLiteDatabase } from 'expo-sqlite';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { log } from '@/lib/logger';

import { codeOf, retryAfterOf } from '../data/errors';
import * as Documents from '../local/repository/documents';
import * as Files from '../local/repository/files';
import { localCoverUri } from '../local/paths';
import { backoffFor, MAX_ATTEMPTS } from '../sync/outcome';
import {
  BadDownload,
  discardPartial,
  downloadCover,
  downloadDocument,
  Paused,
  type Handle,
} from '../local/transfer';
import { canTransfer, holdFor } from './policy';
import { preferencesNow } from '@/stores/preferences-store';

const SCOPE = 'downloads';

/**
 * The queue that moves bytes, and the reasons it stops.
 *
 * Separate from `sync/engine.ts` on purpose, and the separation is not
 * cosmetic. That queue exists to deliver *changes* and retries them until they
 * land; this one moves *files* and must not. `sync/operations.ts` says why in
 * its header — `library.uploadUrl` deletes the object at the key before it
 * signs a new URL, so a replayed transfer destroys the copy in the account —
 * and the general rule behind it is that a retry of a change is free while a
 * retry of a hundred megabytes is somebody's data allowance.
 *
 * So this drains one thing at a time by default, holds rather than fails when a
 * setting says not now, and records where it got to on the row so that a
 * process killed mid-transfer costs the reader nothing but a resume.
 *
 * **It never writes to the account.** The whole queue is `documentFiles`, which
 * is the one table with no counterpart on the server. The only call it makes is
 * `library.downloadUrl`, which mints a five-minute signature after checking
 * ownership — see `docs/security.md`.
 */

export type Drain = { client: ConvexReactClient; db: SQLiteDatabase; profileId: string };

/**
 * The transfers running right now, so the reader can pause one.
 *
 * A module-level map rather than a store because it holds native task handles
 * rather than state: nothing renders from it, and a handle that outlived the
 * transfer it belongs to would be a pause that silently does nothing.
 */
const running = new Map<string, Handle>();

export function handleFor(documentId: string): Handle | null {
  return running.get(documentId) ?? null;
}

/** Whether anything is moving. Read by the queue before it starts another. */
export function movingNow(): number {
  return running.size;
}

/**
 * Moves as much as the ceiling allows, then stops.
 *
 * Returns whether it did anything, so the caller can decide whether to come
 * back sooner. Never throws: a queue that can take down the screen that mounts
 * it is a queue that takes the library with it.
 */
export async function drain({ client, db, profileId }: Drain): Promise<boolean> {
  if (!canTransfer()) {
    return false;
  }

  const ceiling = preferencesNow().maxConcurrent;
  let moved = false;

  while (running.size < ceiling) {
    const next = await Files.nextQueued(db, Date.now());
    if (next === null) {
      break;
    }

    const document = await Documents.documentById(db, next.documentId);
    if (document === null || document.remoteId === null) {
      // Nothing to fetch it from. A document that has not reached the account
      // has no cloud copy, and one that is gone has nothing to fetch.
      await Files.settle(db, next.documentId, 'missing');
      continue;
    }

    const hold = holdFor(document.byteSize, next.priority >= OVERRIDE_PRIORITY);
    if (hold !== null) {
      await Files.hold(db, next.documentId, hold);
      continue;
    }

    moved = true;
    await transfer({ client, db, profileId }, next, document);
  }

  return moved;
}

/**
 * The priority a reader's own "download anyway" carries.
 *
 * High enough to jump the queue, and doubling as the override flag: a row at
 * this priority has had a person look at the hold and say yes, so `holdFor`
 * stops asking. Two facts in one number is usually a mistake; here it is the
 * one thing that has to survive the app being killed between the tap and the
 * transfer, and the alternative was a twelfth column.
 */
export const OVERRIDE_PRIORITY = 100;

/** What a reader's tap is worth against what a rule asked for. */
export const TAP_PRIORITY = 10;

async function transfer(
  { client, db, profileId }: Drain,
  file: Files.FileRecord,
  document: NonNullable<Awaited<ReturnType<typeof Documents.documentById>>>,
): Promise<void> {
  const documentId = document.remoteId as Id<'documents'>;
  const localId = document.id;

  await Files.settle(db, localId, 'downloading');
  await Files.recordProgress(db, localId, file.bytesWritten ?? 0, document.byteSize);

  try {
    /**
     * A fresh signature, every time, including on a resume.
     *
     * The saved pause state carries the URL the transfer was using and that URL
     * is five minutes old at best. Re-minting first means a resume is refused
     * for a reason the reader can act on rather than for an expiry nobody can
     * see, and it means the stored credential is never the thing the transfer
     * depends on.
     *
     * **Two mutations, and which one is not a detail.** `library.downloadUrl`
     * checks `assertOwner`, so asking it for a document that arrived under a
     * grant is refused — correctly, and with the same `FORBIDDEN` a document
     * that does not exist gets. The recipient's door is
     * `sharing.shareDownloadUrl`, which resolves the grant instead, refuses a
     * share whose `canDownload` is false, re-checks expiry against a fresh
     * clock, and spends a narrower rate bucket because that egress is billed to
     * the sender. Same five-minute signature either way.
     */
    const url = document.ownedByMe
      ? await client.mutation(api.library.downloadUrl, { documentId, what: 'document' })
      : await client.mutation(api.sharing.shareDownloadUrl, { documentId, what: 'document' });
    if (url === null) {
      await Files.settle(db, localId, 'missing', {
        failure: 'That document is not in your account.',
      });
      return;
    }

    const { hash } = await downloadDocument(
      profileId,
      localId,
      url,
      { byteSize: document.byteSize, fingerprint: document.fingerprint },
      {
        resumeFrom: file.pauseState,
        keepPartial: file.state === 'paused',
        onHandle: (handle) => running.set(localId, handle),
        onProgress: ({ sent, total }) => {
          void Files.recordProgress(db, localId, sent, total);
        },
      },
    );

    await Files.settle(db, localId, 'available', {
      localBytes: document.byteSize,
      verifiedHash: hash,
      // The account value this file was checked against, so a later reconcile
      // can notice it has moved on. See `noteAccountFingerprint`.
      remoteHash: document.fingerprint,
    });

    // Best effort, and after the document: a cover is worth a round trip but
    // never worth blocking the thing the reader asked for.
    if (localCoverUri(profileId, localId) === null) {
      void (
        document.ownedByMe
          ? client.mutation(api.library.downloadUrl, { documentId, what: 'cover' })
          : client.mutation(api.sharing.shareCoverUrl, { documentId })
      )
        .then(async (coverUrl) => {
          if (coverUrl !== null && (await downloadCover(profileId, localId, coverUrl))) {
            await Files.setCoverState(db, localId, 'available');
          }
        })
        .catch((error: unknown) => log.debug(SCOPE, 'no cover to fetch', error));
    }
  } catch (error) {
    await settleFailure(db, profileId, localId, file, error);
  } finally {
    running.delete(localId);
  }
}

/**
 * What a failed transfer becomes, which is four different things.
 *
 * The distinction the first version did not make is between a file that never
 * arrived and one that arrived wrong, and they belong in different states
 * because they offer different things — one is "try again", the other is
 * "nothing was kept, try again on a steadier connection".
 *
 * A rate limit is neither. The account has run out of a bucket and said how
 * long; waiting that long is the whole instruction, and counting it as an
 * attempt would spend a reader's retry budget on a queue behaving exactly as
 * designed. Same reasoning as `sync/outcome.ts`, which says it at length.
 */
async function settleFailure(
  db: SQLiteDatabase,
  profileId: string,
  localId: string,
  file: Files.FileRecord,
  error: unknown,
): Promise<void> {
  if (error instanceof Paused) {
    // `pause()` on the handle has already written the row. Nothing to do, and
    // in particular nothing to count.
    return;
  }

  if (error instanceof BadDownload) {
    if (error.reason === 'no-space') {
      await Files.hold(db, localId, 'space');
      return;
    }
    // The bytes arrived and were not the document. Nothing was kept — see
    // `downloadDocument` — so this is a state the reader is offered, not a
    // file they can open.
    await Files.settle(db, localId, 'corrupt', { failure: error.reason });
    return;
  }

  const code = codeOf(error);

  if (code === 'RATE_LIMITED') {
    const retryAfter = retryAfterOf(error);
    await Files.defer(db, localId, retryAfter ?? backoffFor(0), null);
    return;
  }

  if (code === 'FORBIDDEN') {
    /**
     * The account will not let this caller have it: the document was deleted
     * on another device, or a share was revoked, or a grant lapsed. There is
     * nothing here to retry.
     *
     * `failed` rather than `missing`, and the difference is a loop. The
     * automatic rules queue anything they are responsible for that is
     * `missing`, so settling there would mean: refused, back to missing, queued
     * again on the next pass, refused again — every iteration spending a token
     * from a rate bucket, for ever. `failed` is a state a rule never picks up
     * and a person can act on; it shows under Problems, and a tap re-queues it.
     */
    discardPartial(profileId, localId);
    await Files.settle(db, localId, 'failed', {
      failure: 'Your account will not allow this download.',
    });
    return;
  }

  if (!preferencesNow().retryAutomatically || file.attempts + 1 >= MAX_ATTEMPTS) {
    await Files.settle(db, localId, 'failed', {
      failure: 'Your account could not be reached.',
    });
    return;
  }

  await Files.defer(db, localId, backoffFor(file.attempts), null);
}
