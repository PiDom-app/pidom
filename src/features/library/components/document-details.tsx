import { useQuery } from 'convex/react';
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
import { api } from '@convex/_generated/api';
import { useIsOnThisDevice } from '@/stores/local-library-store';

import type { LibraryDocument } from '../data/types';
import { useLibraryStatus } from '../data/use-library-status';

/**
 * What Pidom knows about a document.
 *
 * Exists to answer one question the rest of the interface can only gesture at:
 * *why is this not on my other phone?* The two lines that answer it — whether
 * the account has a copy, and whether this device does — are the two the tile
 * compresses into a single word.
 *
 * It answers a second one now: what was actually made from this file. Four
 * facts that used to be one silent boolean, split by which half of the pipeline
 * produced them — the cover and the contents came off the phone, the searchable
 * text came off the copy in the account.
 */
export function DocumentDetails({
  document,
  onClose,
}: {
  document: LibraryDocument | null;
  onClose: () => void;
}) {
  const onThisDevice = useIsOnThisDevice(document?.id ?? '');
  const { ready } = useLibraryStatus();

  // Only while the sheet is open, and only for a document whose text is
  // actually moving. A finished extraction has nothing left to watch, and a
  // subscription per opened sheet on a settled row is a socket for a constant.
  const job = useQuery(
    api.library.processingStatus,
    ready &&
      document !== null &&
      (document.textStatus === 'queued' || document.textStatus === 'extracting')
      ? { documentId: document.id }
      : 'skip',
  );

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
              {/* What the file was called when it arrived. Renaming changes the
                  title and nothing else, so this is the only place the original
                  survives — and it is what a reader searches their downloads
                  folder by when they want the file itself. */}
              {document.originalFileName === null ? null : (
                <Row label="File name" value={document.originalFileName} />
              )}
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

              <Divider className="my-2 bg-hairline" />

              <Row label="Cover" value={coverLine(document)} />
              <Row
                label="Contents"
                value={document.hasOutline ? 'Read from the PDF' : 'None in this PDF'}
              />
              <Row label="Searchable text" value={textLine(document, job ?? null)} />
            </VStack>
          </VStack>
        )}
      </ActionsheetContent>
    </Actionsheet>
  );
}

/**
 * What became of the first page.
 *
 * Three outcomes rather than a tick: rendered, tried and failed, or never
 * attempted at all. The last one is every document imported before the probe
 * existed, and it is why Reprocess is offered rather than the tile quietly
 * showing a tint forever.
 */
function coverLine(document: LibraryDocument): string {
  switch (document.processing) {
    case 'probing':
      return 'Being read now';
    case 'ready':
      return 'Page 1, rendered';
    case 'partial':
      return 'Could not be rendered — the tinted cover stands in';
    case 'failed':
      return 'This PDF could not be read';
  }
}

/**
 * Whether the pages of this document can be searched, and how far along that is.
 *
 * A local-only document has no answer here and says why. That is not a failure
 * — extraction reads the copy in the account, because that copy is the only one
 * the server can see.
 */
function textLine(
  document: LibraryDocument,
  job: { pagesDone: number; pagesTotal: number | null } | null,
): string {
  if (!document.isSynced) {
    return 'Needs a copy in your account';
  }
  switch (document.textStatus) {
    case null:
      return 'Not read yet';
    case 'queued':
      return 'Waiting to be read';
    case 'extracting':
      return job === null || job.pagesTotal === null
        ? 'Being read now'
        : `Being read — ${job.pagesDone} of ${job.pagesTotal}`;
    case 'ready':
      return 'Searchable';
    case 'none':
      return 'None in this PDF — it is a scan';
    case 'failed':
      return 'Could not be read';
  }
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
