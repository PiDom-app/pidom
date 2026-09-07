import { useRouter } from 'expo-router';
import { ArrowLeft, CloudCheck, HardDrive, Lock, Smartphone, TriangleAlert } from 'lucide-react-native';
import React, { useState } from 'react';

import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
} from '@/components/ui/alert-dialog';
import { Screen } from '@/components/layout/screen';
import { Button, ButtonText } from '@/components/ui/button';
import { Center } from '@/components/ui/center';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { ScrollView } from '@/components/ui/scroll-view';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

import { formatBytes } from '../data/types';
import { useDeviceStorage, type StorageEntry } from '../data/use-device-storage';
import { useLibraryActions } from '../data/use-library-actions';
import { databaseEncrypted } from '../local/db';
import { HEADROOM_BYTES } from '../local/space';

/**
 * What the library takes up on this phone, and what removing any of it costs.
 *
 * The screen the refusal always assumed. `space.ts` turns an import away with
 * "remove a download or two and try again", and until now nothing anywhere said
 * which downloads were large — the account screen's Storage section reported
 * what was in the *account*, which is the other half of the question.
 *
 * Every row says what removal means before the reader commits, because the same
 * gesture has two different consequences: a document in the account comes back
 * on a tap, and a document that is only on this phone does not come back at
 * all. That is the `Remove Download` / `Delete Document` distinction, made
 * where somebody is actually choosing between them.
 *
 * No covers. This is the one library surface where a document is a quantity
 * rather than something to open, and a column of covers would sell the reader
 * each one back at the moment they are trying to let it go.
 */
export function DeviceStorageScreen() {
  const router = useRouter();
  const { entries, used, free, loading } = useDeviceStorage();
  const { removeDownload } = useLibraryActions();
  const [confirming, setConfirming] = useState<StorageEntry | null>(null);

  // Below the headroom `space.ts` insists on, the next import of any size is
  // going to be refused. Saying so here is the difference between a reader
  // finding out now and finding out from a file picker.
  const tight = free !== null && free < HEADROOM_BYTES * 2;

  return (
    <Screen edges={['top', 'bottom']}>
      <HStack className="items-center px-4 py-2" space="sm">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="rounded-md p-2 data-[active=true]:bg-hover">
          <Icon as={ArrowLeft} size="lg" className="text-foreground" />
        </Pressable>
        <Text size="md" className="font-semibold text-foreground">
          On this device
        </Text>
      </HStack>

      <ScrollView contentContainerClassName="pb-12">
        <HStack className="items-start px-6 pt-2 pb-5" space="md">
          <Icon as={HardDrive} size="lg" className="text-primary" />
          <VStack className="flex-1" space="xs">
            {loading ? (
              <Skeleton className="h-5 w-52 rounded-md" />
            ) : (
              <Text size="md" className="text-foreground">
                {entries.length === 0
                  ? 'No documents on this device'
                  : `${formatBytes(used)} across ${
                      entries.length === 1 ? '1 document' : `${entries.length} documents`
                    }`}
              </Text>
            )}
            <Text size="xs" className="text-fg-subtle">
              {free === null
                ? 'Largest first.'
                : `${formatBytes(free)} free on this device. Largest first.`}
            </Text>
          </VStack>
        </HStack>

        {tight ? (
          <Notice
            glyph={TriangleAlert}
            tone="text-destructive"
            text={`There is not much room left. An import larger than about ${formatBytes(
              Math.max(0, (free ?? 0) - HEADROOM_BYTES),
            )} will be refused until you remove something.`}
          />
        ) : null}

        {databaseEncrypted() ? null : (
          <Notice
            glyph={Lock}
            tone="text-fg-muted"
            text="This build cannot encrypt the library on disk. Your documents and the text taken from them are stored in the clear on this device."
          />
        )}

        {loading ? null : entries.length === 0 ? (
          <Center className="px-10 pt-16">
            <Text size="sm" className="text-center text-fg-subtle">
              Documents you import or download are kept here so they open with no connection.
              Nothing is on this device yet.
            </Text>
          </Center>
        ) : (
          entries.map((entry) => (
            <Row key={entry.document.id} entry={entry} onRemove={() => setConfirming(entry)} />
          ))
        )}
      </ScrollView>

      <AlertDialog
        isOpen={confirming !== null}
        onClose={() => setConfirming(null)}
        size="md">
        <AlertDialogBackdrop />
        <AlertDialogContent className="rounded-md border border-border bg-popover">
          <AlertDialogHeader>
            <Heading size="md" className="text-foreground">
              {confirming?.recoverable === true
                ? 'Remove from this device?'
                : 'This is the only copy'}
            </Heading>
          </AlertDialogHeader>
          <AlertDialogBody className="mt-2 mb-4">
            <Text size="sm" className="text-muted-foreground">
              {confirming === null
                ? ''
                : confirming.recoverable
                  ? `${confirming.document.title} stays in your account. It will need downloading again to read it here, and reading it offline will not be possible until you do.`
                  : `${confirming.document.title} is not in your account, so removing it here deletes it for good. Sync it first if you want to keep it.`}
            </Text>
          </AlertDialogBody>
          <AlertDialogFooter>
            <Button variant="outline" size="sm" onPress={() => setConfirming(null)}>
              <ButtonText>Cancel</ButtonText>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onPress={() => {
                const target = confirming;
                setConfirming(null);
                if (target !== null) {
                  void removeDownload(target.document.id);
                }
              }}>
              <ButtonText>Remove</ButtonText>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Screen>
  );
}

/** A quiet line above the list. Never a banner: nothing here is an emergency. */
function Notice({
  glyph,
  tone,
  text,
}: {
  glyph: React.ComponentProps<typeof Icon>['as'];
  tone: string;
  text: string;
}) {
  return (
    <HStack className="items-start px-6 pb-5" space="sm">
      <Icon as={glyph} size="sm" className={`mt-0.5 ${tone}`} />
      <Text size="xs" className="flex-1 text-fg-subtle">
        {text}
      </Text>
    </HStack>
  );
}

function Row({ entry, onRemove }: { entry: StorageEntry; onRemove: () => void }) {
  const { document, bytes, recoverable } = entry;

  return (
    <HStack className="items-start border-b border-hairline px-6 py-3.5" space="md">
      <Icon
        as={recoverable ? CloudCheck : Smartphone}
        size="sm"
        className={`mt-0.5 ${recoverable ? 'text-fg-muted' : 'text-destructive'}`}
      />
      <VStack className="flex-1" space="xs">
        <Text size="sm" numberOfLines={2} className="font-semibold text-foreground">
          {document.title}
        </Text>
        <Text size="xs" className={recoverable ? 'text-fg-subtle' : 'text-destructive'}>
          {recoverable
            ? 'In your account. Removing it here downloads again in a tap.'
            : 'On this phone only. Removing it deletes it for good.'}
        </Text>
      </VStack>
      <VStack className="items-end" space="xs">
        <Text size="xs" className="text-fg-muted">
          {formatBytes(bytes)}
        </Text>
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${document.title} from this device`}
          className="rounded-md data-[active=true]:bg-hover">
          <Text size="xs" className="text-primary">
            Remove
          </Text>
        </Pressable>
      </VStack>
    </HStack>
  );
}
