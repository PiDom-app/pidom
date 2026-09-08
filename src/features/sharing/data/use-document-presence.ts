import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { usePresence } from '@convex-dev/presence/react-native';

import { api } from '@convex/_generated/api';
import { PRESENCE_INTERVAL_MS } from '@convex/model/limits';
import { useLibraryStatus } from '@/features/library/data/use-library-status';

/**
 * Who else has this document open.
 *
 * The component does the hard part — a heartbeat, a timeout, and one
 * deployment-wide worker rather than every client polling — and this is the
 * two lines of glue plus the one thing worth saying about them.
 *
 * **The `userId` argument is not the identity.** The hook's signature takes
 * one and sends it on every heartbeat, and `convex/presence.ts` throws it away
 * and uses the account resolved from the verified JWT instead. What is passed
 * here is only what makes the hook's own session id distinct; a client that
 * lied about it would be lying to itself.
 *
 * It is skipped entirely for a document nobody shares. Presence on a private
 * document is a heartbeat every ten seconds to tell an empty room that one
 * person is in it.
 */
export function useDocumentPresence(
  remoteDocumentId: string | null,
  enabled: boolean,
): { id: string; displayName: string; pictureUrl: string | null; online: boolean }[] {
  const { profileId } = useLibraryStatus();

  // A room the caller cannot enter is refused server-side, so the empty string
  // here is about not making the call at all rather than about safety.
  const roomId = enabled && remoteDocumentId !== null ? `document:${remoteDocumentId}` : '';

  // Maintains this device's own heartbeat. Its return value is deliberately
  // unused: it is ids and booleans, and a face row needs names.
  usePresence(api.presence, roomId, profileId ?? 'anonymous', PRESENCE_INTERVAL_MS);

  // The names come back through the one projection
  // `Discovery.toPublicProfile` defines, so a face row cannot become a wider
  // read of somebody's profile than a search result is. `inRoom` re-runs the
  // same access check the heartbeat does — a room id is a guessable string.
  const people = useQuery(api.presence.inRoom, roomId === '' ? 'skip' : { roomId });

  return useMemo(
    () => (people ?? []).filter((person) => person.online),
    [people],
  );
}
