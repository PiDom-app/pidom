import { useCallback, useMemo } from 'react';
import { useMutation, usePaginatedQuery } from 'convex/react';
import { toast } from 'sonner';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';
import { ANNOTATION_TEXT_MAX } from '@convex-model/limits';

export interface Passage {
  id: Id<'documentAnnotations'>;
  page: number;
  text: string | null;
}

/**
 * An id the device files a create under, in the one shape the account accepts.
 *
 * The backend guards `clientOpId` with `/^[a-z0-9]{16,64}$/` — thirty-two hex
 * characters, the shape mobile's `mintId` produces — because it is written to an
 * index and a client should not be able to put an arbitrary string there. A raw
 * `crypto.randomUUID()` carries dashes and fails that check, so every keep threw
 * "That note id is not one Pidom writes." Stripping them matches the mobile
 * outbox exactly (`src/features/library/local/repository/ids.ts`).
 */
function mintOpId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * The passages kept out of this document, and the two writes the reader makes
 * against them.
 *
 * `passage` is the only kind still written — the note half of the feature was
 * removed backend-side — so a text selection turned into a highlight is an
 * `addAnnotation` and nothing else. As with bookmarks, the account hands back
 * every document's passages in one paginated read and this filters to the open
 * one; a `clientOpId` makes a create safe to deliver twice, matching the mobile
 * outbox.
 */
export function useAnnotations(documentId: Id<'documents'>): {
  passages: Passage[];
  keep: (page: number, text: string) => void;
  remove: (id: Id<'documentAnnotations'>) => void;
} {
  const { results } = usePaginatedQuery(api.library.allAnnotations, {}, { initialNumItems: 400 });
  const add = useMutation(api.library.addAnnotation);
  const removeAnnotation = useMutation(api.library.removeAnnotation);

  const passages = useMemo<Passage[]>(
    () =>
      results
        .filter((a) => a.documentId === documentId)
        .map((a) => ({ id: a.id, page: a.page, text: a.text }))
        .sort((a, b) => a.page - b.page),
    [results, documentId],
  );

  const keep = useCallback(
    (page: number, text: string) => {
      const trimmed = text.trim().slice(0, ANNOTATION_TEXT_MAX);
      if (!trimmed) return;
      void add({
        documentId,
        currentPage: page,
        text: trimmed,
        clientOpId: mintOpId(),
        clientUpdatedAt: Date.now(),
      })
        .then(() => toast.success('Highlight kept'))
        .catch(() => toast.error("Couldn't keep this highlight"));
    },
    [add, documentId],
  );

  const remove = useCallback(
    (id: Id<'documentAnnotations'>) => {
      void removeAnnotation({ annotationId: id }).catch(() =>
        toast.error("Couldn't remove this highlight"),
      );
    },
    [removeAnnotation],
  );

  return { passages, keep, remove };
}
