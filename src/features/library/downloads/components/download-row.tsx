import {
  CircleSlash,
  Clock,
  CloudCheck,
  CloudDownload,
  MoreHorizontal,
  Pause,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  WifiOff,
} from 'lucide-react-native';
import React from 'react';

import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

import { formatBytes } from '../../data/types';
import type { DownloadEntry } from '../../data/use-downloads';
import type { FileState, HoldReason } from '../../local/repository/types';

/**
 * One document, and what its file is doing.
 *
 * No cover, for the same reason `storageRow` in `device-storage.tsx` has none:
 * this screen is about whether a file is here, not about which book to read
 * next, and a column of covers turns a management surface back into a shelf.
 *
 * The state glyph is first and is the only coloured thing in the row, so a
 * column of them can be scanned without a word being read. The size is last and
 * right-aligned in tabular numerals so a column of numbers lines up — and it is
 * an exact byte count rather than a percentage, because the comparison somebody
 * is actually making is against the free space on their phone.
 */

type Look = {
  glyph: React.ComponentProps<typeof Icon>['as'];
  tone: string;
  label: string;
  line: string | null;
};

/**
 * The eleven states, each with one glyph and one sentence.
 *
 * Declared once rather than at the call sites, so the row, the actions sheet
 * and the header counts cannot drift into describing the same state three
 * different ways.
 */
const LOOKS: Record<FileState, Look> = {
  missing: {
    glyph: CloudDownload,
    tone: 'text-fg-muted',
    label: 'Not downloaded',
    line: 'In your account. A tap fetches it.',
  },
  queued: {
    glyph: Clock,
    tone: 'text-fg-subtle',
    label: 'Queued',
    line: 'Waiting for the download before it.',
  },
  held: {
    glyph: WifiOff,
    tone: 'text-warn',
    label: 'Waiting',
    line: null,
  },
  downloading: {
    glyph: CloudDownload,
    tone: 'text-primary',
    label: 'Downloading',
    line: null,
  },
  paused: {
    glyph: Pause,
    tone: 'text-fg-muted',
    label: 'Paused',
    line: 'Resuming keeps what has arrived.',
  },
  verifying: {
    glyph: ShieldCheck,
    tone: 'text-primary',
    label: 'Checking',
    line: 'Making sure the whole file arrived.',
  },
  available: {
    glyph: CloudCheck,
    tone: 'text-ok',
    label: 'On this device',
    line: 'Opens with no connection.',
  },
  outdated: {
    glyph: RefreshCw,
    tone: 'text-warn',
    label: 'A newer copy is in your account',
    line: 'This one still opens. Download again to catch up.',
  },
  corrupt: {
    glyph: ShieldAlert,
    tone: 'text-destructive',
    label: "Didn't arrive whole",
    line: 'Nothing was kept. Try again on a steadier connection.',
  },
  failed: {
    glyph: CircleSlash,
    tone: 'text-destructive',
    label: "Couldn't download",
    line: 'Your account could not be reached.',
  },
  deleting: {
    glyph: Trash2,
    tone: 'text-fg-subtle',
    label: 'Removing',
    line: 'Freeing the space this took.',
  },
  deleted: {
    glyph: Trash2,
    tone: 'text-fg-subtle',
    label: 'Removed',
    line: null,
  },
};

/** Why a held download is held, said as the thing the reader can act on. */
const HELD: Record<HoldReason, string> = {
  wifi: 'Held because downloads are set to Wi-Fi only.',
  'cellular-cap': 'Larger than the mobile-data limit you set.',
  space: 'There is not enough room on this device.',
  cap: 'Larger than the storage limit you set for this device.',
};

export function lookFor(state: FileState): Look {
  return LOOKS[state];
}

export function DownloadRow({
  entry,
  onPress,
  onOverflow,
}: {
  entry: DownloadEntry;
  onPress: () => void;
  onOverflow: () => void;
}) {
  const look = LOOKS[entry.fileState];
  const { file } = entry;

  /**
   * The sentence, in order of what it most needs to say.
   *
   * A hold names its rule, a failure names what went wrong, and everything else
   * falls back to the state's own line. A transfer says neither — the byte
   * count and the bar underneath are more use than any sentence would be.
   */
  const line =
    entry.fileState === 'held' && file.heldReason !== null
      ? HELD[file.heldReason]
      : entry.fileState === 'downloading'
        ? null
        : file.failure !== null && entry.fileState === 'failed'
          ? file.failure
          : look.line;

  const moving = entry.fileState === 'downloading' || entry.fileState === 'paused';
  const sent = file.bytesWritten ?? 0;
  const total = file.totalBytes ?? entry.byteSize;
  const pct = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;

  const size = moving
    ? `${formatBytes(sent)} of ${formatBytes(total)}`
    : formatBytes(file.localBytes ?? entry.byteSize);

  return (
    <HStack className="items-start border-b border-hairline px-4 py-2.5" space="md">
      <Icon as={look.glyph} size="sm" className={`mt-0.5 ${look.tone}`} />

      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${entry.title}. ${look.label}.`}
        className="flex-1 rounded-md data-[active=true]:bg-hover"
      >
        <VStack space="xs">
          <Text size="sm" numberOfLines={2} className="font-semibold text-foreground">
            {entry.title}
          </Text>
          <Text size="xs" className={quietened(look.tone)}>
            {line ?? look.label}
          </Text>
          {moving ? (
            // Two pixels, and hand-rolled rather than the vendored `Progress`,
            // which is eight pixels on a tinted track and is used nowhere in
            // this application. Two bars for one transfer on two screens would
            // be one bar too many; this is the tile's.
            <Box className="mt-1 h-0.5 w-full overflow-hidden rounded-md bg-border">
              <Box className="h-full rounded-md bg-primary" style={{ width: `${pct}%` }} />
            </Box>
          ) : null}
        </VStack>
      </Pressable>

      <VStack className="items-end" space="xs">
        <Text size="xs" className="text-fg-muted">
          {size}
        </Text>
        <Pressable
          onPress={onOverflow}
          accessibilityRole="button"
          accessibilityLabel={`More for ${entry.title}`}
          className="rounded-md p-1 data-[active=true]:bg-hover"
        >
          <Icon as={MoreHorizontal} size="sm" className="text-fg-subtle" />
        </Pressable>
      </VStack>
    </HStack>
  );
}

/**
 * A quiet state does not get to shout.
 *
 * `available` and `missing` are the two commonest rows in any library, and
 * painting a hundred of them green or grey-blue would make the four that need
 * attention invisible. Only the colours that mean something survive into the
 * sentence; the rest fall back to the subtle ink every other list uses.
 */
function quietened(tone: string): string {
  return tone === 'text-ok' || tone === 'text-fg-muted' || tone === 'text-fg-subtle'
    ? 'text-fg-subtle'
    : tone;
}
