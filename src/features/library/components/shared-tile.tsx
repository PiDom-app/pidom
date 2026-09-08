import { CloudDownload, Inbox } from 'lucide-react-native';
import React from 'react';

import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { Progress, ProgressFilledTrack } from '@/components/ui/progress';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { COVER_WIDTH } from '@/features/library/components/document-cover';
import type { LibraryShare } from '@/features/library/local/repository/types';
import { useTransfer } from '@/stores/transfer-store';

/**
 * A document somebody else sent, on the home screen.
 *
 * Not a `DocumentTile`, and it cannot be one: a `DocumentTile` renders a cover
 * read from this device's filesystem, and a share that has not been accepted
 * has no file here to read. So the shape is the same — cover-sized block, two
 * lines under it — and the block says what it is rather than pretending to be a
 * page nobody has downloaded.
 *
 * The line underneath is the state: `Decide` for one waiting on the reader,
 * `Download` for one they have accepted and not fetched. Both are the next
 * thing to do rather than a description, because that is what somebody scanning
 * a rail is looking for.
 */
export function SharedTile({
  share,
  onPress,
}: {
  share: LibraryShare;
  onPress: (share: LibraryShare) => void;
}) {
  const waiting = share.status === 'pending';
  const height = Math.round(COVER_WIDTH * COVER_RATIO);

  /**
   * Bytes moving for this document, if any are.
   *
   * Keyed on the account's document id, which is what a share row carries and
   * what `use-share-download.ts` mints the local row against — a download
   * started from the share screen shows here too, because it is the same file
   * arriving.
   */
  const transfer = useTransfer(share.documentId ?? '');
  const percent =
    transfer === null || transfer.total === 0
      ? 0
      : Math.round((transfer.sent / transfer.total) * 100);

  return (
    <Pressable
      onPress={() => onPress(share)}
      accessibilityRole="button"
      accessibilityLabel={`${share.title ?? 'A shared document'} from ${share.counterpartName ?? 'someone'}`}
      className="rounded-md data-[active=true]:bg-hover">
      <VStack style={{ width: COVER_WIDTH }}>
        <Box
          className="items-center justify-center rounded-md bg-surface"
          style={{ width: COVER_WIDTH, height }}>
          <Text size="xs" className="font-semibold tracking-wider text-fg-subtle">
            PDF
          </Text>
        </Box>

        <Text size="xs" numberOfLines={2} className="mt-2 text-foreground">
          {share.title ?? 'A shared document'}
        </Text>

        {transfer === null ? null : (
          <Progress value={percent} className="mt-[7px] h-0.5 bg-border">
            <ProgressFilledTrack className="bg-primary" />
          </Progress>
        )}

        <HStack className="mt-1 items-center gap-1">
          <Icon
            as={waiting ? Inbox : CloudDownload}
            size="2xs"
            className={waiting ? 'text-primary' : 'text-fg-subtle'}
          />
          <Text
            size="2xs"
            numberOfLines={1}
            className={waiting ? 'flex-1 text-primary' : 'flex-1 text-fg-subtle'}>
            {transfer === null
              ? `${share.groupName ?? share.counterpartName ?? 'Someone'} · ${waiting ? 'decide' : 'download'}`
              : `Downloading · ${percent}%`}
          </Text>
        </HStack>
      </VStack>
    </Pressable>
  );
}

/** A page is 1 : 1.417, which is what every cover in this app is drawn at. */
const COVER_RATIO = 170 / 120;
