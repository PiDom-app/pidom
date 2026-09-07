import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { useEffect, useMemo, useRef } from 'react';

import { api } from '@convex/_generated/api';
import { log } from '@/lib/logger';

import { rememberAccount } from './local-account';
import { useSession } from './session-provider';

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
  /**
   * The profile came from the server on this run, rather than from the record
   * on the device.
   *
   * This, and not `profile !== null`, is the condition for running an
   * owner-scoped query: a remembered profile proves whose library this is, it
   * does not prove that Convex has verified a token. Firing `api.library.home`
   * on the strength of a record would throw `UNAUTHENTICATED` during render.
   */
  verified: boolean;
};

/**
 * Reads the signed-in reader's profile. Safe to call from any screen.
 *
 * **Answers from the device first.** The profile id is what names the library
 * directory and the local database, so every screen below needs one before it
 * can show anything at all — including on a launch with no network, where
 * `api.users.me` is never going to answer. The remembered account carries it,
 * and the live query upgrades it when one arrives.
 *
 * Creating the row is a separate concern — see `useEnsureProfile`, which runs
 * once in the authenticated layout.
 */
export function useProfile(): ProfileState {
  const { remembered } = useSession();
  const { isAuthenticated, isLoading } = useConvexAuth();

  // `undefined` while in flight, `null` once the server has answered "no row".
  const live = useQuery(api.users.me, isAuthenticated ? {} : 'skip');

  // Written back so the next cold launch has a profile id before it has a
  // network. `useProfile` is mounted in several places at once, so this is
  // idempotent by being a merge of the same two values.
  useEffect(() => {
    if (live === undefined || live === null) {
      return;
    }
    void rememberAccount({ profileId: live.id, createdAt: live.createdAt });
  }, [live]);

  return useMemo(() => {
    const fallback: Profile | null =
      remembered === null
        ? null
        : {
            id: remembered.profileId,
            email: remembered.email,
            name: remembered.name,
            pictureUrl: remembered.photoUrl,
            createdAt: remembered.createdAt,
          };

    const profile = live ?? fallback;

    return {
      profile,
      // Only pending when there is nothing at all to show. With a record in
      // hand the answer is known well enough to render, and the live query
      // refines it without a spinner in between.
      loading: profile === null && (isLoading || (isAuthenticated && live === undefined)),
      verified: live !== undefined && live !== null,
    };
  }, [live, remembered, isAuthenticated, isLoading]);
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
 * A session running on a remembered account never reaches that point at all,
 * which is correct — there is nothing to create until there is a token.
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
