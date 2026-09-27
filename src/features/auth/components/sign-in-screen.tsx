import React, { useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/ui/box';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { useAppToast } from '@/components/feedback/use-app-toast';

import { useSession } from '../session-provider';
import type { GoogleFailureReason } from '../google-client';
import { AuthHero } from './auth-hero';
import { GoogleSignInButton } from './google-sign-in-button';

/**
 * What each failure is worth saying out loud.
 *
 * `cancelled` and `no-saved-credential` return `null` deliberately. The reader
 * dismissed the sheet or has simply never signed in; telling them so is noise
 * about something they already know.
 */
function messageFor(reason: GoogleFailureReason): { title: string; description: string } | null {
  switch (reason) {
    case 'cancelled':
    case 'no-saved-credential':
      return null;
    case 'play-services':
      return {
        title: 'Google Play services needed',
        description: 'Update Google Play services, then try again.',
      };
    case 'network':
      return {
        title: "Couldn't reach Google",
        description: 'Check your connection and try again.',
      };
    case 'unknown':
      return {
        title: "Sign-in didn't complete",
        description: 'Something went wrong on Google’s side. Try again.',
      };
  }
}

/**
 * One continuous surface, no card.
 *
 * A full-bleed photograph starts at the very top edge, under the status bar,
 * and dissolves into the canvas — the app's calm reading world, shown rather
 * than described. Below the fade the name, one line of explanation, and the
 * only control sit within thumb reach. There is nothing else to look at, which
 * is the point: this screen has exactly one thing a reader can do. The image is
 * decoration only (see `auth-hero.tsx`); it never gates the button.
 */
export function SignInScreen() {
  const { signIn, lastFailure } = useSession();
  const showToast = useAppToast();
  const insets = useSafeAreaInsets();

  // Only report a failure once. `lastFailure` persists until the next attempt
  // so the screen can render against it, and without this guard a re-render
  // from any other cause would re-announce it.
  const reportedRef = useRef<GoogleFailureReason | null>(null);

  useEffect(() => {
    if (lastFailure === null) {
      reportedRef.current = null;
      return;
    }
    if (reportedRef.current === lastFailure) {
      return;
    }
    reportedRef.current = lastFailure;

    const message = messageFor(lastFailure);
    if (message !== null) {
      showToast({ id: 'sign-in-failure', tone: 'error', ...message });
    }
  }, [lastFailure, showToast]);

  return (
    <Box className="flex-1 bg-background">
      {/* Light icons read over the photo; the bar stays translucent so the
          image reaches the physical top edge. */}
      <StatusBar style="light" />
      <AuthHero />

      {/* The content is pinned to the bottom, over solid canvas below the fade,
          and clears the home indicator via the bottom inset. */}
      <VStack
        className="absolute inset-x-0 bottom-0 items-center px-6"
        style={{ paddingBottom: insets.bottom + 24 }}
        space="lg"
      >
        <VStack className="items-center" space="xs">
          <Heading size="2xl" className="text-foreground">
            Pidom
          </Heading>
          <Text size="md" className="max-w-72 text-center text-muted-foreground">
            Your PDFs, your highlights, and where you left off — on every device.
          </Text>
        </VStack>

        <VStack className="w-full" space="md">
          <GoogleSignInButton onPress={signIn} />
          <Text size="xs" className="px-2 text-center text-fg-subtle">
            By Signing in, you agree to our{' '}
            <Text
              onPress={() => Linking.openURL('https://pidom.app/terms')}
              className="text-link underline"
            >
              Terms of Service
            </Text>{' '}
            and{' '}
            <Text
              onPress={() => Linking.openURL('https://pidom.app/privacy')}
              className="text-link underline"
            >
              Privacy Policy
            </Text>
            .
          </Text>
        </VStack>
      </VStack>
    </Box>
  );
}
