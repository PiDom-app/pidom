import { useMutation, useQuery } from 'convex/react';
import { useCallback, useMemo } from 'react';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { log } from '@/lib/logger';

import { messageOf } from '../library/data/errors';

const SCOPE = 'reader-notes';

export type Annotation = {
  id: Id<'documentAnnotations'>;
  page: number;
  kind: 'passage' | 'note';
  text: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
};

/**
 * The passages and notes kept in the open document.
 *
 * Subscribed for the whole session rather than only while the sheet is open,
 * for the reason `use-bookmarks.ts` gives: the count is on the segment label, so
 * it has to be right before anybody opens anything.
 *
 * **Nothing here logs the text.** It is the reader's own document content and
 * `docs/security.md` reserves the same treatment for it that a selection gets:
 * bounded on the way in, never written to a log, not even its length. The error
 * paths log the failure and the id and stop there.
 *
 * `add` and `remove` carry optimistic updates, which bookmarks do not. A
 * bookmark's feedback is an icon that fills, and the round trip is over before
 * anybody has taken their thumb off it. Keeping a passage puts a row in a list
 * the reader is about to look at, and a list that stays empty for half a second
 * after they chose Keep reads as a miss.
 */
export function useAnnotations({
  documentId,
  ready,
}: {
  documentId: Id<'documents'> | undefined;
  ready: boolean;
}) {
  const showToast = useAppToast();
  const rows = useQuery(
    api.library.annotations,
    ready && documentId !== undefined ? { documentId } : 'skip',
  );

  const add = useMutation(api.library.addAnnotation).withOptimisticUpdate(
    (store, args) => {
      const current = store.getQuery(api.library.annotations, { documentId: args.documentId });
      if (current === undefined) {
        return;
      }
      // A new array and a new object. Convex's own documentation is explicit
      // that mutating what `getQuery` returned corrupts the client's store.
      //
      // The id is a placeholder the server replaces when the mutation lands.
      // It has to be *something* for the list's `keyExtractor`, and it has to
      // be one that cannot collide with a real row, so it is not an id shape.
      //
      // The timestamps are zero rather than invented. Nothing renders them, and
      // a made-up `createdAt` that the server then corrects is a value that was
      // briefly wrong for no reason.
      store.setQuery(
        api.library.annotations,
        { documentId: args.documentId },
        [
          ...current,
          {
            // Derived, not counted. A counter would be a module variable
            // reassigned outside render, and `Date.now()` would give two
            // passages kept in the same millisecond one key between them. The
            // list length is already unique per queued write, because each one
            // adds a row before the next runs.
            id: `pending-${current.length}-${args.currentPage}` as Id<'documentAnnotations'>,
            page: args.currentPage,
            kind: args.kind,
            text: args.text ?? null,
            note: args.note ?? null,
            createdAt: 0,
            updatedAt: 0,
          },
        ].sort((a, b) => a.page - b.page),
      );
    },
  );

  const remove = useMutation(api.library.removeAnnotation).withOptimisticUpdate(
    (store, args) => {
      // The mutation names only the annotation, so the document it belongs to
      // has to be found among the queries the store is holding. There is one
      // reader open, so in practice this is a list of one.
      for (const q of store.getAllQueries(api.library.annotations)) {
        if (q.value === undefined) {
          continue;
        }
        const next = q.value.filter((row) => row.id !== args.annotationId);
        if (next.length !== q.value.length) {
          store.setQuery(api.library.annotations, q.args, next);
        }
      }
    },
  );

  const update = useMutation(api.library.updateAnnotation);

  const annotations = useMemo<readonly Annotation[]>(
    () =>
      ((rows ?? []) as Annotation[])
        .map((row) => ({ ...row }))
        // Page order, which is reading order. The server returns them that way
        // already; sorting again costs nothing and means an optimistic row
        // inserted here lands in the right place too.
        .sort((a, b) => a.page - b.page),
    [rows],
  );

  const keep = useCallback(
    (input: { page: number; kind: 'passage' | 'note'; text?: string; note?: string }) => {
      if (documentId === undefined) {
        return;
      }
      add({
        documentId,
        currentPage: input.page,
        kind: input.kind,
        ...(input.text === undefined ? {} : { text: input.text }),
        ...(input.note === undefined ? {} : { note: input.note }),
      }).catch((error: unknown) => {
        log.debug(SCOPE, 'could not keep that');
        showToast({
          id: 'annotation',
          tone: 'error',
          title: input.kind === 'passage' ? "Couldn't keep that passage" : "Couldn't save that note",
          description: messageOf(error, 'Try again in a moment.'),
        });
      });
    },
    [documentId, add, showToast],
  );

  const forget = useCallback(
    (annotationId: Id<'documentAnnotations'>) => {
      remove({ annotationId }).catch((error: unknown) => {
        log.debug(SCOPE, 'could not remove that');
        showToast({
          id: 'annotation',
          tone: 'error',
          title: "Couldn't remove that",
          description: messageOf(error, 'Try again in a moment.'),
        });
      });
    },
    [remove, showToast],
  );

  const rewrite = useCallback(
    async (annotationId: Id<'documentAnnotations'>, note: string): Promise<boolean> => {
      try {
        await update({ annotationId, note });
        return true;
      } catch (error: unknown) {
        log.debug(SCOPE, 'could not change that note');
        showToast({
          id: 'annotation',
          tone: 'error',
          title: "Couldn't save that note",
          description: messageOf(error, 'Try again in a moment.'),
        });
        return false;
      }
    },
    [update, showToast],
  );

  return { annotations, keep, forget, rewrite };
}
