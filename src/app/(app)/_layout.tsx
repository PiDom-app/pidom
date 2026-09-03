import { Stack } from 'expo-router';
import React from 'react';

import { useEnsureProfile } from '@/features/auth/use-profile';
import { useLocalLibrary } from '@/features/library/local/use-local-library';

/**
 * The authenticated shell.
 *
 * The profile row is created here, once, rather than in each screen: this
 * layout is mounted for exactly as long as the reader is signed in, which is
 * the lifetime the bootstrap should have. Scanning the device for local PDFs
 * has the same lifetime, so it happens here too.
 *
 * A plain stack. `index` is home, `library` is everything behind "View all",
 * `collection` is one group, `import` is a modal task, and `reader` sits above
 * them all so a document opens full-bleed. A tab navigator, if it is ever the
 * right answer, goes here too.
 */
export default function AppLayout() {
  useEnsureProfile();
  useLocalLibrary();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="library" />
      {/* Modal: adding a document is a task with a Cancel, not a place. */}
      <Stack.Screen name="import" options={{ presentation: 'modal' }} />
      {/* Full-bleed, and above everything: a document is what the app is for. */}
      <Stack.Screen name="reader" options={{ animation: 'fade' }} />
      <Stack.Screen name="collection" />
      <Stack.Screen name="account" />
    </Stack>
  );
}
