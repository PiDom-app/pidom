import { useQuery } from 'convex/react';
import { api } from '@convex/api';
import type { HomeData } from './types';

/**
 * The Home workspace's five rails, read reactively from Convex.
 *
 * The mobile app is offline-first (a local SQLite mirror with a reconcile
 * engine); the desktop reads Convex directly for now — the same `library.home`
 * query, authorised server-side by the account's verified identity. A local
 * mirror is a later addition, not a prerequisite for showing the library.
 *
 * Returns `undefined` while the first result is in flight so callers can show a
 * skeleton; Convex keeps it live after that.
 */
export function useHome(): HomeData | undefined {
  return useQuery(api.library.home, {});
}
