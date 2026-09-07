import { useCallback, useMemo } from 'react';

import { useSession } from './session-provider';

/**
 * Adapts the Google session to the shape `ConvexProviderWithAuth` expects.
 *
 * Convex calls `fetchAccessToken` when it opens a connection and again whenever
 * it decides the token needs replacing, passing `forceRefreshToken` after a
 * rejection. Both cases route into the session's refresh path, which handles
 * the Android quirks and falls back to the remembered account if a token cannot
 * be renewed.
 *
 * **A remembered account reports as not authenticated, on purpose.** It is a
 * signed-in reader with no token, and saying otherwise would leave the client
 * opening a socket it can never authenticate and re-asking for a credential
 * that is not coming. `isLoading` is false alongside it, because the answer is
 * known — there is no token — rather than pending. Every owner-scoped query in
 * the app already gates on `useLibraryStatus().ready`, so they all skip cleanly
 * and the screens read from the device instead.
 *
 * The identity is not returned here — Convex derives it server-side from the
 * verified JWT. This hook only supplies the credential and the two booleans.
 *
 * https://docs.convex.dev/auth/advanced/custom-auth
 */
export function useConvexGoogleAuth() {
  const { status, offline, fetchIdToken } = useSession();

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
      isAuthenticated: status === 'signed-in' && !offline,
      fetchAccessToken,
    }),
    [status, offline, fetchAccessToken],
  );
}
