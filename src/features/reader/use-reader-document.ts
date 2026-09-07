import type { SQLiteDatabase } from 'expo-sqlite';
import { useCallback } from 'react';

import { useLibraryStatus } from '../library/data/use-library-status';
import type { LibraryDocument } from '../library/data/types';
import * as Documents from '../library/local/repository/documents';
import { useLocalQuery } from '../library/local/use-local-query';

export type OutlineEntry = { title: string; page: number; depth: number };

const TABLES = ['documents', 'documentFiles', 'outlines'] as const;

/**
 * The open document and its table of contents, from this device.
 *
 * Both used to be Convex subscriptions, and both are read by two screens — the
 * reader and the navigator over it — so this is one hook rather than the same
 * pair written twice. What it replaces is the reason the whole plan exists: a
 * reader in aeroplane mode watched a spinner in front of a file that was
 * already on their own disk, because the *title* needed a network.
 *
 * The scrubber's chapter ticks and the Contents list read the same outline.
 */
export function useReaderDocument(documentId: string | undefined): {
  document: LibraryDocument | undefined;
  outline: OutlineEntry[] | undefined;
  loading: boolean;
} {
  const { profileId } = useLibraryStatus();

  const read = useCallback(
    async (db: SQLiteDatabase) => {
      if (documentId === undefined) {
        return null;
      }
      const found = await Documents.liveDocumentById(db, documentId);
      if (found === null) {
        return null;
      }
      return {
        document: found,
        outline: found.hasOutline ? await Documents.outlineOf(db, documentId) : [],
      };
    },
    [documentId],
  );

  const { data, loading } = useLocalQuery(profileId, TABLES, read);

  return { document: data?.document, outline: data?.outline, loading };
}
