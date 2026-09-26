import { useQuery } from 'convex/react';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';
import type { FunctionReturnType } from 'convex/server';

export type OutlineEntry = FunctionReturnType<typeof api.library.outline>[number];

/**
 * The document's table of contents, or an empty list when it has none.
 *
 * Server-side because the outline is produced on whichever device imported the
 * file and pushed up with the page count and cover; a desktop that only ever
 * streamed the document never ran that probe, so this is the one place the
 * contents live for it. `undefined` while the query is in flight.
 */
export function useOutline(documentId: Id<'documents'>): OutlineEntry[] | undefined {
  return useQuery(api.library.outline, { documentId });
}
