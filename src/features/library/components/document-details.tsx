import React from 'react';

import {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
} from '@/components/ui/actionsheet';
import { Divider } from '@/components/ui/divider';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { useIsOnThisDevice } from '@/stores/local-library-store';

import type { LibraryDocument } from '../data/types';

/**
 * What Pidom knows about a document.
 *
 * Exists to answer one question the rest of the interface can only gesture at:
 * *why is this not on my other phone?* The two lines that answer it — whether
 * the account has a copy, and whether this device does — are the two the tile
 * compresses into a single word.
 */
export function DocumentDetails({
  document,
  onClose,
}: {
  document: LibraryDocument | null;
  onClose: () => void;
}) {
  const onThisDevice = useIsOnThisDevice(document?.id ?? '');

  return (
    <Actionsheet isOpen={document !== null} onClose={onClose}>
      <ActionsheetBackdrop />
      <ActionsheetContent className="rounded-t-md border-t border-border bg-elevated pb-8">
        <ActionsheetDragIndicatorWrapper>
          <ActionsheetDragIndicator />
        </ActionsheetDragIndicatorWrapper>

        {document === null ? null : (
          <VStack className="w-full">
            <VStack className="px-6 pt-2 pb-3">
              <Heading size="sm" numberOfLines={2} className="text-foreground">
                {document.title}
              </Heading>
            </VStack>
            <Divider className="bg-hairline" />

            <VStack className="px-6 pt-3">
              <Row label="Author" value={document.author ?? 'Not set'} />
              <Row
                label="Pages"
                value={
                  document.pageCount === null
                    ? 'Not counted yet'
                    : `${document.pageCount}`
                }
              />
              <Row label="Size" value={exactBytes(document.byteSize)} />
              <Row label="Added" value={fullDate(document.createdAt)} />
              <Row
                label="Last opened"
                value={document.lastOpenedAt === null ? 'Never' : fullDate(document.lastOpenedAt)}
              />

              <Divider className="my-2 bg-hairline" />

              <Row label="On this device" value={onThisDevice ? 'Yes' : 'No'} />
              <Row
                label="In your account"
                value={
                  document.isSynced
                    ? 'Yes — any device can download it'
                    : 'No — this device only'
                }
              />
            </VStack>
          </VStack>
        )}
      </ActionsheetContent>
    </Actionsheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <HStack className="items-start py-2" space="lg">
      <Text size="xs" className="w-32 text-fg-subtle">
        {label}
      </Text>
      <Text size="sm" className="flex-1 text-foreground">
        {value}
      </Text>
    </HStack>
  );
}

/**
 * The exact number, with the rounded one beside it.
 *
 * Everywhere else in the app shows `4.1 MB`, which is the right answer for a
 * tile. This is the one place somebody is asking because the rounded number was
 * not enough.
 */
function exactBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${mb < 10 ? mb.toFixed(2) : Math.round(mb)} MB · ${bytes.toLocaleString()} bytes`;
}

function fullDate(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
