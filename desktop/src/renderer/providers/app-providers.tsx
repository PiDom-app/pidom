import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from 'radix-ui';
import { ThemeProvider } from './theme-provider';
import { SessionProvider } from './session-provider';
import { ConvexProvider } from './convex-provider';

/**
 * The provider stack, in the order the dependencies require — the desktop
 * counterpart to the mobile app's src/providers/app-providers.tsx.
 *
 *   QueryClientProvider   TanStack Query cache (local/derived data)
 *   ThemeProvider         .dark/.light class toggle on <html>
 *   SessionProvider       Google identity, mirrored from the main process
 *   ConvexProvider        reads the session through useConvexGoogleAuth
 *
 * Session ABOVE Convex is not stylistic: `ConvexProviderWithAuth` invokes its
 * `useAuth` hook from inside its own tree, so the context that hook reads must
 * already exist above it.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SessionProvider>
          <ConvexProvider>
            <Tooltip.Provider delayDuration={300}>{children}</Tooltip.Provider>
          </ConvexProvider>
        </SessionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
