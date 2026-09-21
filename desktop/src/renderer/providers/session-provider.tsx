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

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', profile: null });

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
    void auth.status().then((s) => active && setState(s));
    const unsubscribe = auth.onChange(setState);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

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
