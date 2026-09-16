/**
 * What the index is doing, for the screens that say so.
 *
 * One local query over the two tables that change while it runs, so a tile and
 * a settings row both re-render on the same write rather than each polling.
 * `useLocalQuery` debounces the table-change events for exactly this — the
 * embedding loop writes every batch and a screen that re-rendered on each one
 * would be re-rendering thirty times a minute.
 */
import { useCallback } from 'react';

import { useLocalQuery } from '@/features/library/local/use-local-query';
import * as Chunks from '@/features/library/local/repository/chunks';
import * as Jobs from '@/features/library/local/repository/jobs';

import { CHUNK_VERSION, MODEL_VERSION } from '../model';

export type IndexStatus = {
  /** Documents with a usable index at the current model and chunker. */
  indexed: number;
  /** Bytes every index on this device adds up to. */
  bytes: number;
  queued: number;
  held: number;
  failed: number;
  /** The one being worked on, when there is one. */
  current: { documentId: string; done: number; total: number | null } | null;
};

/** `localJobs` moves per batch; `documentVectors` moves per finished document. */
const TABLES = ['localJobs', 'documentVectors'] as const;

export function useIndexStatus(profileId: string | null) {
  const run = useCallback(async (db: Parameters<typeof Chunks.indexBytes>[0]) => {
    const [indexed, bytes, summary] = await Promise.all([
      Chunks.indexedIds(db, MODEL_VERSION, CHUNK_VERSION),
      Chunks.indexBytes(db),
      Jobs.summary(db, Jobs.INDEX_JOB),
    ]);

    return {
      indexed: indexed.size,
      bytes,
      queued: summary.queued,
      held: summary.held,
      failed: summary.failed,
      current:
        summary.current === null
          ? null
          : {
              documentId: summary.current.documentId,
              done: summary.current.completedUnits,
              total: summary.current.totalUnits,
            },
    } satisfies IndexStatus;
  }, []);

  return useLocalQuery(profileId, TABLES, run);
}
