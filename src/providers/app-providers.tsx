import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import React from 'react';

import { SessionProvider } from '@/features/auth/session-provider';

import { ConvexProvider } from './convex-provider';
import { ThemeProvider } from './theme-provider';

/**
 * The provider stack, in the order the dependencies require.
 *
 *   GestureHandlerRootView  gesture recognisers, needed by the sheets and the
 *                           reader's page interactions later
 *   SafeAreaProvider        device insets
 *   ThemeProvider           mounts GluestackUIProvider (overlay + toast hosts)
 *   SessionProvider         Google identity
 *   ConvexProvider          reads the session through `useConvexGoogleAuth`
 *
 * Session above Convex is not stylistic. `ConvexProviderWithAuth` invokes its
 * `useAuth` hook from inside its own tree, so the context that hook reads has
 * to already exist above it.
 */
// `GestureHandlerRootView` is not className-interop'd, and its own docs require
// an explicit fill — without it the tree collapses to zero height.
const FILL = { flex: 1 } as const;

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <GestureHandlerRootView style={FILL}>
      <SafeAreaProvider>
        <ThemeProvider>
          <SessionProvider>
            <ConvexProvider>{children}</ConvexProvider>
          </SessionProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
