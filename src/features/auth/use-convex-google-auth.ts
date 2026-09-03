import { useCallback, useMemo } from 'react';

import { useSession } from './session-provider';

/**
 * Adapts the Google session to the shape `ConvexProviderWithAuth` expects.
 *
 * Convex calls `fetchAccessToken` when it opens a connection and again whenever
 * it decides the token needs replacing, passing `forceRefreshToken` after a
 * rejection. Both cases route into the session's refresh path, which handles
 * the Android quirks and ends the session if a token cannot be renewed.
 *
 * The identity is not returned here — Convex derives it server-side from the
 * verified JWT. This hook only supplies the credential and the two booleans.
 *
 * https://docs.convex.dev/auth/advanced/custom-auth
 */
export function useConvexGoogleAuth() {
  const { status, fetchIdToken } = useSession();

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) =>
      await fetchIdToken({ forceRefresh: forceRefreshToken }),
    [fetchIdToken],
  );

  // The identity of this object matters: Convex resets to loading and re-fetches
  // whenever the hook's return value changes, so it must stay stable while the
  // session does.
  return useMemo(
    () => ({
      isLoading: status === 'loading',
      isAuthenticated: status === 'signed-in',
      fetchAccessToken,
    }),
    [status, fetchAccessToken],
  );
}
