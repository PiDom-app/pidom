import React, { useMemo } from 'react';
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
 * glue plus the two things worth saying about it.
 *
 * **The `userId` argument is not the identity.** The hook's signature takes one
 * and sends it on every heartbeat, and `convex/presence.ts` throws it away and
 * uses the account resolved from the verified JWT instead. What is passed here
 * is only what makes the hook's own session id distinct; a client that lied
 * about it would be lying to itself.
 *
 * **The heartbeat is mounted, not skipped.** `usePresence` has no disabled
 * state: it beats on its interval whatever room id it is given, so the previous
 * version — which passed an empty string when there was nothing to join —
 * fired a mutation every ten seconds for every synced document, each one
 * refused by the server *after* spending a token from the 600-an-hour presence
 * bucket. A reader with a few documents open could exhaust their own budget
 * doing nothing. Hooks cannot be conditional, so the beat lives in a component
 * that is rendered only when there is a room, and the screens render `beat`.
 */
export function useDocumentPresence(
  remoteDocumentId: string | null,
  enabled: boolean,
): {
  people: { id: string; displayName: string; pictureUrl: string | null; online: boolean }[];
  /** Render this. It is `null` unless there is a room to be in. */
  beat: React.ReactNode;
} {
  const { profileId } = useLibraryStatus();

  const roomId = enabled && remoteDocumentId !== null ? `document:${remoteDocumentId}` : null;

  // The names come back through the one projection
  // `Discovery.toPublicProfile` defines, so a face row cannot become a wider
  // read of somebody's profile than a search result is. `inRoom` re-runs the
  // same access check the heartbeat does — a room id is a guessable string.
  const people = useQuery(api.presence.inRoom, roomId === null ? 'skip' : { roomId });

  const online = useMemo(() => (people ?? []).filter((person) => person.online), [people]);

  return {
    people: online,
    beat: roomId === null ? null : <Beat roomId={roomId} sessionKey={profileId ?? 'anonymous'} />,
  };
}

/**
 * This device saying "still here", for as long as it is mounted.
 *
 * Renders nothing. Its whole job is to own the hook's lifecycle so that
 * unmounting it stops the heartbeat — which is also what makes the component's
 * own `disconnect` fire, so the room empties when the screen closes rather
 * than when the server's timeout notices.
 */
function Beat({ roomId, sessionKey }: { roomId: string; sessionKey: string }) {
  // The return value is deliberately unused: it is ids and booleans, and a face
  // row needs names. `inRoom` above is the read.
  usePresence(api.presence, roomId, sessionKey, PRESENCE_INTERVAL_MS);
  return null;
}
