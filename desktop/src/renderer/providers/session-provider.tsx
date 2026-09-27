import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthState } from '../../shared/ipc';

/**
 * Google identity, held in the main process and mirrored here over IPC. This is
 * the desktop counterpart to the mobile app's src/features/auth/session-provider.
 *
 * The renderer never sees the refresh token or the client secret; it can only
 * ask for the current ID token (`fetchIdToken`) and read the coarse auth state.
 * Identity itself is derived server-side by Convex from the verified JWT — the
 * `profile` here carries display claims only.
 *
 * This provider MUST sit above ConvexProvider (see app-providers), because
 * `ConvexProviderWithAuth` calls `useConvexGoogleAuth` from inside its tree and
 * that hook reads this context.
 */
interface SessionContextValue extends AuthState {
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  fetchIdToken: (opts: { forceRefresh: boolean }) => Promise<string | null>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Whether two auth states carry the same identity and status. A background
 *  token refresh re-emits an identical `signed-in` state; treating that as a
 *  change would replace the context value and re-render every consumer (and, at
 *  the `_app` gate, risk churning the whole workspace) for no actual change. */
function sameAuth(a: AuthState, b: AuthState): boolean {
  if (a.status !== b.status) return false;
  const pa = a.profile;
  const pb = b.profile;
  if (pa === pb) return true;
  if (!pa || !pb) return false;
  return (
    pa.subject === pb.subject &&
    pa.email === pb.email &&
    pa.name === pb.name &&
    pa.picture === pb.picture
  );
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', profile: null });

  // Only advance state on a genuine change, so identical re-emits are no-ops.
  const applyState = useCallback((next: AuthState) => {
    setState((prev) => {
      // A resolved session must never regress to the boot `loading` state. The
      // initial `auth.status()` pull and the `onChange` push race once the main
      // process restores asynchronously, and the pull can resolve with a stale
      // `loading` after the push already delivered signed-in/-out. The only
      // `loading` the main process emits is that boot case; `signIn()` sets
      // `loading` through its own local setState, never through applyState.
      if (next.status === 'loading' && prev.status !== 'loading') return prev;
      return sameAuth(prev, next) ? prev : next;
    });
  }, []);

  useEffect(() => {
    // The preload defines `window.pidom`; if it failed to load, the bridge is
    // absent. Degrade to signed-out rather than throwing "reading 'auth'" from
    // an undefined bridge, which would take the whole renderer down.
    const auth = window.pidom?.auth;
    if (!auth) {
      setState({ status: 'signed-out', profile: null });
      return;
    }
    let active = true;
    void auth.status().then((s) => active && applyState(s));
    const unsubscribe = auth.onChange(applyState);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [applyState]);

  const signIn = useCallback(async () => {
    const auth = window.pidom?.auth;
    if (!auth) throw new Error('The app bridge is unavailable. Restart Pidom and try again.');
    setState((prev) => ({ ...prev, status: 'loading' }));
    try {
      setState(await auth.signIn());
    } catch (error) {
      // A cancelled or failed sign-in rejects in the main process without
      // changing its state; re-read it so the UI leaves `loading` instead of
      // hanging on the spinner, then rethrow so the caller can surface it.
      setState(await auth.status());
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    const auth = window.pidom?.auth;
    if (!auth) return setState({ status: 'signed-out', profile: null });
    setState(await auth.signOut());
  }, []);

  const fetchIdToken = useCallback(
    (opts: { forceRefresh: boolean }) =>
      window.pidom?.auth?.getIdToken(opts) ?? Promise.resolve(null),
    [],
  );

  const value = useMemo<SessionContextValue>(
    () => ({ ...state, signIn, signOut, fetchIdToken }),
    [state, signIn, signOut, fetchIdToken],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
