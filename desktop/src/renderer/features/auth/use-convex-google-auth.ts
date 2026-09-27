import { useCallback, useMemo } from 'react';
import { useSession } from '../../providers/session-provider';

/**
 * Adapts the desktop Google session to the shape `ConvexProviderWithAuth`
 * expects. Ported from the mobile app's use-convex-google-auth.ts — same
 * contract, different token source (IPC to the main process rather than the
 * native Google SDK).
 *
 * Convex calls `fetchAccessToken` when it opens a connection and again whenever
 * it needs to replace the token, passing `forceRefreshToken` after a rejection.
 * The identity is never returned here — Convex derives it server-side from the
 * verified JWT. This hook only supplies the credential and the two booleans.
 *
 * The return object's identity must stay stable while the session does: Convex
 * resets to loading and re-fetches whenever it changes.
 */
export function useConvexGoogleAuth() {
  const { status, fetchIdToken } = useSession();

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) =>
      await fetchIdToken({ forceRefresh: forceRefreshToken }),
    [fetchIdToken],
  );

  return useMemo(
    () => ({
      isLoading: status === 'loading',
      isAuthenticated: status === 'signed-in',
      fetchAccessToken,
    }),
    [status, fetchAccessToken],
  );
}
