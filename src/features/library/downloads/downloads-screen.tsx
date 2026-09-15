import { useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { CloudDownload, Info, SlidersHorizontal } from 'lucide-react-native';
import React, { useCallback, useMemo, useState } from 'react';

import { Screen } from '@/components/layout/screen';
import { Divider } from '@/components/ui/divider';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import {
  Empty,
  ListSkeleton,
  Notice,
  ScreenHeader,
  Segments,
} from '@/features/sharing/components/segments';

import { formatBytes } from '../data/types';
import { SEGMENT_STATES, useDownloads, type DownloadEntry } from '../data/use-downloads';
import { DownloadActions } from './components/download-actions';
import { DownloadRow } from './components/download-row';

/**
 * What opens with no connection, and what everything else is waiting for.
 *
 * The screen `/storage` implied and did not answer. That one is about
 * *quantity* — what the library takes up here, largest first, and what removing
 * any of it costs — and it is still the right screen for that. This one is
 * about *state*: a reader about to get on a plane wants to know which of their
 * books will open at thirty thousand feet, and before this existed the honest
 * answer was only available by opening each of them.
 *
 * A route rather than a sheet, because it holds a list. `docs/design.md` draws
 * that line and this is on the obvious side of it: the height of this screen is
 * the reader's data.
 *
 * Sorted by what is happening rather than by state group, deliberately. A
 * transfer in flight is at the top because it is the thing somebody opened this
 * screen to watch; everything after it is ordered by how much attention it
 * wants. It is not re-sorted as states change — a row that moved out from under
 * a thumb at the moment its download finished would be worse than a list that
 * is occasionally a little out of order.
 */
export function DownloadsScreen() {
  const router = useRouter();
  const { entries, loading } = useDownloads();
  const [segment, setSegment] = useState('all');
  const [acting, setActing] = useState<DownloadEntry | null>(null);

  const shown = useMemo(() => {
    const states = SEGMENT_STATES[segment];
    return states === undefined ? entries : entries.filter((e) => states.has(e.fileState));
  }, [entries, segment]);

  const counts = useMemo(() => {
    let here = 0;
    let bytes = 0;
    let waiting = 0;
    let problems = 0;
    for (const entry of entries) {
      if (SEGMENT_STATES.device.has(entry.fileState)) {
        here += 1;
        bytes += entry.file.localBytes ?? entry.byteSize;
      }
      if (SEGMENT_STATES.waiting.has(entry.fileState)) waiting += 1;
      if (SEGMENT_STATES.problems.has(entry.fileState)) problems += 1;
    }
    return { here, bytes, waiting, problems };
  }, [entries]);

  const open = useCallback(
    (entry: DownloadEntry) => {
      // Only a file that is here and verified opens. Anything else is a state
      // the sheet can act on, which is where a tap goes instead.
      if (entry.fileState === 'available' || entry.fileState === 'outdated') {
        router.push({ pathname: '/reader', params: { id: entry.id } });
        return;
      }
      setActing(entry);
    },
    [router],
  );

  const header = (
    <>
      <ScreenHeader
        glyph={CloudDownload}
        title="Downloads"
        subtitle={
          counts.here === 0
            ? 'Nothing on this device'
            : `${counts.here} on this device · ${formatBytes(counts.bytes)}`
        }
        trailing={
          <Pressable
            onPress={() => router.push('/download-settings')}
            accessibilityRole="button"
            accessibilityLabel="Download settings"
            className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover"
          >
            <Icon as={SlidersHorizontal} size="md" className="text-fg-muted" />
          </Pressable>
        }
        onBack={() => router.back()}
      />
      <Segments
        segments={[
          { key: 'all', label: 'All' },
          { key: 'device', label: 'On this device' },
          {
            key: 'waiting',
            label: counts.waiting === 0 ? 'Waiting' : `Waiting · ${counts.waiting}`,
          },
          {
            key: 'problems',
            label: counts.problems === 0 ? 'Problems' : `Problems · ${counts.problems}`,
          },
        ]}
        active={segment}
        onSelect={setSegment}
      />
    </>
  );

  if (loading) {
    return (
      <Screen edges={['top', 'bottom']}>
        {header}
        <ListSkeleton kind="share" rows={6} />
      </Screen>
    );
  }

  if (shown.length === 0) {
    return (
      <Screen edges={['top', 'bottom']}>
        {header}
        <Empty
          glyph={CloudDownload}
          title={segment === 'all' ? 'Nothing downloaded yet' : 'Nothing here'}
          body={
            segment === 'all'
              ? 'A downloaded document opens with no connection — on a plane, underground, or with your account unreachable. Everything else needs a network.'
              : 'Nothing in your library is in this state right now.'
          }
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      {header}

      <FlashList
        data={shown}
        style={FILL}
        keyExtractor={(entry) => entry.id}
        renderItem={({ item }) => (
          <DownloadRow entry={item} onPress={() => open(item)} onOverflow={() => setActing(item)} />
        )}
        ListFooterComponent={
          <VStack className="pb-8">
            <Notice glyph={Info}>
              Removing a download frees the space and leaves the document in your account. A
              document that is only on this phone has no copy to come back from, and its row says so
              before you tap.
            </Notice>
            <Pressable
              onPress={() => router.push('/storage')}
              accessibilityRole="button"
              accessibilityLabel="What the library takes up on this device"
              className="mx-4 rounded-md px-1 py-2 data-[active=true]:bg-hover"
            >
              <Text size="xs" className="text-primary">
                What the library takes up on this device
              </Text>
            </Pressable>
          </VStack>
        }
      />

      <Divider className="bg-hairline" />
      <DownloadActions entry={acting} onClose={() => setActing(null)} />
    </Screen>
  );
}

// A vertical FlashList is a ScrollView underneath, and a ScrollView in a flex
// column with no flex of its own does not get a height to scroll within. Not a
// className: FlashList's own props take styles and are not interop'd.
const FILL = { flex: 1 } as const;
