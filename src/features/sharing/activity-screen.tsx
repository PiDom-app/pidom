import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import {
  Ban,
  BellRing,
  Check,
  Lock,
  NotebookPen,
  Share2,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react-native';
import React, { useEffect, useMemo } from 'react';

import { Screen } from '@/components/layout/screen';
import { Avatar, AvatarFallbackText, AvatarImage } from '@/components/ui/avatar';
import { Badge, BadgeText } from '@/components/ui/badge';
import { Box } from '@/components/ui/box';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import type { LibraryShareEvent } from '@/features/library/local/repository/types';

import { Empty, Notice, ScreenHeader } from './components/segments';
import { useShareActions } from './data/use-share-actions';
import { useShareEvents } from './data/use-sharing';

/**
 * What has happened, in order.
 *
 * **The screen that was missing.** `shareEvents` has had a table, a sync pass,
 * a hook that computes `unread` and a mutation to clear it since the day
 * sharing shipped, and nothing rendered any of it — so a share accepted while
 * the reader was away left no trace they could find, and the badge those pieces
 * were built for never existed.
 *
 * It is a **feed**, not an inbox. Every row is something that already happened,
 * so tapping one goes to the share it describes rather than asking for a
 * decision; decisions live under Pending, on the Shared screen. That is the
 * whole distinction between the two, and it is why this is a separate route
 * rather than a fourth segment there.
 *
 * **A row never names the document.** The mirrored event carries a kind, an
 * actor and an id, and nothing else — so a feed that had cached titles could go
 * on showing them after the access that justified them was removed. The title
 * is fetched when the reader taps through, by a query that checks them first.
 */
export function ActivityScreen() {
  const router = useRouter();
  const { events, unread } = useShareEvents();
  const { markEventsRead } = useShareActions();

  const unreadIds = useMemo(
    () => events.filter((event) => !event.read).map((event) => event.id),
    [events],
  );

  /**
   * Marked read on arrival, not on tap.
   *
   * Opening the screen is the reading — every row is one line and they are all
   * on it. Requiring a tap per row would leave the badge lit over things the
   * reader has plainly seen.
   */
  useEffect(() => {
    if (unreadIds.length === 0) {
      return;
    }
    void markEventsRead(unreadIds);
    // Deliberately keyed on the joined ids rather than the array: a new render
    // with the same events must not re-send.
  }, [markEventsRead, unreadIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        glyph={BellRing}
        title="Activity"
        subtitle={
          events.length === 0
            ? 'Nothing yet'
            : unread === 0
              ? `${events.length} ${events.length === 1 ? 'thing' : 'things'}`
              : `${unread} you have not seen`
        }
        trailing={
          unread === 0 ? undefined : (
            <Badge className="rounded-full px-2">
              <BadgeText className="tracking-normal normal-case">{String(unread)}</BadgeText>
            </Badge>
          )
        }
        onBack={() => router.back()}
      />
      <Divider className="bg-hairline" />

      {events.length === 0 ? (
        <Empty
          glyph={BellRing}
          title="Nothing has happened yet"
          body="When somebody shares a PDF with you, answers one of yours, or adds you to a group, it shows up here — whether or not a notification reached your phone."
        />
      ) : (
        <FlashList
          style={FILL}
          data={events}
          keyExtractor={(event) => event.id}
          contentContainerStyle={CONTENT}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <EventRow
              event={item}
              onPress={() =>
                item.shareId === null
                  ? item.groupId === null
                    ? undefined
                    : router.push({ pathname: '/group', params: { id: item.groupId } })
                  : router.push({ pathname: '/share-detail', params: { id: item.shareId } })
              }
            />
          )}
          ListFooterComponent={
            <Notice glyph={Lock}>
              A row here never says which document. The title comes from a query that checks you can
              still read it — a feed that cached titles would go on showing them after access was
              removed.
            </Notice>
          }
        />
      )}
    </Screen>
  );
}

/**
 * One thing that happened.
 *
 * Unread carries a dot rather than a filled background. A washed row in a list
 * of twenty washed rows stops meaning anything by the third one, and this list
 * is usually mostly unread.
 */
function EventRow({ event, onPress }: { event: LibraryShareEvent; onPress: () => void }) {
  const who = event.actorName ?? 'Someone';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={sentenceFor(event.kind, who)}
      className="border-b border-hairline data-[active=true]:bg-hover"
    >
      {/* `py-3.5` and a hairline, the same as a search result — this is a list
          of one-line rows and it should read as one. Without the rule the
          glyph notch on one avatar sat a few pixels from the next avatar and
          the feed looked like one paragraph of faces. */}
      <HStack className="items-center px-4 py-2.5" space="md">
        <Box className="relative">
          <Avatar className="h-9 w-9">
            <AvatarFallbackText>{who}</AvatarFallbackText>
            <AvatarImage source={{ uri: event.actorPicture }} recyclingKey={event.id} />
          </Avatar>
          {/* The glyph says what kind of thing it was, in the corner where the
              presence dot goes on a person row — the same place, because it
              answers the same shape of question at a glance. */}
          <Box className="absolute -bottom-1 -right-1 h-[18px] w-[18px] items-center justify-center rounded-full bg-background">
            <Icon as={GLYPHS[event.kind]} size="2xs" className="text-fg-muted" />
          </Box>
        </Box>

        <VStack className="flex-1">
          <Text size="sm" className={event.read ? 'text-fg-muted' : 'text-foreground'}>
            {sentenceFor(event.kind, who)}
          </Text>
          <Text size="2xs" className="mt-1 text-fg-subtle">
            {agoOf(event.createdAt)}
          </Text>
        </VStack>

        {event.read ? null : <Box className="h-1.5 w-1.5 rounded-full bg-primary" />}
      </HStack>
    </Pressable>
  );
}

/**
 * The sentence, built here rather than stored.
 *
 * The same rule the push body follows: the server sends a kind and an actor,
 * and the client owns the words. A string written on the backend is a backend
 * string in a screenshot.
 */
function sentenceFor(kind: LibraryShareEvent['kind'], who: string): string {
  switch (kind) {
    case 'shareOffered':
      return `${who} shared a PDF with you`;
    case 'groupDocumentShared':
      return `${who} shared a PDF with one of your groups`;
    case 'shareAccepted':
      return `${who} accepted a PDF you shared`;
    case 'shareDeclined':
      return `${who} declined a PDF you shared`;
    case 'accessRevoked':
      return `${who} removed your access to a PDF`;
    case 'accessChanged':
      return `${who} changed what you can do with a PDF`;
    case 'groupJoined':
      return `${who} added you to a group`;
    case 'annotationAdded':
      return `${who} wrote a note on a PDF you shared`;
  }
}

const GLYPHS: Record<LibraryShareEvent['kind'], React.ComponentProps<typeof Icon>['as']> = {
  shareOffered: Share2,
  groupDocumentShared: Users,
  shareAccepted: Check,
  shareDeclined: X,
  accessRevoked: Ban,
  accessChanged: ShieldCheck,
  groupJoined: UserPlus,
  annotationAdded: NotebookPen,
};

/**
 * How long ago, in the units somebody would say out loud.
 *
 * No seconds and no exact times: a feed is read at a glance, and "4 hours ago"
 * is what the reader needs in order to decide whether they already knew.
 */
function agoOf(at: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) {
    return 'Just now';
  }
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.round(hours / 24);
  if (days === 1) {
    return 'Yesterday';
  }
  if (days < 7) {
    return `${days} days ago`;
  }
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}

const FILL = { flex: 1 } as const;
const CONTENT = { paddingBottom: 32 } as const;
