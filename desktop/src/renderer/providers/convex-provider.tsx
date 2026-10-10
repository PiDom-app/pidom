import { ConvexReactClient, ConvexProviderWithAuth } from 'convex/react';
import React, { useMemo } from 'react';
import { useConvexGoogleAuth } from '../features/auth/use-convex-google-auth';
import { env } from '../lib/env';

/**
 * The Convex client, wired to the desktop Google session — same shape as the
 * mobile app's src/providers/convex-provider.tsx.
 *
 * Must render INSIDE SessionProvider: `ConvexProviderWithAuth` calls
 * `useConvexGoogleAuth` from within its own tree, and that hook reads the
 * session context.
 */
export function ConvexProvider({ children }: { children: React.ReactNode }) {
  const convexUrl = env.convexUrl;
  if (!convexUrl) {
    throw new Error(
      'VITE_CONVEX_URL is missing from this build. Reinstall the latest Pidom release or contact support.',
    );
  }
  const client = useMemo(() => new ConvexReactClient(convexUrl), [convexUrl]);

  return (
    <ConvexProviderWithAuth client={client} useAuth={useConvexGoogleAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}
