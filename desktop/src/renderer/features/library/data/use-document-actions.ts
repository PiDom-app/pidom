import { useCallback } from 'react';
import { useMutation } from 'convex/react';
import { toast } from 'sonner';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';

/**
 * The largest id array a single bulk call accepts, mirroring `BULK_MAX` in
 * `convex/model/limits.ts` and the `collections` IPC schemas. A selection longer
 * than this is split into sequential calls so each local transaction — and the
 * server transaction it later replays to — stays bounded. Keep in sync with the
 * server/IPC bound.
 */
const BULK_MAX = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** "1 document" / "14 documents" — bulk toasts read naturally either way. */
function documentsLabel(count: number): string {
  return `${count} ${count === 1 ? 'document' : 'documents'}`;
}

/**
 * The document management actions the tiles, rows, and context menus call,
 * wrapped once so every entry point reports the same way.
 *
 * Organization writes — collection create/rename/remove, membership, and
 * favorite/finished — go through the local-first `window.pidom.collections`
 * bridge: each lands in the local SQLite mirror and an outbox row instantly
 * (so it works offline) and is replayed to the same owner-checked Convex
 * functions on reconnect. The collection list and a document's membership are
 * read from that mirror (`use-collections-mirror`), so these writes surface at
 * once without a round trip. Document metadata (`rename`, `remove`) stays a
 * direct Convex mutation — that data is still read Convex-primary. No call takes
 * an owner id; identity is the account's verified token, server-side.
 */
export function useDocumentActions() {
  const rename = useMutation(api.library.rename);
  const remove = useMutation(api.library.remove);

  const toggleFavorite = useCallback(async (documentId: Id<'documents'>, isFavorite: boolean) => {
    try {
      await window.pidom.collections.setFavorite([documentId], isFavorite);
    } catch {
      toast.error(isFavorite ? "Couldn't add to favorites" : "Couldn't remove from favorites");
    }
  }, []);

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
    async (collectionId: string, documentId: Id<'documents'>, name: string) => {
      try {
        await window.pidom.collections.addDocuments(collectionId, [documentId]);
        toast.success(`Added to ${name}`);
      } catch {
        toast.error(`Couldn't add to ${name}`);
      }
    },
    [],
  );

  const removeDocumentFromCollection = useCallback(
    async (collectionId: string, documentId: Id<'documents'>, name: string) => {
      try {
        await window.pidom.collections.removeDocuments(collectionId, [documentId]);
        toast.success(`Removed from ${name}`);
      } catch {
        toast.error(`Couldn't remove from ${name}`);
      }
    },
    [],
  );

  /**
   * Creates a collection and returns its id so a caller can add to it next. The
   * id may be a client-minted `col_<hex>` placeholder while offline; the drainer
   * re-keys it to the Convex id when the create syncs, and membership queued
   * against the placeholder rides along.
   */
  const createCollection = useCallback(async (name: string): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    try {
      const summary = await window.pidom.collections.create(trimmed);
      return summary.id;
    } catch {
      toast.error("Couldn't create the collection");
      return null;
    }
  }, []);

  const renameCollection = useCallback(async (collectionId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await window.pidom.collections.rename(collectionId, trimmed);
    } catch {
      toast.error("Couldn't rename the collection");
    }
  }, []);

  const removeCollection = useCallback(async (collectionId: string) => {
    try {
      await window.pidom.collections.remove(collectionId);
      toast.success('Collection deleted');
    } catch {
      toast.error("Couldn't delete the collection");
    }
  }, []);

  /**
   * Marks a document finished or back to unread. The server moves the position
   * to the last page (finished) or the first (unread) against the document's own
   * `pageCount` on replay, so the client need not supply it here.
   */
  const setFinished = useCallback(
    async (documentId: Id<'documents'>, isFinished: boolean, _pageCount?: number) => {
      try {
        await window.pidom.collections.setFinished([documentId], isFinished);
        toast.success(isFinished ? 'Marked as finished' : 'Marked as unread');
      } catch {
        toast.error("Couldn't update this document");
      }
    },
    [],
  );

  const favoriteMany = useCallback(
    async (documentIds: Id<'documents'>[], isFavorite: boolean): Promise<boolean> => {
      if (documentIds.length === 0) return false;
      try {
        for (const batch of chunk(documentIds, BULK_MAX)) {
          await window.pidom.collections.setFavorite(batch, isFavorite);
        }
        toast.success(
          isFavorite
            ? `Added ${documentsLabel(documentIds.length)} to favorites`
            : `Removed ${documentsLabel(documentIds.length)} from favorites`,
        );
        return true;
      } catch {
        toast.error("Couldn't update favorites");
        return false;
      }
    },
    [],
  );

  const setFinishedMany = useCallback(
    async (documentIds: Id<'documents'>[], isFinished: boolean): Promise<boolean> => {
      if (documentIds.length === 0) return false;
      try {
        for (const batch of chunk(documentIds, BULK_MAX)) {
          await window.pidom.collections.setFinished(batch, isFinished);
        }
        toast.success(
          isFinished
            ? `Marked ${documentsLabel(documentIds.length)} finished`
            : `Marked ${documentsLabel(documentIds.length)} unread`,
        );
        return true;
      } catch {
        toast.error("Couldn't update these documents");
        return false;
      }
    },
    [],
  );

  const addManyToCollection = useCallback(
    async (collectionId: string, documentIds: Id<'documents'>[], name: string): Promise<boolean> => {
      if (documentIds.length === 0) return false;
      try {
        for (const batch of chunk(documentIds, BULK_MAX)) {
          await window.pidom.collections.addDocuments(collectionId, batch);
        }
        toast.success(`Added ${documentsLabel(documentIds.length)} to ${name}`);
        return true;
      } catch {
        toast.error(`Couldn't add to ${name}`);
        return false;
      }
    },
    [],
  );

  const removeManyFromCollection = useCallback(
    async (collectionId: string, documentIds: Id<'documents'>[], name: string): Promise<boolean> => {
      if (documentIds.length === 0) return false;
      try {
        for (const batch of chunk(documentIds, BULK_MAX)) {
          await window.pidom.collections.removeDocuments(collectionId, batch);
        }
        toast.success(`Removed ${documentsLabel(documentIds.length)} from ${name}`);
        return true;
      } catch {
        toast.error(`Couldn't remove from ${name}`);
        return false;
      }
    },
    [],
  );

  return {
    toggleFavorite,
    renameDocument,
    removeDocument,
    addDocumentToCollection,
    removeDocumentFromCollection,
    createCollection,
    renameCollection,
    removeCollection,
    setFinished,
    favoriteMany,
    setFinishedMany,
    addManyToCollection,
    removeManyFromCollection,
  };
}
