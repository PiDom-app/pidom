import { useRouter } from 'expo-router';
import { ArrowLeft, FileX } from 'lucide-react-native';
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/ui/box';
import { Button, ButtonText } from '@/components/ui/button';
import { Center } from '@/components/ui/center';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Progress, ProgressFilledTrack } from '@/components/ui/progress';
import { Text } from '@/components/ui/text';
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';

import { DocumentCover } from '../library/components/document-cover';

/**
 * The two things that can be on screen instead of a document.
 *
 * Both are flat. There is no card here and nothing is centred inside a panel:
 * the reader is a canvas, and a canvas that fails should look like a canvas
 * with a sentence on it.
 */

/**
 * Opening.
 *
 * The cover the import already rendered stands in for the page, so the screen
 * somebody waits on is a picture of their book rather than an empty rectangle.
 * The bar is `onLoadProgress`, which is real — a spinner would be pretending to
 * know something it does not.
 */
export function ReaderOpening({
  documentId,
  title,
  pageCount,
  progress,
  onBack,
}: {
  documentId: string;
  title: string;
  pageCount: number | null;
  /** 0..1, straight from the renderer. */
  progress: number;
  /**
   * The way out.
   *
   * The chrome is gated on `ready`, so without this a document that never
   * finishes loading — a huge file, a renderer that hangs — is a progress bar
   * with no exit but the OS gesture. Both artboards draw a back arrow here for
   * exactly that reason.
   */
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Box className="flex-1 bg-background">
      <HStack className="absolute inset-x-0 top-0 px-4" style={{ paddingTop: insets.top + 8 }}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to your library"
          className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover"
        >
          <Icon as={ArrowLeft} size="lg" className="text-foreground" />
        </Pressable>
      </HStack>
      <Center className="flex-1 px-10">
        {/* `w-full` on the column, not `items-center` alone. A column that only
            centres shrinks to its widest child — the 132pt cover — and the
            caption underneath was being clipped mid-word. */}
        <VStack className="w-full items-center">
          <Box className="opacity-40">
            <DocumentCover documentId={documentId} title={title} width={132} />
          </Box>
          <Progress
            value={Math.round(Math.min(1, Math.max(0, progress)) * 100)}
            className="mt-7 h-0.5 w-[132px] bg-border"
          >
            <ProgressFilledTrack className="bg-primary" />
          </Progress>
          <Text size="sm" className="mt-3.5 text-center text-fg-muted">
            Opening…
          </Text>
          <Text size="xs" className="mt-1 text-center text-fg-subtle">
            {pageCount === null ? 'from this device' : `${pageCount} pages · from this device`}
          </Text>
        </VStack>
      </Center>
    </Box>
  );
}

/**
 * A document that will not render.
 *
 * It says which of two problems this is, because they have different fixes. A
 * damaged local copy of a synced document can be replaced from the account; a
 * damaged copy of a local-only document cannot, and saying "try again" to
 * somebody with no second copy is worse than saying nothing.
 */
export function ReaderFailed({
  isSynced,
  onRetry,
  onFetch,
}: {
  isSynced: boolean;
  onRetry: () => void;
  onFetch: () => void;
}) {
  const router = useRouter();
  return (
    <Box className="flex-1 bg-background">
      <Center className="flex-1 px-10">
        <VStack className="items-center">
          <Icon as={FileX} size="xl" className="text-fg-subtle" />
          <Text size="md" className="mt-4 text-center font-semibold text-foreground">
            This file will not open
          </Text>
          <Text size="sm" className="mt-1.5 text-center text-fg-muted">
            {isSynced
              ? 'The copy on this phone is damaged. There is a copy in your account, so downloading it again should fix it.'
              : 'The copy on this phone is damaged, and this document was never synced, so there is no other copy to fetch.'}
          </Text>
          <Box className="mt-6 w-full">
            <Button size="lg" onPress={isSynced ? onFetch : onRetry}>
              <ButtonText>{isSynced ? 'Download it again' : 'Try again'}</ButtonText>
            </Button>
          </Box>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            className="mt-4 rounded-md px-3 py-2 data-[active=true]:bg-hover"
          >
            <Text size="sm" className="text-primary">
              Back to your library
            </Text>
          </Pressable>
        </VStack>
      </Center>
    </Box>
  );
}

/**
 * Nothing to open at all.
 *
 * A deleted document, a lapsed profile, an id that is not one — the three cases
 * where the route has a parameter and the library has nothing behind it.
 */
export function ReaderMissing({
  message = 'That document is no longer in your library.',
}: {
  message?: string;
}) {
  const router = useRouter();
  return (
    <Box className="flex-1 bg-background">
      <Center className="flex-1 px-10">
        <VStack className="items-center" space="md">
          <Text size="sm" className="text-center text-fg-subtle">
            {message}
          </Text>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            className="rounded-md px-3 py-2 data-[active=true]:bg-hover"
          >
            <Text size="sm" className="text-primary">
              Back to your library
            </Text>
          </Pressable>
        </VStack>
      </Center>
    </Box>
  );
}
