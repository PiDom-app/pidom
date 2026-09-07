import type { SQLiteDatabase } from 'expo-sqlite';
import { useCallback } from 'react';

import { useAppToast } from '@/components/feedback/use-app-toast';
import { log } from '@/lib/logger';

import { useLibraryStatus } from '../library/data/use-library-status';
import { database } from '../library/local/db';
import * as Marks from '../library/local/repository/marks';
import * as Queue from '../library/local/repository/queue';
import { useLocalQuery } from '../library/local/use-local-query';

const SCOPE = 'reader-notes';

export type Annotation = {
  id: string;
  page: number;
  kind: 'passage' | 'note';
  text: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
};

const TABLES = ['annotations'] as const;

/**
 * The passages and notes kept in the open document.
 *
 * Read from this device, which is a bigger change here than it looks. These
 * used to carry Convex optimistic updates — a temporary local edit to a query
 * result, rolled back when the mutation completed — because a list that stays
 * empty for half a second after somebody chose Keep reads as a miss. That
 * machinery is gone and not replaced: the write *is* local, so the row is in
 * the list before the reader's thumb leaves the glass, and it is still there
 * after a force-quit, which an optimistic update never was.
 *
 * **Nothing here logs the text.** It is the reader's own document content and
 * `docs/security.md` reserves the same treatment for it that a selection gets:
 * bounded on the way in, never written to a log, not even its length. The error
 * paths log the failure and stop there.
 */
export function useAnnotations({ documentId }: { documentId: string | undefined }) {
  const showToast = useAppToast();
  const { profileId } = useLibraryStatus();

  const read = useCallback(
    async (db: SQLiteDatabase): Promise<Annotation[]> =>
      documentId === undefined ? [] : await Marks.annotationsOf(db, documentId),
    [documentId],
  );

  const { data } = useLocalQuery(profileId, TABLES, read);
  // Page order, which is reading order.
  const annotations: readonly Annotation[] = data ?? [];

  const keep = useCallback(
    (input: { page: number; kind: 'passage' | 'note'; text?: string; note?: string }) => {
      if (documentId === undefined || profileId === null) {
        return;
      }
      void (async () => {
        try {
          const db = await database(profileId);
          if (db === null) {
            return;
          }
          const id = await Marks.addAnnotation(db, {
            documentId,
            page: input.page,
            kind: input.kind,
            text: input.text ?? null,
            note: input.note ?? null,
          });
          await Queue.enqueue(db, 'annotation', id, 'create');
        } catch (error) {
          log.debug(SCOPE, 'could not keep that');
          showToast({
            id: 'annotation',
            tone: 'error',
            title:
              input.kind === 'passage' ? "Couldn't keep that passage" : "Couldn't save that note",
            description: 'Something went wrong on this device. Try again.',
          });
          void error;
        }
      })();
    },
    [documentId, profileId, showToast],
  );

  const forget = useCallback(
    (annotationId: string) => {
      if (profileId === null) {
        return;
      }
      void (async () => {
        try {
          const db = await database(profileId);
          if (db === null) {
            return;
          }
          await Marks.removeAnnotation(db, annotationId);
          const outcome = await Queue.enqueue(db, 'annotation', annotationId, 'remove');
          // A note written and deleted before the phone found a signal is not
          // two operations that cancel at the account. It is nothing that ever
          // happened, and the row goes with it.
          if (outcome === 'annihilated') {
            await Marks.purgeMarks(db, [annotationId]);
          }
        } catch (error) {
          log.debug(SCOPE, 'could not remove that');
          showToast({
            id: 'annotation',
            tone: 'error',
            title: "Couldn't remove that",
            description: 'Something went wrong on this device. Try again.',
          });
          void error;
        }
      })();
    },
    [profileId, showToast],
  );

  const rewrite = useCallback(
    async (annotationId: string, note: string): Promise<boolean> => {
      if (profileId === null) {
        return false;
      }
      try {
        const db = await database(profileId);
        if (db === null) {
          return false;
        }
        await Marks.updateAnnotation(db, annotationId, note);
        await Queue.enqueue(db, 'annotation', annotationId, 'update', ['note']);
        return true;
      } catch (error: unknown) {
        log.debug(SCOPE, 'could not change that note');
        showToast({
          id: 'annotation',
          tone: 'error',
          title: "Couldn't save that note",
          description: 'Something went wrong on this device. Try again.',
        });
        void error;
        return false;
      }
    },
    [profileId, showToast],
  );

  return { annotations, keep, forget, rewrite };
}
