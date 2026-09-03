import { CloudOff, RefreshCw, WifiOff } from 'lucide-react-native';
import React from 'react';

import { Button, ButtonText } from '@/components/ui/button';
import { Center } from '@/components/ui/center';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

/**
 * What to say when the library cannot be reached.
 *
 * Two different sentences on purpose. An interface that is down and a backend
 * that is not answering are different problems with different fixes, and only
 * `NetInfo` can tell them apart — telling a reader on good wifi to "check their
 * connection" sends them to fix something that is not broken.
 */
export function OfflineState({
  hasNetwork,
  onRetry,
}: {
  hasNetwork: boolean;
  onRetry: () => void;
}) {
  return (
    <Center className="flex-1 px-10">
      <VStack className="items-center" space="lg">
        <Icon
          as={hasNetwork ? CloudOff : WifiOff}
          size="xl"
          className="h-10 w-10 text-fg-subtle"
        />

        <VStack className="items-center" space="sm">
          <Heading size="lg" className="text-center text-foreground">
            {hasNetwork ? "Can't reach Pidom" : "You're offline"}
          </Heading>
          <Text size="sm" className="max-w-[286px] text-center text-muted-foreground">
            {hasNetwork
              ? 'Your documents are safe on this device. Their titles and your place live in your account, and that is what needs a connection.'
              : 'Documents already on this device stay readable. Your library reappears when you are back online.'}
          </Text>
        </VStack>

        <Button variant="outline" size="lg" onPress={onRetry} className="mt-2 h-11">
          <ButtonText>Try again</ButtonText>
        </Button>
      </VStack>
    </Center>
  );
}

/**
 * A quiet line above a library rendered from the last known answer.
 *
 * Not a banner and not a toast: the reader can use everything below it, so it
 * should say what it is and get out of the way. It is the one place a rule
 * earns its keep on this screen, because the content under it is a different
 * kind of thing from the content above.
 */
export function StaleNotice({
  savedAt,
  hasNetwork,
  onRetry,
}: {
  savedAt: number;
  hasNetwork: boolean;
  onRetry: () => void;
}) {
  return (
    // Pressable, because the refresh glyph reads as a button and there is no
    // excuse for one that is not. A stale library is exactly the moment
    // somebody wants to try again.
    <Pressable
      onPress={onRetry}
      accessibilityRole="button"
      accessibilityLabel="Try to reach your library again"
      className="mt-5 border-y border-hairline bg-surface data-[active=true]:bg-hover">
      <HStack className="items-center px-6 py-2.5" space="sm">
        <Icon as={hasNetwork ? CloudOff : WifiOff} size="xs" className="text-fg-subtle" />
        <Text size="xs" className="flex-1 text-fg-subtle">
          Showing your library as of {relativeTime(savedAt)}
        </Text>
        <Icon as={RefreshCw} size="xs" className="text-fg-subtle" />
      </HStack>
    </Pressable>
  );
}

/**
 * Coarse on purpose.
 *
 * "3 minutes ago" implies a precision this does not have — the cache is written
 * whenever a live answer lands, which is not on any schedule. Buckets say the
 * true thing.
 */
function relativeTime(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 2) {
    return 'a moment ago';
  }
  if (minutes < 60) {
    return `${minutes} minutes ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
