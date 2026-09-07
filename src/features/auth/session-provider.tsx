import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { hasNetworkNow, watchNetwork } from '@/lib/connectivity';
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
import {
  forgetAccount,
  isWithinGrace,
  readAccount,
  rememberAccount,
  type LocalAccount,
} from './local-account';

const SCOPE = 'session';

export type SessionStatus = 'loading' | 'signed-out' | 'signed-in';

export type SessionContextValue = {
  status: SessionStatus;
  /** The Google account, present exactly when `status === 'signed-in'`. */
  account: GoogleAccount | null;
  /**
   * Signed in on a remembered account rather than a verified one.
   *
   * True when Google could not be reached at launch, or when a refresh failed
   * for any reason other than the account being gone, and this device has a
   * remembered account inside its grace window. The reader keeps their library
   * and their documents; the backend keeps refusing, because there is no token
   * to send it. Consumers use this to skip owner-scoped queries rather than
   * letting them hang.
   */
  offline: boolean;
  /**
   * The record the reader is running on while `offline` is true.
   *
   * Carries the profile id, which is what names the library directory and the
   * database — and which the backend cannot be asked for. `useProfile` reads it
   * so that every screen below has a profile to work from with no connection.
   */
  remembered: LocalAccount | null;
  /** Why the last interactive attempt failed. Cleared on the next attempt. */
  lastFailure: GoogleFailureReason | null;
  /** Opens the native sheet. Resolves once the session has settled. */
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * A valid ID token, refreshing if needed, or `null` when the session is over
   * or is running on a remembered account.
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
 * authenticated shell — see `use-profile.ts`.
 *
 * **Identity and access are two different things, and this file is where they
 * separate.** A token is what reaches the backend. It is not what opens a PDF
 * that is already on the disk. Before this distinction existed, a cold launch
 * with no network went: `signInSilently` throws, the failure classifies as
 * `network`, the session ends, and the router sends a reader with a full
 * library to a sign-in button that cannot work until they find wifi. Now a
 * failure that is not "this account is gone" falls back to the remembered
 * account in `local-account.ts` and the app opens.
 *
 * It is also the swap point. If the Android refresh path proves too unreliable
 * in the field, exchanging the Google token once for a backend-issued session
 * means reworking this file and leaving every consumer untouched.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [account, setAccount] = useState<GoogleAccount | null>(null);
  const [offline, setOffline] = useState(false);
  const [remembered, setRemembered] = useState<LocalAccount | null>(null);
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

    // The account, on the other hand, is worth writing down: it is the only
    // record of *which* library is on this device, and the next cold launch may
    // not have a network to ask Google with. `verifiedAt` is stamped here and
    // only here, because here is where a token was actually verified.
    void rememberAccount({
      googleId: nextAccount.id,
      email: nextAccount.email,
      name: nextAccount.name,
      photoUrl: nextAccount.photoUrl,
      verifiedAt: Date.now(),
    });

    if (mountedRef.current) {
      setAccount(nextAccount);
      setOffline(false);
      setRemembered(null);
      setLastFailure(null);
      setStatus('signed-in');
    }
  }, []);

  /** Signed in on the record rather than on a token. */
  const applyRemembered = useCallback((next: LocalAccount) => {
    tokenRef.current = null;
    if (mountedRef.current) {
      setAccount({
        id: next.googleId,
        email: next.email,
        name: next.name,
        photoUrl: next.photoUrl,
      });
      setOffline(true);
      setRemembered(next);
      setLastFailure(null);
      setStatus('signed-in');
    }
  }, []);

  const applySignedOut = useCallback((reason: GoogleFailureReason | null) => {
    tokenRef.current = null;
    if (mountedRef.current) {
      setAccount(null);
      setOffline(false);
      setRemembered(null);
      setLastFailure(reason);
      setStatus('signed-out');
    }
  }, []);

  /**
   * What to do when Google could not mint a token.
   *
   * `no-saved-credential` is the one answer that means the account is genuinely
   * gone: Google has nothing to restore, so neither should this device. Every
   * other reason — a network that is not there, Play Services mid-update, an
   * error nobody has classified yet — is a failure to *reach* an identity, not
   * a statement that there is not one. Those fall back to the record, so long
   * as the record is complete and inside its grace window.
   */
  const applyFailure = useCallback(
    async (reason: GoogleFailureReason) => {
      if (reason === 'no-saved-credential') {
        await forgetAccount();
        applySignedOut(null);
        return;
      }

      const stored = await readAccount();
      if (stored === null) {
        applySignedOut(reason);
        return;
      }

      if (!isWithinGrace(stored, Date.now())) {
        // Past the window, this device has to prove itself again before it
        // opens anybody's documents. The record goes with it, so the next
        // failure is not answered from a stale identity either.
        log.warn(SCOPE, 'remembered account is past its grace window');
        await forgetAccount();
        applySignedOut(reason);
        return;
      }

      log.debug(SCOPE, `continuing on the remembered account after ${reason}`);
      applyRemembered(stored);
    },
    [applyRemembered, applySignedOut],
  );

  /** Cold launch: restore a session without showing anything. */
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      configureGoogleSignIn();

      // Synchronous and offline. A first-ever launch settles on the sign-in
      // screen immediately rather than holding the splash through a network
      // round trip that was always going to fail. It is also the check that
      // keeps a remembered account from outliving a sign-out performed from
      // outside the app — Google is still the authority on whether an account
      // is signed in on this device.
      if (!hasPreviousSignIn()) {
        await forgetAccount();
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
          // That is a failure to reach an identity like any other, so the
          // library still opens on the record.
          log.error(SCOPE, 'restored session returned an expired token');
          await applyFailure('unknown');
          return;
        }
        applySignedIn(result.account, result.idToken);
        return;
      }

      await applyFailure(result.reason);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applyFailure, applySignedIn, applySignedOut]);

  const signIn = useCallback(async () => {
    setLastFailure(null);
    const result = await signInInteractively();

    if (result.ok && !isExpired(result.idToken)) {
      applySignedIn(result.account, result.idToken);
      return;
    }
    // Deliberately not `applyFailure`: this is somebody standing in front of
    // the sheet asking to sign in. Answering with a remembered identity would
    // silently ignore what they just did.
    applySignedOut(result.ok ? 'unknown' : result.reason);
  }, [applySignedIn, applySignedOut]);

  const signOut = useCallback(async () => {
    await googleSignOut();
    await forgetAccount();
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
      await applyFailure(result.reason);
      return null;
    }

    if (isExpired(result.idToken)) {
      // The safety net. A silent sign-in that returns a still-expired token
      // means the refresh did not take, and every subsequent query would be
      // rejected. Falling back to the record keeps the reader in their library
      // — which is the part that never needed the token — while the backend
      // stays honestly out of reach until a refresh works.
      log.error(SCOPE, 'silent sign-in returned an expired token');
      await applyFailure('unknown');
      return null;
    }

    applySignedIn(result.account, result.idToken);
    return result.idToken;
  }, [applyFailure, applySignedIn]);

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

  /**
   * Try again when a network comes back.
   *
   * Without this a reader who launched in a tunnel stays on the remembered
   * account until something else happens to ask for a token — and nothing does,
   * because `useConvexGoogleAuth` reports `isAuthenticated: false` while
   * offline, so Convex never opens a socket and never asks. The subscription is
   * the shared one; it costs no extra native listener.
   */
  useEffect(() => {
    if (!offline) {
      return;
    }

    let cancelled = false;

    const stop = watchNetwork(() => {
      if (cancelled || !hasNetworkNow()) {
        return;
      }
      if (refreshRef.current !== null) {
        return;
      }
      log.debug(SCOPE, 'network is back; retrying the identity');
      refreshRef.current = refresh().finally(() => {
        refreshRef.current = null;
      });
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [offline, refresh]);

  const value = useMemo<SessionContextValue>(
    () => ({ status, account, offline, remembered, lastFailure, signIn, signOut, fetchIdToken }),
    [status, account, offline, remembered, lastFailure, signIn, signOut, fetchIdToken],
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
