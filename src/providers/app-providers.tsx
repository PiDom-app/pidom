import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
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
 *   KeyboardProvider        the keyboard's height as a shared value
 *   SafeAreaProvider        device insets
 *   ThemeProvider           mounts GluestackUIProvider (overlay + toast hosts)
 *   SessionProvider         Google identity
 *   ConvexProvider          reads the session through `useConvexGoogleAuth`
 *
 * Session above Convex is not stylistic. `ConvexProviderWithAuth` invokes its
 * `useAuth` hook from inside its own tree, so the context that hook reads has
 * to already exist above it.
 *
 * `KeyboardProvider` is what `useReanimatedKeyboardAnimation` reads, and the Ask
 * screen's composer rides the keyboard up on that value rather than on a
 * measured spacer. It is at the root rather than around that one screen because
 * the library installs a single native listener and expects to own it for the
 * life of the process; mounting and unmounting it per route is how it stops
 * reporting.
 */
// `GestureHandlerRootView` is not className-interop'd, and its own docs require
// an explicit fill — without it the tree collapses to zero height.
const FILL = { flex: 1 } as const;

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <GestureHandlerRootView style={FILL}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <ThemeProvider>
            <SessionProvider>
              <ConvexProvider>{children}</ConvexProvider>
            </SessionProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
