import { useQuery } from 'convex/react';
import React from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { api } from '@convex/_generated/api';
import { CLOUD_BYTE_MAX } from '@convex/model/limits';

import { formatBytes } from '../data/types';
import { useLibraryStatus } from '../data/use-library-status';

/**
 * How much of the account the reader is using.
 *
 * At 100 MB a document, R2's 10 GB free tier holds around a hundred of them.
 * That is close enough that somebody deciding whether to sync a textbook should
 * be able to see where they stand, rather than finding out from an upload that
 * fails or a bill that does not.
 *
 * No progress bar and no percentage of a quota. The quota belongs to whoever
 * owns the Cloudflare account, this app does not know it, and inventing a
 * denominator would be inventing a fact.
 */
export function StorageUsage() {
  const { ready } = useLibraryStatus();
  const usage = useQuery(api.library.usage, ready ? {} : 'skip');

  if (usage === undefined) {
    return (
      <VStack className="px-1 py-3" space="xs">
        <Skeleton className="h-4 w-44 rounded-md" />
        <Skeleton className="h-3 w-56 rounded-md" />
      </VStack>
    );
  }

  return (
    <VStack className="px-1 py-3" space="xs">
      <Text size="sm" className="text-foreground">
        {usage.syncedCount === 0
          ? 'Nothing synced yet'
          : `${formatBytes(usage.syncedBytes)} across ${
              usage.syncedCount === 1 ? '1 document' : `${usage.syncedCount} documents`
            }`}
      </Text>
      <Text size="xs" className="text-fg-subtle">
        {usage.syncedCount === 0
          ? `Documents you sync are kept in your account so any device can download them. Up to ${Math.round(CLOUD_BYTE_MAX / 1024 / 1024)} MB each.`
          : 'Documents kept in your account, so any device you sign in to can download them.'}
      </Text>
    </VStack>
  );
}
