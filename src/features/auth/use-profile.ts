import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { useEffect, useRef } from 'react';

import { api } from '@convex/_generated/api';
import { log } from '@/lib/logger';

const SCOPE = 'profile';

export type Profile = {
  id: string;
  email: string;
  name: string | null;
  pictureUrl: string | null;
  createdAt: number;
};

export type ProfileState = {
  profile: Profile | null;
  /** True while the answer is still unknown — not the same as "no profile". */
  loading: boolean;
};

/**
 * Reads the signed-in reader's profile. Safe to call from any screen.
 *
 * Creating the row is a separate concern — see `useEnsureProfile`, which runs
 * once in the authenticated layout.
 */
export function useProfile(): ProfileState {
  const { isAuthenticated, isLoading } = useConvexAuth();

  // `undefined` while in flight, `null` once the server has answered "no row".
  const profile = useQuery(api.users.me, isAuthenticated ? {} : 'skip');

  return {
    profile: profile ?? null,
    loading: isLoading || (isAuthenticated && profile === undefined),
  };
}

/**
 * Creates the `users` row on first authenticated launch.
 *
 * Mount this exactly once, in the authenticated layout. Screens read through
 * `useProfile`; if they each owned the bootstrap too, every screen mounted
 * before the row existed would fire its own mutation.
 *
 * It keys off `useConvexAuth` rather than the session status because the two
 * are different moments: the session turns `signed-in` when Google hands over a
 * token, while Convex turns authenticated only once it has verified that token
 * against Google's JWKS. A mutation sent in the gap fails `UNAUTHENTICATED`.
 */
export function useEnsureProfile(): void {
  const { isAuthenticated } = useConvexAuth();
  const ensureProfile = useMutation(api.users.ensureProfile);
  const profile = useQuery(api.users.me, isAuthenticated ? {} : 'skip');

  // The mutation is idempotent, but without this it would fire on every render
  // until the query caught up.
  const requestedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      requestedRef.current = false;
      return;
    }
    // `undefined` means the query has not answered yet; only an explicit `null`
    // means there is no row to read.
    if (profile !== null || requestedRef.current) {
      return;
    }

    requestedRef.current = true;
    ensureProfile().catch((error: unknown) => {
      // Usually a dropped connection rather than a rejection, so let the next
      // authenticated render try again.
      requestedRef.current = false;
      log.error(SCOPE, 'could not create profile', error);
    });
  }, [isAuthenticated, profile, ensureProfile]);
}
