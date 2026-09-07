import { CloudOff, Lock, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react-native';
import React from 'react';

import type { DatabaseFault } from '../local/db';

import { Button, ButtonText } from '@/components/ui/button';
import { Center } from '@/components/ui/center';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

/**
 * The one case where an empty library is not an empty library.
 *
 * This used to appear whenever the backend was quiet, which is no longer a
 * thing that can happen: the rails are read from this device's own database and
 * that database answers in a frame, connection or not. What is left is the
 * narrow case it was always really for — a phone signed in a moment ago and
 * disconnected before its first sync finished. It has nothing to show and
 * nothing wrong with it, and saying "no documents" would be a lie about
 * somebody's library.
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
              ? 'This phone has not finished its first sync, so there is nothing here to show yet. Your library is safe in your account and arrives when this device can reach it.'
              : 'This phone has not finished its first sync. Your library is safe in your account and arrives when you are back online.'}
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
 * There is no library on this device, and it is not because there are no
 * documents.
 *
 * The state that has to exist once the database can refuse to open. Without it
 * a device whose library cannot be read falls through to the empty state and
 * invites the reader to import their first document — which is a claim about
 * their account that this phone is in no position to make, and the one wrong
 * thing an empty screen can say.
 *
 * `no-cipher` is a build fault rather than anything the reader did, so it says
 * what is true — their documents are safe, this copy of the app is the problem
 * — without asking them to fix it.
 */
export function LibraryUnavailable({ fault }: { fault: DatabaseFault }) {
  const headline =
    fault === 'no-cipher'
      ? 'This build cannot store your library'
      : fault === 'no-keychain'
        ? 'Locked'
        : 'Rebuilding your library';

  const body =
    fault === 'no-cipher'
      ? 'Pidom encrypts the library it keeps on your phone, and this build was made without the encryption. Rather than store your documents in the clear, it is not storing them at all. Nothing is lost — everything is still in your account.'
      : fault === 'no-keychain'
        ? 'This device would not hand over the key to your library. Unlock the phone and open Pidom again; nothing has been lost.'
        : 'The copy on this device could not be opened, so it is being built again from your account.';

  return (
    <Center className="flex-1 px-10">
      <VStack className="items-center" space="lg">
        <Icon as={fault === 'no-keychain' ? Lock : ShieldAlert} size="xl" className="h-10 w-10 text-fg-subtle" />
        <VStack className="items-center" space="sm">
          <Heading size="lg" className="text-center text-foreground">
            {headline}
          </Heading>
          <Text size="sm" className="max-w-[286px] text-center text-muted-foreground">
            {body}
          </Text>
        </VStack>
      </VStack>
    </Center>
  );
}

/**
 * A quiet line above a library the account has not caught up with.
 *
 * Not a banner and not a toast: everything below it works, so it should say
 * what it is and get out of the way. It is the one place a rule earns its keep
 * on this screen, because the content under it is a different kind of thing
 * from the content above.
 *
 * Three sentences for three situations, and they are genuinely different. No
 * network is a fact about the phone. A network with no backend is a fact about
 * Pidom. And a launch that could not reach Google is a fact about neither —
 * everything works, this device simply has no token yet, which is why that one
 * does not offer "try again" as a fix so much as an explanation.
 */
export function SyncNotice({
  offlineIdentity,
  hasNetwork,
  lastSyncedAt,
  onRetry,
}: {
  offlineIdentity: boolean;
  hasNetwork: boolean;
  lastSyncedAt: number | null;
  onRetry: () => void;
}) {
  const glyph = offlineIdentity || !hasNetwork ? WifiOff : CloudOff;
  const message = offlineIdentity
    ? 'Opened with no connection. Everything here is on this device; your account catches up when there is one.'
    : lastSyncedAt === null
      ? hasNetwork
        ? 'Your account is not answering. Everything here is on this device.'
        : 'You are offline. Everything here is on this device.'
      : `Your account has not answered since ${relativeTime(lastSyncedAt)}. Everything here is on this device.`;

  return (
    // Pressable, because the refresh glyph reads as a button and there is no
    // excuse for one that is not. This is exactly the moment somebody wants to
    // try again.
    <Pressable
      onPress={onRetry}
      accessibilityRole="button"
      accessibilityLabel="Try to reach your account again"
      className="mt-5 border-y border-hairline bg-surface data-[active=true]:bg-hover">
      <HStack className="items-center px-6 py-2.5" space="sm">
        <Icon as={glyph} size="xs" className="text-fg-subtle" />
        <Text size="xs" className="flex-1 text-fg-subtle">
          {message}
        </Text>
        <Icon as={RefreshCw} size="xs" className="text-fg-subtle" />
      </HStack>
    </Pressable>
  );
}

/**
 * Coarse on purpose.
 *
 * "3 minutes ago" implies a precision this does not have — a sync finishes
 * whenever the queue drains and the account answers, which is not on any
 * schedule. Buckets say the true thing.
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
