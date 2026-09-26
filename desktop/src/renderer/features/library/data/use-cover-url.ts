import { useQuery } from '@tanstack/react-query';
import { useConvex } from 'convex/react';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';

/** The signed cover URL lives four minutes; a mint is a five-minute window. */
const COVER_STALE_MS = 4 * 60 * 1000;

/**
 * A short-lived signed URL for a document's cover, minted on demand.
 *
 * `library.downloadUrl` is a mutation, not a query — a cached reactive URL that
 * outlived its signature would be a broken image for no visible reason. So it is
 * cached here through TanStack Query keyed by document id, re-minted just before
 * the signature expires, and fetched lazily (pass `enabled: false` until a tile
 * is on screen). Returns null when the document has no cover yet.
 */
export function useCoverUrl(documentId: Id<'documents'>, enabled = true): string | null {
  const convex = useConvex();
  const { data } = useQuery({
    queryKey: ['cover', documentId],
    queryFn: () => convex.mutation(api.library.downloadUrl, { documentId, what: 'cover' }),
    staleTime: COVER_STALE_MS,
    gcTime: COVER_STALE_MS,
    enabled,
    retry: 1,
  });
  return data ?? null;
}
