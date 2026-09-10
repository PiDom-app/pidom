import React from 'react';

import { Box } from '@/components/ui/box';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { Skeleton } from '@/components/ui/skeleton';
import { VStack } from '@/components/ui/vstack';

import { COVER_WIDTH, coverHeight } from './document-cover';

/**
 * The shape of the screen, before the answer arrives.
 *
 * The headings are real because the sections are known before the data is; only
 * the covers are unknown. A skeleton that also greys out the words would be
 * hiding something it already has.
 */
export function LibrarySkeleton() {
  return (
    <Box>
      <SkeletonRail title="Continue reading" />
      <SkeletonRail title="Recently added" />
    </Box>
  );
}

function SkeletonRail({ title }: { title: string }) {
  return (
    <VStack className="mt-7">
      <Heading size="sm" className="px-4 text-foreground">
        {title}
      </Heading>
      <HStack className="mt-3 overflow-hidden px-4" space="md">
        <SkeletonTile />
        <SkeletonTile />
        <SkeletonTile />
        <SkeletonTile />
      </HStack>
    </VStack>
  );
}

function SkeletonTile() {
  return (
    <VStack style={TILE}>
      <Skeleton className="rounded-md" style={COVER} />
      <Skeleton className="mt-2 h-3 w-full rounded-md" />
      <Skeleton className="mt-1.5 h-3 w-2/3 rounded-md" />
      <Skeleton className="mt-2 h-2.5 w-1/2 rounded-md" />
    </VStack>
  );
}

// Fixed pixel geometry, matching the real tile so the swap does not reflow.
const TILE = { width: COVER_WIDTH } as const;
const COVER = { width: COVER_WIDTH, height: coverHeight(COVER_WIDTH) } as const;
