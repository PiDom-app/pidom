import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { isExpired, isExpiring } from '@/lib/jwt';
import { log } from '@/lib/logger';

import {
  clearTokenCache,
  configureGoogleSignIn,
  hasPreviousSignIn,
  signInInteractively,
  signInSilently,
  signOut as googleSignOut,
  type GoogleAccount,
  type GoogleFailureReason,
} from './google-client';

const SCOPE = 'session';

export type SessionStatus = 'loading' | 'signed-out' | 'signed-in';

export type SessionContextValue = {
  status: SessionStatus;
  /** The Google account, present exactly when `status === 'signed-in'`. */
  account: GoogleAccount | null;
  /** Why the last interactive attempt failed. Cleared on the next attempt. */
  lastFailure: GoogleFailureReason | null;
  /** Opens the native sheet. Resolves once the session has settled. */
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * A valid ID token, refreshing if needed, or `null` when the session is over.
   *
   * This is the one seam through which a credential leaves the module, and it
   * exists for `useConvexGoogleAuth`. UI code has no reason to call it.
   */
  fetchIdToken: (options: { forceRefresh: boolean }) => Promise<string | null>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Owns the Google session for the whole app.
 *
 * This sits *above* the Convex provider, because `ConvexProviderWithAuth` calls
 * its `useAuth` hook from inside its own tree and that hook reads from here.
 * The Convex-side profile row is bootstrapped separately, inside the
 * authenticated shell — see `use-profile-bootstrap.ts`.
 *
 * It is also the swap point. If the Android refresh path proves too unreliable
 * in the field, exchanging the Google token once for a backend-issued session
 * means reworking this file and leaving every consumer untouched.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [account, setAccount] = useState<GoogleAccount | null>(null);
  const [lastFailure, setLastFailure] = useState<GoogleFailureReason | null>(null);

  /**
   * The live token. A ref rather than state because `fetchIdToken` is called
   * from outside React's render cycle by the Convex client, and needs the
   * current value rather than the one captured when a callback was created.
   */
  const tokenRef = useRef<string | null>(null);

  /**
   * The in-flight refresh, shared by every concurrent caller.
   *
   * Convex can ask several times in quick succession when a reconnect coincides
   * with an expiry. Without this, each request would open its own native
   * refresh and they would race to write different tokens.
   */
  const refreshRef = useRef<Promise<string | null> | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applySignedIn = useCallback((nextAccount: GoogleAccount, idToken: string) => {
    // The token lives in memory for the life of the session and nowhere else.
    // Google's native SDK is what persists the account across launches, so
    // there is nothing here worth writing to the keychain — a stored copy would
    // be a credential at rest that the app never actually spends.
    tokenRef.current = idToken;
    if (mountedRef.current) {
      setAccount(nextAccount);
      setLastFailure(null);
      setStatus('signed-in');
    }
  }, []);

  const applySignedOut = useCallback((reason: GoogleFailureReason | null) => {
    tokenRef.current = null;
    if (mountedRef.current) {
      setAccount(null);
      setLastFailure(reason);
      setStatus('signed-out');
    }
  }, []);

  /** Cold launch: restore a session without showing anything. */
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      configureGoogleSignIn();

      // Synchronous and offline. A first-ever launch settles on the sign-in
      // screen immediately rather than holding the splash through a network
      // round trip that was always going to fail.
      if (!hasPreviousSignIn()) {
        if (!cancelled) {
          applySignedOut(null);
        }
        return;
      }

      const result = await signInSilently();
      if (cancelled) {
        return;
      }

      if (result.ok) {
        if (isExpired(result.idToken)) {
          // Google restored the account but the token it handed back is already
          // dead — the Android refresh problem, hit on the very first call.
          log.error(SCOPE, 'restored session returned an expired token');
          applySignedOut('unknown');
          return;
        }
        applySignedIn(result.account, result.idToken);
        return;
      }

      // `no-saved-credential` is the ordinary "signed out" answer, not a
      // failure worth reporting. Anything else is.
      applySignedOut(result.reason === 'no-saved-credential' ? null : result.reason);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applySignedIn, applySignedOut]);

  const signIn = useCallback(async () => {
    setLastFailure(null);
    const result = await signInInteractively();

    if (result.ok && !isExpired(result.idToken)) {
      applySignedIn(result.account, result.idToken);
      return;
    }
    applySignedOut(result.ok ? 'unknown' : result.reason);
  }, [applySignedIn, applySignedOut]);

  const signOut = useCallback(async () => {
    await googleSignOut();
    applySignedOut(null);
  }, [applySignedOut]);

  /**
   * Mints a new ID token.
   *
   * Google ID tokens last an hour, and Convex re-authenticates its socket on
   * its own schedule, so this has to work unattended. On iOS the library
   * refreshes transparently; on Android it has a long history of handing back
   * the cached, expired token, so the cache is cleared first and the result is
   * checked rather than trusted.
   *
   * https://github.com/react-native-google-signin/google-signin/issues/926
   */
  const refresh = useCallback(async (): Promise<string | null> => {
    await clearTokenCache();
    const result = await signInSilently();

    if (!result.ok) {
      log.warn(SCOPE, `refresh failed: ${result.reason}`);
      applySignedOut(result.reason === 'no-saved-credential' ? null : result.reason);
      return null;
    }

    if (isExpired(result.idToken)) {
      // The safety net. A silent sign-in that returns a still-expired token
      // means the refresh did not take, and every subsequent query would be
      // rejected. Ending the session sends the reader to a screen they can act
      // on instead of leaving the app spinning against a backend that will
      // never answer.
      log.error(SCOPE, 'silent sign-in returned an expired token; ending session');
      applySignedOut('unknown');
      return null;
    }

    applySignedIn(result.account, result.idToken);
    return result.idToken;
  }, [applySignedIn, applySignedOut]);

  const fetchIdToken = useCallback(
    async ({ forceRefresh }: { forceRefresh: boolean }): Promise<string | null> => {
      const current = tokenRef.current;

      // Refresh ahead of the expiry rather than at it, so an in-flight query
      // does not arrive at the backend with a token that died on the way.
      if (!forceRefresh && current !== null && !isExpiring(current)) {
        return current;
      }

      if (refreshRef.current === null) {
        refreshRef.current = refresh().finally(() => {
          refreshRef.current = null;
        });
      }
      return await refreshRef.current;
    },
    [refresh],
  );

  const value = useMemo<SessionContextValue>(
    () => ({ status, account, lastFailure, signIn, signOut, fetchIdToken }),
    [status, account, lastFailure, signIn, signOut, fetchIdToken],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error('useSession must be used inside <SessionProvider>.');
  }
  return value;
}
