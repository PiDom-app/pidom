import { useRouter } from 'expo-router';
import { ChevronRight, CloudCheck, CloudOff, CloudUpload, TriangleAlert } from 'lucide-react-native';
import React from 'react';

import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { useSyncStore } from '@/stores/sync-store';

import { useLibraryStatus } from '../data/use-library-status';

/**
 * One row on the account screen: how far behind the account is.
 *
 * Deliberately one row and deliberately quiet. Everything it could say is
 * already true and already safe — the changes are on the device — so this is a
 * fact a reader can go and look at rather than a state the app is in. The
 * screen behind it is where anything actionable lives.
 *
 * It lives in `features/library/` and is imported by the account screen, the
 * same way `StorageUsage` beside it is: what it reports is the library's, and
 * the account screen is only where somebody goes to read it.
 */
export function SyncSummary() {
  const router = useRouter();
  const { offline, offlineIdentity, hasNetwork } = useLibraryStatus();
  const pending = useSyncStore((state) => state.pending);
  const failed = useSyncStore((state) => state.failed);
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt);

  const glyph =
    failed > 0
      ? TriangleAlert
      : offline || offlineIdentity
        ? CloudOff
        : pending > 0
          ? CloudUpload
          : CloudCheck;

  const headline =
    failed > 0
      ? failed === 1
        ? '1 change would not go'
        : `${failed} changes would not go`
      : pending === 0
        ? 'Everything is synced'
        : pending === 1
          ? '1 change waiting'
          : `${pending} changes waiting`;

  const hint =
    offlineIdentity || (offline && !hasNetwork)
      ? 'Waiting for a connection'
      : offline
        ? 'Waiting for your account to answer'
        : lastSyncedAt === null
          ? 'No sync has finished on this device yet'
          : `Last synced ${relativeTime(lastSyncedAt)}`;

  return (
    <Pressable
      onPress={() => router.push('/sync')}
      accessibilityRole="button"
      accessibilityLabel={`${headline}. ${hint}.`}
      className="rounded-md px-1 py-3 data-[active=true]:bg-hover">
      <HStack className="items-center" space="md">
        <Icon as={glyph} size="lg" className={failed > 0 ? 'text-destructive' : 'text-fg-muted'} />
        <VStack className="flex-1" space="xs">
          <Text size="sm" className="text-foreground">
            {headline}
          </Text>
          <Text size="xs" className="text-fg-subtle">
            {hint}
          </Text>
        </VStack>
        <Icon as={ChevronRight} size="sm" className="text-fg-subtle" />
      </HStack>
    </Pressable>
  );
}

/** Coarse on purpose, as everywhere else this app says how long ago. */
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
