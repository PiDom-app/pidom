import { ConvexReactClient } from 'convex/react';
import { ConvexProviderWithAuth } from 'convex/react';
import React, { useMemo } from 'react';

import { useConvexGoogleAuth } from '@/features/auth/use-convex-google-auth';
import { env } from '@/lib/env';

/**
 * The Convex client, wired to the Google session.
 *
 * Must render *inside* `SessionProvider`: `ConvexProviderWithAuth` calls
 * `useConvexGoogleAuth` from within its own tree, and that hook reads the
 * session context.
 */
export function ConvexProvider({ children }: { children: React.ReactNode }) {
  const client = useMemo(
    () =>
      new ConvexReactClient(env.convexUrl, {
        // A browser-only `beforeunload` prompt, on by default. It does nothing
        // on native and is unwanted on the web build, where a reader closing a
        // tab should not be interrogated about a pending mutation.
        unsavedChangesWarning: false,
      }),
    [],
  );

  return (
    <ConvexProviderWithAuth client={client} useAuth={useConvexGoogleAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}
