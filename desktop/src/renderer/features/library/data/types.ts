import type { FunctionReturnType } from 'convex/server';
import type { api } from '@convex/api';

/**
 * The library wire shapes, derived from the Convex functions' own return
 * validators rather than re-declared here. A field added or renamed on the
 * backend is a type error in the renderer on the next build, so the two cannot
 * drift, and no server-only code is imported into the sandboxed renderer.
 */
export type HomeData = FunctionReturnType<typeof api.library.home>;

/** One document as it appears on any rail or in the library view. */
export type LibraryDocument = HomeData['recentlyAdded'][number];

/** One collection summary, with the ids its cover mosaic draws. */
export type LibraryCollection = HomeData['collections'][number];
