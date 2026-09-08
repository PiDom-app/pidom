import { Stack } from 'expo-router';
import React from 'react';

import { useEnsureProfile } from '@/features/auth/use-profile';
import { useLibrarySync } from '@/features/library/data/use-library-sync';
import { useSyncIntents } from '@/features/library/data/use-sync-intents';
import { useIncomingDocument } from '@/features/library/import/use-incoming-document';
import { useLocalLibrary } from '@/features/library/local/use-local-library';
import { useSyncEngine } from '@/features/library/sync/use-sync-engine';
import { usePushNotifications } from '@/features/notifications/use-push-registration';

/**
 * The authenticated shell.
 *
 * The profile row is created here, once, rather than in each screen: this
 * layout is mounted for exactly as long as the reader is signed in, which is
 * the lifetime the bootstrap should have. Everything else mounted here has the
 * same lifetime and the same shape — a background concern with no screen of its
 * own:
 *
 *   useEnsureProfile    the account row, on a first sign-in
 *   useLocalLibrary     the filesystem scan, into `documentFiles`
 *   useLibrarySync      one live subscription, upserted into the local database
 *   useSyncEngine       the outbox: drain, then reconcile
 *   useSyncIntents      uploads asked for when there was nothing to upload to
 *   useIncomingDocument a PDF handed over by another app
 *   usePushNotifications this device's push token, and where a tap goes
 *
 * None of them returns anything and no screen waits for any of them. That is
 * the whole architecture: the screens read the device, and these keep the
 * device and the account in step behind them.
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
  useLibrarySync();
  useSyncEngine();
  useSyncIntents();
  // A PDF opened from another app. Here rather than on a screen, because a
  // document can arrive while the reader is anywhere — and only here, because a
  // file handed over while signed out has no account to go into.
  useIncomingDocument();
  // Registers this device only if the reader has already agreed. The operating
  // system prompt is raised on the notification settings screen and nowhere
  // else — a permission asked for cold on launch is a permission denied for
  // good. It also routes a notification tap, which has to be handled twice: a
  // listener for a running app, and `getLastNotificationResponseAsync` for one
  // that was launched by the tap.
  usePushNotifications();

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
      {/* What is waiting to reach the account, and anything that will not go. */}
      <Stack.Screen name="sync" />
      {/* What the library takes up here, and what removing any of it costs. */}
      <Stack.Screen name="storage" />

      {/* Sharing. A document is still one row with one owner; these are the
          screens for the grants on top of it. All pushed rather than presented:
          each is a place with a back arrow, and the one that is a task with a
          Cancel — picking who to share with — is still a place you can leave
          without losing what you picked. */}
      <Stack.Screen name="share" />
      <Stack.Screen name="shared" />
      <Stack.Screen name="share-detail" />
      <Stack.Screen name="access" />
      <Stack.Screen name="groups" />
      <Stack.Screen name="group" />
      <Stack.Screen name="sharing-privacy" />
      <Stack.Screen name="notification-settings" />
    </Stack>
  );
}
