import { type ErrorBoundaryProps } from 'expo-router';
import { TriangleAlert } from 'lucide-react-native';
import React from 'react';

import { Screen } from '@/components/layout/screen';
import { Button, ButtonText } from '@/components/ui/button';
import { Center } from '@/components/ui/center';
import { Heading } from '@/components/ui/heading';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { codeOf, type LibraryErrorCode } from '@/features/library/data/errors';

/**
 * The last thing between a thrown error and a white screen.
 *
 * This is not defensive decoration. `convex/react`'s `useQuery` re-throws a
 * query error *during render* — there is no error field to branch on — so a
 * document deleted on another device while its screen is open, or a token that
 * outlives its profile row, arrives here as a thrown `ConvexError` and nothing
 * else. Without a boundary that is a blank screen the reader can only escape by
 * force-quitting.
 *
 * Export it as `ErrorBoundary` from a route file, or hand it to a navigator, and
 * Expo Router wraps the screen in it. An error with no boundary on its own route
 * goes to the nearest parent's.
 *
 * https://docs.expo.dev/router/error-handling/
 */
export function ScreenError({ error, retry }: ErrorBoundaryProps) {
  const { title, body } = wordsFor(codeOf(error));

  return (
    <Screen>
      <Center className="flex-1 px-10">
        <VStack className="items-center" space="lg">
          <Icon as={TriangleAlert} size="xl" className="h-10 w-10 text-fg-subtle" />

          <VStack className="items-center" space="sm">
            <Heading size="lg" className="text-center text-foreground">
              {title}
            </Heading>
            <Text size="sm" className="max-w-[286px] text-center text-muted-foreground">
              {body}
            </Text>
          </VStack>

          <Button size="lg" onPress={retry} className="mt-2 h-11">
            <ButtonText>Try again</ButtonText>
          </Button>
        </VStack>
      </Center>
    </Screen>
  );
}

/**
 * What to say, per code the backend actually raises.
 *
 * `codeOf` has returned all five of these for a while and this branched on one,
 * so a reader who had simply tapped too fast was told their library was safe and
 * invited to sign out and back in — advice that is wrong, and for a rate limit
 * actively unhelpful. The generic line stays the default, because `UNKNOWN`
 * genuinely covers anything.
 */
function wordsFor(code: LibraryErrorCode): { title: string; body: string } {
  switch (code) {
    // Covers both "gone" and "never yours", deliberately — see `assertOwner`.
    // From the reader's side the only true statement is that it is not there.
    case 'FORBIDDEN':
      return {
        title: 'That is no longer here',
        body: 'It may have been deleted on another device. Your other documents are unaffected.',
      };
    case 'RATE_LIMITED':
      return {
        title: 'Give that a moment',
        body: 'That happened a few too many times in a row. Nothing was lost — try again shortly.',
      };
    // The window between a verified token and the profile row existing. It
    // closes on its own, so the honest instruction is to wait rather than to
    // suspect the account.
    case 'NO_PROFILE':
    case 'UNAUTHENTICATED':
      return {
        title: 'Still signing you in',
        body: 'Your account is being set up on this device. This should only take a moment.',
      };
    case 'INVALID':
      return {
        title: 'That could not be done',
        body: 'Something about that request was not allowed. Your library is unaffected.',
      };
    default:
      return {
        title: 'Something went wrong',
        body: 'Your library is safe. Try again, and if it keeps happening, sign out and back in.',
      };
  }
}
