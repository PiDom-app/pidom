import { Stack } from 'expo-router';
import React from 'react';

import { useEnsureProfile } from '@/features/auth/use-profile';
import { useIncomingDocument } from '@/features/library/import/use-incoming-document';
import { useLocalLibrary } from '@/features/library/local/use-local-library';

/**
 * The authenticated shell.
 *
 * The profile row is created here, once, rather than in each screen: this
 * layout is mounted for exactly as long as the reader is signed in, which is
 * the lifetime the bootstrap should have. Scanning the device for local PDFs
 * has the same lifetime, and so does listening for a document another app hands
 * over, so all three happen here.
 *
 * A plain stack. `index` is home, `library` is everything behind "View all",
 * `collection` is one group, `search` looks inside documents rather than at
 * their titles, `import` is a modal task, and `reader` sits above them all so a
 * document opens full-bleed. `navigator` and `note` sit above the reader, and
 * are screens rather than sheets over it — see `navigator-screen.tsx` for what
 * a sheet whose height is the reader's data did to the control hanging off it.
 * A tab navigator, if it is ever the right answer, goes here too.
 */
export default function AppLayout() {
  useEnsureProfile();
  useLocalLibrary();
  // A PDF opened from another app. Here rather than on a screen, because a
  // document can arrive while the reader is anywhere — and only here, because a
  // file handed over while signed out has no account to go into.
  useIncomingDocument();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="library" />
      {/* Modal: adding a document is a task with a Cancel, not a place. */}
      <Stack.Screen name="import" options={{ presentation: 'modal' }} />
      {/* Full-bleed, and above everything: a document is what the app is for. */}
      <Stack.Screen name="reader" options={{ animation: 'fade' }} />
      {/* Over the reader, and pushed rather than presented: the document stays
          mounted underneath, so coming back is not reopening a 400-page file. */}
      <Stack.Screen name="navigator" />
      <Stack.Screen name="note" />
      <Stack.Screen name="collection" />
      <Stack.Screen name="search" />
      <Stack.Screen name="account" />
    </Stack>
  );
}
