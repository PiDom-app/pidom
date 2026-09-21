import { useCallback } from 'react';
import { useMutation } from 'convex/react';
import { toast } from 'sonner';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';

/**
 * The document management mutations the tiles, rows, and context menus call,
 * wrapped once so every entry point reports the same way. Each mutation is
 * authorised server-side by the account's identity; none takes an owner id.
 */
export function useDocumentActions() {
  const setFavorite = useMutation(api.library.setFavorite);
  const rename = useMutation(api.library.rename);
  const remove = useMutation(api.library.remove);
  const addToCollection = useMutation(api.collections.addDocument);

  const toggleFavorite = useCallback(
    async (documentId: Id<'documents'>, isFavorite: boolean) => {
      try {
        await setFavorite({ documentId, isFavorite });
      } catch {
        toast.error(isFavorite ? "Couldn't add to favorites" : "Couldn't remove from favorites");
      }
    },
    [setFavorite],
  );

  const renameDocument = useCallback(
    async (documentId: Id<'documents'>, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      try {
        await rename({ documentId, title: trimmed });
      } catch {
        toast.error("Couldn't rename this document");
      }
    },
    [rename],
  );

  const removeDocument = useCallback(
    async (documentId: Id<'documents'>) => {
      try {
        await remove({ documentId });
        toast.success('Removed from your library');
      } catch {
        toast.error("Couldn't remove this document");
      }
    },
    [remove],
  );

  const addDocumentToCollection = useCallback(
    async (collectionId: Id<'collections'>, documentId: Id<'documents'>, name: string) => {
      try {
        await addToCollection({ collectionId, documentId });
        toast.success(`Added to ${name}`);
      } catch {
        toast.error(`Couldn't add to ${name}`);
      }
    },
    [addToCollection],
  );

  return { toggleFavorite, renameDocument, removeDocument, addDocumentToCollection };
}
