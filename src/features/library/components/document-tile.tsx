import { CloudDownload, Smartphone, TriangleAlert } from 'lucide-react-native';
import React from 'react';

import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Progress, ProgressFilledTrack } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { useTransfer } from '@/stores/transfer-store';

import type { LibraryDocument, Placement } from '../data/types';
import { metaLineFor, placementOf } from '../data/types';
import { COVER_WIDTH, DocumentCover, coverHeight } from './document-cover';

/**
 * How tall a tile is, from the pieces that make it.
 *
 * A horizontal list inside a vertical one is the classic place a layout
 * collapses to nothing, so the rail is told its height instead of measuring
 * for it. Kept next to the markup it describes: change one and the other is
 * on the same screen.
 *
 * cover · 8 gap · two 16px title lines · optional 7 gap + 2 bar · 4 gap · 13px meta
 */
export function tileHeight(width: number, showProgress: boolean): number {
  return coverHeight(width) + 8 + 32 + (showProgress ? 9 : 0) + 4 + 13;
}

/** The glyph that goes in front of the meta line, if any. */
function glyphFor(document: LibraryDocument, placement: Placement) {
  // A document the viewer could not read says so, whatever else is true of it.
  if (document.processing === 'failed') {
    return TriangleAlert;
  }
  switch (placement) {
    case 'fetchable':
      return CloudDownload;
    case 'local-only':
      return Smartphone;
    // The file is here and does not open. The same glyph as a failed probe,
    // because from the reader's side it is the same sentence: this one will not
    // open, and there is something to try.
    case 'unreadable':
      return TriangleAlert;
    case 'here':
    case 'transferring':
      return null;
  }
}

/**
 * The one component that draws a document.
 *
 * Every rail, the all-library grid and the action sheet's header all render
 * this or `DocumentRow` beside it, which is what keeps a document looking like
 * the same object wherever the reader meets it.
 *
 * There is no overflow button and no badge. Actions arrive on a long press, so
 * a rail of twelve documents carries twelve fewer pieces of chrome than it
 * would otherwise — which is most of what stops the screen reading as a
 * dashboard.
 */
export function DocumentTile({
  document,
  width = COVER_WIDTH,
  showProgress = false,
  onPress,
  onLongPress,
}: {
  document: LibraryDocument;
  width?: number;
  showProgress?: boolean;
  onPress: (document: LibraryDocument) => void;
  onLongPress: (document: LibraryDocument) => void;
}) {
  // `fileState` on the row is what says whether this one opens, and it is the
  // only thing that does: it is written after a download has been checked, not
  // from a flag the account set. The scan store is no longer consulted here.
  const onThisDevice = document.fileState === 'available';
  const transfer = useTransfer(document.id);
  const placement = placementOf(document, { transferring: transfer !== null });
  const meta = metaLineFor(document, { showProgress, transfer });
  const glyph = glyphFor(document, placement);

  // One meaning at a time in the same 2px. A transfer's bar is the transfer,
  // not the reading position — and a document still being probed gets neither,
  // because a third meaning in two pixels is a bar nobody can read.
  const bar =
    document.processing === 'probing'
      ? null
      : transfer !== null
        ? transfer.total > 0
          ? Math.round((transfer.sent / transfer.total) * 100)
          : 0
        : showProgress && onThisDevice
          ? Math.round(document.progress * 100)
          : null;

  // Never disabled, even for a document imported on another phone. Disabling
  // would take the long press with it, and the action sheet is the only way to
  // rename or delete one — which is exactly what a reader wants to do with a
  // document they cannot open here.
  return (
    <Pressable
      onPress={() => onPress(document)}
      onLongPress={() => onLongPress(document)}
      accessibilityRole="button"
      accessibilityLabel={`${document.title}. ${meta}`}
      style={{ width, height: tileHeight(width, showProgress) }}>
      {/* The probe has not reported, so there is no cover to draw and no tint
          worth drawing either — the tint is the *fallback*, and showing it here
          would mean replacing it a second later. */}
      {document.processing === 'probing' && onThisDevice ? (
        <Skeleton
          className="rounded-md"
          style={{ width, height: coverHeight(width) }}
        />
      ) : (
        <DocumentCover
          documentId={document.id}
          title={document.title}
          width={width}
          dimmed={!onThisDevice}
        />
      )}

      <Text
        size="xs"
        numberOfLines={2}
        className={`mt-2 ${onThisDevice ? 'text-foreground' : 'text-fg-muted'}`}>
        {document.title}
      </Text>

      {bar === null ? null : (
        <Progress value={bar} className="mt-[7px] h-0.5 bg-border">
          <ProgressFilledTrack className="bg-primary" />
        </Progress>
      )}

      <HStack className="mt-1 items-center" space="xs">
        {glyph === null ? null : (
          <Icon
            as={glyph}
            size="2xs"
            className={placement === 'fetchable' ? 'text-fg-muted' : 'text-fg-subtle'}
          />
        )}
        <Text
          size="2xs"
          numberOfLines={1}
          className={`flex-1 ${placement === 'fetchable' ? 'text-fg-muted' : 'text-fg-subtle'}`}>
          {meta}
        </Text>
      </HStack>
    </Pressable>
  );
}

/** The same document as a full-width row. The all-library list mode. */
export function DocumentRow({
  document,
  onPress,
  onLongPress,
}: {
  document: LibraryDocument;
  onPress: (document: LibraryDocument) => void;
  onLongPress: (document: LibraryDocument) => void;
}) {
  const onThisDevice = document.fileState === 'available';
  const transfer = useTransfer(document.id);
  const placement = placementOf(document, { transferring: transfer !== null });
  const meta = metaLineFor(document, { showProgress: true, transfer });
  const glyph = glyphFor(document, placement);

  return (
    <Pressable
      onPress={() => onPress(document)}
      onLongPress={() => onLongPress(document)}
      accessibilityRole="button"
      accessibilityLabel={`${document.title}. ${meta}`}
      className="px-6 py-3 data-[active=true]:bg-hover">
      <HStack className="items-center" space="lg">
        {document.processing === 'probing' && onThisDevice ? (
          <Skeleton className="rounded-md" style={{ width: 44, height: coverHeight(44) }} />
        ) : (
          <DocumentCover
            documentId={document.id}
            title={document.title}
            width={44}
            dimmed={!onThisDevice}
          />
        )}

        <VStack className="flex-1">
          <Text
            size="sm"
            numberOfLines={2}
            className={onThisDevice ? 'text-foreground' : 'text-fg-muted'}>
            {document.title}
          </Text>

          <HStack className="mt-1 items-center" space="xs">
            {glyph === null ? null : (
              <Icon
                as={glyph}
                size="2xs"
                className={placement === 'fetchable' ? 'text-fg-muted' : 'text-fg-subtle'}
              />
            )}
            <Text
              size="xs"
              numberOfLines={1}
              className={`flex-1 ${placement === 'fetchable' ? 'text-fg-muted' : 'text-fg-subtle'}`}>
              {document.author === null ? meta : `${document.author} · ${meta}`}
            </Text>
          </HStack>

          {transfer !== null ? (
            <Progress
              value={transfer.total > 0 ? Math.round((transfer.sent / transfer.total) * 100) : 0}
              className="mt-2 h-0.5 w-32 bg-border">
              <ProgressFilledTrack className="bg-primary" />
            </Progress>
          ) : onThisDevice && document.pageCount !== null && document.progress > 0 ? (
            <Progress
              value={Math.round(document.progress * 100)}
              className="mt-2 h-0.5 w-32 bg-border">
              <ProgressFilledTrack className="bg-primary" />
            </Progress>
          ) : null}
        </VStack>
      </HStack>
    </Pressable>
  );
}
