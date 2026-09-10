import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Ban, Check, Clock, CloudDownload, Inbox, Lock, Send, Users } from 'lucide-react-native';
import React, { useMemo, useState } from 'react';

import { Screen } from '@/components/layout/screen';
import { Avatar, AvatarFallbackText, AvatarImage } from '@/components/ui/avatar';
import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import type { LibraryShare } from '@/features/library/local/repository/types';

import { Tag } from './components/person-row';
import { Empty, ListSkeleton, Notice, ScreenHeader, Segments } from './components/segments';
import { useInbox } from './data/use-sharing';

/**
 * What has been shared with this reader, and what they have shared out.
 *
 * Every row is drawn from the device's own `shares` table, which carries the
 * title, the size and the page count — so this screen is legible with no
 * connection and before a single byte of any of these documents has been
 * fetched. Nothing here is a `file://` path and nothing here is downloaded.
 *
 * Three segments rather than three screens, in the navigator's chip row.
 * Pending is separate from the rest because it is the one that is *waiting on
 * the reader*, and a badge that meant "you have unread things somewhere in a
 * list" would be a badge nobody could clear.
 */
export function SharedScreen() {
  const router = useRouter();
  const { incoming, pending, outgoing, loading } = useInbox();
  const [segment, setSegment] = useState<'shared' | 'pending' | 'sent'>('shared');

  const segments = useMemo(
    () => [
      { key: 'shared', label: 'Shared with you' },
      { key: 'pending', label: pending.length === 0 ? 'Pending' : `Pending · ${pending.length}` },
      { key: 'sent', label: 'Sent' },
    ],
    [pending.length],
  );

  // Pending is its own list, so the main one is everything that has been
  // settled — an accepted share, and a revoked one that still explains itself.
  const settled = useMemo(() => incoming.filter((share) => share.status !== 'pending'), [incoming]);

  const rows = segment === 'pending' ? pending : segment === 'sent' ? outgoing : settled;

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        glyph={Inbox}
        title="Shared"
        subtitle={
          incoming.length === 0 && outgoing.length === 0
            ? 'Nothing yet'
            : `${incoming.length} with you · ${outgoing.length} sent`
        }
        trailing={
          rows.length === 0 ? undefined : (
            <Text size="xs" className="text-fg-subtle">
              {rows.length}
            </Text>
          )
        }
        onBack={() => router.back()}
      />

      <Segments
        segments={segments}
        active={segment}
        onSelect={(key) => setSegment(key as typeof segment)}
      />

      {loading ? (
        <ListSkeleton kind="share" />
      ) : rows.length === 0 ? (
        <Empty {...EMPTY[segment]} />
      ) : (
        <FlashList
          style={FILL}
          data={rows}
          keyExtractor={(share) => share.id}
          contentContainerStyle={LIST_CONTENT}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            segment === 'pending' ? (
              <Notice glyph={Lock}>
                Nothing is downloaded until you accept. Until then all Pidom has told you is the
                title and who sent it. Documents shared with a group are not here — being in the
                group is the agreement, so they are already under Shared with you.
              </Notice>
            ) : null
          }
          renderItem={({ item }) => (
            <ShareRow
              share={item}
              onPress={() => router.push({ pathname: '/share-detail', params: { id: item.id } })}
            />
          )}
        />
      )}
    </Screen>
  );
}

/**
 * One share, as a row.
 *
 * No cover component: `DocumentCover` reads the filesystem for a thumbnail, and
 * a share the reader has not accepted has no file on this device to read. The
 * initial block stands in, and it is honest — there is nothing here yet.
 */
function ShareRow({ share, onPress }: { share: LibraryShare; onPress: () => void }) {
  const who = share.groupName ?? share.counterpartName ?? 'Someone';
  const gone = share.status === 'revoked' || share.status === 'expired';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={share.title ?? 'A shared document'}
      className="data-[active=true]:bg-hover"
    >
      <HStack className={`items-center px-4 py-2 ${gone ? 'opacity-60' : ''}`} space="md">
        <Box className="h-14 w-10 items-center justify-center rounded-md bg-surface">
          <Text size="2xs" className="font-semibold tracking-wider text-fg-subtle">
            PDF
          </Text>
        </Box>

        <VStack className="flex-1">
          <Text size="sm" numberOfLines={2} className="text-foreground">
            {share.title ?? 'A shared document'}
          </Text>
          <HStack className="mt-1 items-center gap-1.5">
            {/* Round is a person and square is a group, everywhere. A group
                share used to draw a round avatar carrying one arbitrary
                member's photo, which read as that person having sent it. */}
            {share.groupName === null ? (
              <Avatar className="h-4 w-4">
                <AvatarFallbackText>{who}</AvatarFallbackText>
                <AvatarImage
                  source={{ uri: share.counterpartPictureUrl }}
                  recyclingKey={share.id}
                />
              </Avatar>
            ) : (
              <Box className="h-4 w-4 items-center justify-center rounded-[3px] bg-surface">
                <Icon as={Users} size="2xs" className="text-fg-subtle" />
              </Box>
            )}
            <Text size="xs" numberOfLines={1} className="flex-1 text-fg-subtle">
              {who} · {detailFor(share)}
            </Text>
          </HStack>
        </VStack>

        <Trailing share={share} />
      </HStack>
    </Pressable>
  );
}

function Trailing({ share }: { share: LibraryShare }) {
  if (share.direction === 'outgoing') {
    if (share.syncState !== 'synced') {
      return <Icon as={Clock} size="sm" className="text-fg-subtle" />;
    }
    return <Tag label={share.groupName === null ? '1 person' : share.groupName} />;
  }
  if (share.status === 'pending') {
    return <Tag label="Decide" tone="primary" />;
  }
  if (share.status === 'revoked' || share.status === 'expired') {
    return <Icon as={Ban} size="sm" className="text-fg-subtle" />;
  }
  return <Icon as={CloudDownload} size="sm" className="text-primary" />;
}

/** The line under the title. Says what this share is, never what it is called. */
function detailFor(share: LibraryShare): string {
  if (share.status === 'revoked') {
    return 'access removed';
  }
  if (share.status === 'expired') {
    return 'expired';
  }
  if (share.status === 'declined') {
    return 'declined';
  }
  if (share.direction === 'outgoing' && share.syncState !== 'synced') {
    return 'waiting to send';
  }
  return share.role === 'annotator' ? 'can annotate' : 'can read';
}

const EMPTY = {
  shared: {
    glyph: Inbox,
    title: 'Nothing shared with you',
    body: 'When somebody shares a PDF with you it lands here, with their name on it, before anything is downloaded.',
  },
  pending: {
    glyph: Check,
    title: 'Nothing waiting on you',
    body: 'An invitation to read somebody else’s document appears here until you answer it.',
  },
  sent: {
    glyph: Send,
    title: 'You have not shared anything',
    body: 'Open a document and tap Share to send it to somebody or to one of your groups.',
  },
} as const;

const FILL = { flex: 1 } as const;
const LIST_CONTENT = { paddingBottom: 32 } as const;
