import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';

import { useSession } from '@/features/auth/session-provider';
import { AppProviders } from '@/providers/app-providers';
import { useThemeStore } from '@/stores/theme-store';

import '@/design/global.css';

// Held until the session and the stored theme have both resolved, so the first
// frame the reader sees is the right screen in the right theme rather than a
// flash of one followed by the other.
void SplashScreen.preventAutoHideAsync();

/**
 * The routing gate.
 *
 * `Stack.Protected` is navigation, not access control — the note in Expo's own
 * docs. It decides what renders; the Convex functions decide what the backend
 * will answer. Both are needed, and neither substitutes for the other.
 */
function RootNavigator() {
  const { status } = useSession();
  const themeHydrated = useThemeStore((state) => state.hydrated);

  const ready = status !== 'loading' && themeHydrated;

  useEffect(() => {
    if (ready) {
      void SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    // Both guards would be false here anyway; returning null keeps the splash
    // as the only thing on screen rather than briefly mounting an empty stack.
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === 'signed-out'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>

      <Stack.Protected guard={status === 'signed-in'}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <StatusBar style="auto" />
      <RootNavigator />
    </AppProviders>
  );
}
