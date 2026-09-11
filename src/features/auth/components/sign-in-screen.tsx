import React, { useEffect, useRef } from 'react';
import { Linking } from 'react-native';

import { PidomMark } from '@/components/brand/pidom-mark';
import { Screen } from '@/components/layout/screen';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { useAppToast } from '@/components/feedback/use-app-toast';

import { useSession } from '../session-provider';
import type { GoogleFailureReason } from '../google-client';
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
 * The mark and the name sit in the upper-middle where the eye lands, the
 * explanation is one line, and the only control is at the bottom within thumb
 * reach. There is nothing else to look at, which is the point: this screen has
 * exactly one thing a reader can do.
 */
export function SignInScreen() {
  const { signIn, lastFailure } = useSession();
  const showToast = useAppToast();

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
    <Screen edges={['top', 'bottom']}>
      <VStack className="flex-1 justify-between px-4 pb-8 pt-4">
        {/* The identity block, optically centred rather than mathematically —
            the button below carries weight the eye compensates for. */}
        <VStack className="flex-1 items-center justify-center" space="xl">
          <PidomMark size={104} />

          <VStack className="items-center" space="sm">
            <Heading size="2xl" className="text-foreground">
              Pidom
            </Heading>
            <Text size="md" className="max-w-72 text-center text-muted-foreground">
              Your PDFs, your highlights, and where you left off — on every device.
            </Text>
          </VStack>
        </VStack>

        <VStack space="md">
          <GoogleSignInButton onPress={signIn} />
          <Text size="xs" className="px-2 text-center text-fg-subtle">
            By Signing in, you agree to our{' '}
            <Text
              onPress={() => Linking.openURL('https://pidom.app/terms')}
              className="text-fg-accent underline"
            >
              Terms of Service
            </Text>{' '}
            and{' '}
            <Text
              onPress={() => Linking.openURL('https://pidom.app/privacy')}
              className="text-fg-accent underline"
            >
              Privacy Policy
            </Text>
            .
          </Text>
        </VStack>
      </VStack>
    </Screen>
  );
}
