import { useCallback } from 'react';

import * as Documents from '../local/repository/documents';
import { useLocalQuery } from '../local/use-local-query';
import { useLibraryStatus } from './use-library-status';
import type { FileState, LibraryDocument } from '../local/repository/types';

/** One row on the Downloads screen: the document, and what its file is doing. */
export type DownloadEntry = LibraryDocument & { file: Documents.DownloadFacts };

export type DownloadsView = {
  entries: DownloadEntry[];
  loading: boolean;
};

/**
 * Which of the eleven states belong under each chip.
 *
 * A reader picking "Waiting" wants everything that is going to happen without
 * them; "Problems" is everything that will not happen without them. The split
 * is by what the row *asks of the reader* rather than by the state machine's
 * own shape, which is why `held` and `queued` sit together despite being very
 * different internally.
 */
export const SEGMENT_STATES: Record<string, ReadonlySet<FileState>> = {
  device: new Set<FileState>(['available', 'outdated']),
  waiting: new Set<FileState>(['queued', 'held', 'downloading', 'paused', 'verifying']),
  problems: new Set<FileState>(['corrupt', 'failed']),
};

const TABLES = ['documents', 'documentFiles'] as const;

/**
 * Everything the Downloads screen shows, live.
 *
 * `useLocalQuery` rather than `useQuery`, which is the whole point of the
 * screen: it answers with no connection, from the database that already knows,
 * and it re-runs when `documentFiles` changes — which is every time the queue
 * moves a byte counter or a state.
 */
export function useDownloads(): DownloadsView {
  const { profileId } = useLibraryStatus();

  const read = useCallback(async (db: Parameters<typeof Documents.downloadsList>[0]) => {
    return await Documents.downloadsList(db);
  }, []);

  const { data, loading } = useLocalQuery(profileId, TABLES, read);
  return { entries: data ?? [], loading };
}
