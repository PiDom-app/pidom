import { useRouter } from 'expo-router';
import {
  BookOpen,
  CloudDownload,
  FileCheck2,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react-native';
import React, { useCallback, useState } from 'react';

import { useAppToast } from '@/components/feedback/use-app-toast';
import {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
  ActionsheetIcon,
  ActionsheetItem,
  ActionsheetItemText,
} from '@/components/ui/actionsheet';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { ConfirmDialog } from '@/features/sharing/components/confirm-dialog';

import { formatBytes } from '../../data/types';
import type { DownloadEntry } from '../../data/use-downloads';
import { useDownloadActions } from '../use-download-actions';
import { lookFor } from './download-row';

/**
 * What a reader can do to one download.
 *
 * An `Actionsheet` rather than a `BottomSheet`, for the reason
 * `document-actions.tsx` gives: gluestack's is built on `@gorhom/bottom-sheet`,
 * which this project does not install, and this list is seven rows that will
 * never be a hundred — it has no height that is the reader's data and needs no
 * snap points.
 *
 * **Items are absent, never disabled**, matching the sheet next door. A paused
 * download offers Resume and a running one offers Pause; neither shows the
 * other greyed out, because a control that is present and inert is a control
 * somebody taps twice before reading it.
 *
 * **Remove download and Delete never share a row**, and only one of them is
 * ever in the destructive colour. One frees space and costs a tap to undo; the
 * other destroys the only copy. `device-storage.tsx` wrote the two sentences
 * that tell them apart, and this reuses them rather than writing a third.
 */
export function DownloadActions({
  entry,
  onClose,
}: {
  entry: DownloadEntry | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const showToast = useAppToast();
  const actions = useDownloadActions();
  const [confirming, setConfirming] = useState(false);

  const run = useCallback(
    (work: Promise<unknown>, after?: () => void) => {
      onClose();
      void work.then(() => after?.());
    },
    [onClose],
  );

  if (entry === null) {
    return null;
  }

  const look = lookFor(entry.fileState);
  const here = entry.fileState === 'available' || entry.fileState === 'outdated';
  const moving = entry.fileState === 'downloading';
  const stopped = entry.fileState === 'paused';
  const waiting = entry.fileState === 'queued' || entry.fileState === 'held';
  const broken = entry.fileState === 'corrupt' || entry.fileState === 'failed';
  const fetchable = entry.isSynced;

  return (
    <>
      <Actionsheet isOpen={!confirming} onClose={onClose}>
        <ActionsheetBackdrop />
        <ActionsheetContent className="rounded-t-md border-t border-border bg-elevated pb-7">
          <ActionsheetDragIndicatorWrapper>
            <ActionsheetDragIndicator />
          </ActionsheetDragIndicatorWrapper>

          <HStack className="w-full items-center px-4 pt-2.5 pb-3.5" space="md">
            <Icon as={look.glyph} size="md" className={look.tone} />
            <VStack className="flex-1">
              <Text size="md" numberOfLines={1} className="font-semibold text-foreground">
                {entry.title}
              </Text>
              <Text size="xs" numberOfLines={1} className="mt-0.5 text-fg-subtle">
                {describe(entry)}
              </Text>
            </VStack>
          </HStack>

          <Divider className="bg-hairline" />

          <VStack className="w-full pt-1">
            {here ? (
              <ActionsheetItem
                onPress={() => {
                  onClose();
                  router.push({ pathname: '/reader', params: { id: entry.id } });
                }}
              >
                <ActionsheetIcon as={BookOpen} className="text-fg-muted" />
                <ActionsheetItemText className="text-foreground">Open</ActionsheetItemText>
              </ActionsheetItem>
            ) : null}

            {moving ? (
              <ActionsheetItem onPress={() => run(actions.pause(entry.id))}>
                <ActionsheetIcon as={Pause} className="text-fg-muted" />
                <ActionsheetItemText className="text-foreground">
                  Pause download
                </ActionsheetItemText>
              </ActionsheetItem>
            ) : null}

            {stopped ? (
              <ActionsheetItem onPress={() => run(actions.resume(entry.id))}>
                <ActionsheetIcon as={Play} className="text-fg-muted" />
                <ActionsheetItemText className="text-foreground">Resume</ActionsheetItemText>
              </ActionsheetItem>
            ) : null}

            {entry.fileState === 'held' ? (
              <ActionsheetItem onPress={() => run(actions.downloadAnyway(entry.id))}>
                <ActionsheetIcon as={CloudDownload} className="text-fg-muted" />
                <ActionsheetItemText className="text-foreground">
                  Download anyway
                </ActionsheetItemText>
              </ActionsheetItem>
            ) : null}

            {moving || stopped || waiting ? (
              <ActionsheetItem onPress={() => run(actions.cancel(entry.id))}>
                <ActionsheetIcon as={X} className="text-fg-muted" />
                <ActionsheetItemText className="text-foreground">Cancel</ActionsheetItemText>
              </ActionsheetItem>
            ) : null}

            {fetchable && (here || broken) ? (
              <ActionsheetItem onPress={() => run(actions.request(entry.id))}>
                <ActionsheetIcon as={RefreshCw} className="text-fg-muted" />
                <ActionsheetItemText className="text-foreground">
                  {broken ? 'Try again' : 'Download again'}
                </ActionsheetItemText>
              </ActionsheetItem>
            ) : null}

            {entry.fileState === 'missing' && fetchable ? (
              <ActionsheetItem onPress={() => run(actions.request(entry.id))}>
                <ActionsheetIcon as={CloudDownload} className="text-fg-muted" />
                <ActionsheetItemText className="text-foreground">
                  Download to this device
                </ActionsheetItemText>
              </ActionsheetItem>
            ) : null}

            {here ? (
              <ActionsheetItem
                onPress={() =>
                  run(actions.verify(entry.id), () =>
                    showToast({
                      id: 'verify',
                      tone: 'info',
                      title: 'Checked',
                      description: 'Pidom read the file back and compared it with your account.',
                    }),
                  )
                }
              >
                <ActionsheetIcon as={FileCheck2} className="text-fg-muted" />
                <ActionsheetItemText className="text-foreground">
                  Check this file
                </ActionsheetItemText>
              </ActionsheetItem>
            ) : null}

            {here ? (
              <>
                <Divider className="my-1 bg-hairline" />
                <ActionsheetItem onPress={() => setConfirming(true)}>
                  <ActionsheetIcon as={Trash2} className="text-destructive" />
                  <ActionsheetItemText className="text-destructive">
                    Remove from this device
                  </ActionsheetItemText>
                </ActionsheetItem>
              </>
            ) : null}
          </VStack>
        </ActionsheetContent>
      </Actionsheet>

      {/* The wording is `device-storage.tsx`'s, because the distinction it draws
          is the same one and saying it two different ways would make one of them
          look like a different consequence. */}
      <ConfirmDialog
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          run(actions.removeDownload(entry.id));
        }}
        title={entry.isSynced ? 'Remove from this device?' : 'This is the only copy'}
        lines={
          entry.isSynced
            ? [
                `${entry.title} stays in your account. It will need downloading again to read it here, and reading it offline will not be possible until you do.`,
              ]
            : [
                `${entry.title} is not in your account, so removing it here deletes it for good. Sync it first if you want to keep it.`,
              ]
        }
        confirmLabel="Remove"
      />
    </>
  );
}

/** The subtitle: what this document is, in the terms this screen is about. */
function describe(entry: DownloadEntry): string {
  const size = formatBytes(entry.file.localBytes ?? entry.byteSize);
  const pages = entry.pageCount === null ? null : `${entry.pageCount} pages`;
  const checked =
    entry.file.lastVerifiedAt === null
      ? null
      : entry.file.hashed
        ? 'checked in full'
        : 'checked by size and fingerprint';
  return [lookFor(entry.fileState).label, pages, size, checked].filter(Boolean).join(' · ');
}
