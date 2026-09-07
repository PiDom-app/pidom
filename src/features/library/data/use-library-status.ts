import { useConvexConnectionState } from 'convex/react';

import { useSession } from '@/features/auth/session-provider';
import { useProfile } from '@/features/auth/use-profile';
import { useHasNetwork } from '@/lib/connectivity';

/**
 * Whether it is safe to ask the server for owned data, and whether the server
 * is answering.
 *
 * **`ready` is not optional.** Every library function starts with `requireUser`,
 * which throws `NO_PROFILE` when the token verifies but the row does not exist
 * yet — and `convex/react`'s `useQuery` re-throws a query error *during render*.
 * On a first sign-in the authenticated layout mounts `useEnsureProfile` and the
 * home screen in the same commit, so without this gate the very first launch of
 * a new account renders a thrown error rather than a library.
 *
 * The alternative was to soften `requireUser` into "return nothing if there is
 * no row". That would hide a genuine failure — a token that verifies against a
 * profile that vanished — behind an empty library, on every function. The gate
 * belongs on the caller.
 *
 * It reads `verified` rather than `profile !== null` for the same reason:
 * `useProfile` now answers from the device before Convex has said anything, and
 * a profile id remembered on this phone is not a token Convex has checked.
 */
export type LibraryStatus = {
  /** The profile row exists. Owner-scoped queries may run. */
  ready: boolean;
  /** Convex is not answering. Live data will not arrive until it is. */
  offline: boolean;
  /**
   * Whether the device has a network at all.
   *
   * Distinct from `offline` on purpose: an interface can be up while Convex is
   * unreachable — a captive portal, a DNS failure, a backend incident. The two
   * want different words in front of the reader, and only `NetInfo` can tell
   * them apart.
   */
  hasNetwork: boolean;
  /**
   * The reader is signed in on a remembered account rather than a verified one.
   *
   * Distinct again from both of the above: there may be a perfectly good
   * network and a perfectly healthy backend, and this device still has no token
   * because Google could not be reached at launch. Nothing owner-scoped will
   * answer until it can, and the one line on the home screen that says so is
   * the only place this surfaces.
   */
  offlineIdentity: boolean;
  /** The signed-in profile's id, which scopes everything the device holds. */
  profileId: string | null;
};

export function useLibraryStatus(): LibraryStatus {
  const { profile, verified } = useProfile();
  const { offline: offlineIdentity } = useSession();
  const connection = useConvexConnectionState();
  const hasNetwork = useHasNetwork();

  return {
    ready: verified,
    // `hasEverConnected` is what keeps a cold launch from flashing "offline"
    // during the second it takes the socket to open: before the first
    // connection there is nothing to have lost. An identity that never
    // verified never opened a socket either, so it is offline by definition.
    offline: offlineIdentity || (connection.hasEverConnected && !connection.isWebSocketConnected),
    hasNetwork,
    offlineIdentity,
    profileId: profile?.id ?? null,
  };
}
