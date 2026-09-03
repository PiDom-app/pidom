import { useEffect } from 'react';

import { useProfile } from '@/features/auth/use-profile';
import { useLocalLibraryStore } from '@/stores/local-library-store';

/**
 * Reads this account's library directory once per authenticated launch.
 *
 * Mount it in the authenticated layout, next to `useEnsureProfile`, and for the
 * same reason: the scan's lifetime is the session's, not any one screen's. A
 * reader who deep-links straight to the all-library screen needs the answer as
 * much as one who lands on home, and neither should trigger a second scan.
 *
 * Keyed on the profile id because the directory is — see `./paths.ts`. Signing
 * in as somebody else rescans rather than inheriting the previous set.
 */
export function useLocalLibrary(): void {
  const { profile } = useProfile();
  const scan = useLocalLibraryStore((state) => state.scan);
  const profileId = profile?.id ?? null;

  useEffect(() => {
    if (profileId !== null) {
      void scan(profileId);
    }
  }, [profileId, scan]);
}
