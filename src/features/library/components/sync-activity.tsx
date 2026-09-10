import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  BookOpen,
  CloudCheck,
  CloudDownload,
  CloudOff,
  CloudUpload,
  FilePlus2,
  FolderTree,
  Heart,
  NotebookPen,
  Pencil,
  RefreshCw,
  Share2,
  Trash2,
  TriangleAlert,
  Users,
  WifiOff,
} from 'lucide-react-native';
import React from 'react';

import { Screen } from '@/components/layout/screen';
import { Button, ButtonText } from '@/components/ui/button';
import { Center } from '@/components/ui/center';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Progress, ProgressFilledTrack } from '@/components/ui/progress';
import { ScrollView } from '@/components/ui/scroll-view';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

import { formatBytes } from '../data/types';
import { useLibraryStatus } from '../data/use-library-status';
import { useSyncActivity, type ActivityItem, type ActivityKind } from '../data/use-sync-activity';

/**
 * What is waiting to reach the account, and anything that will not go.
 *
 * **This screen exists because of the dead letters.** Everything else on it is
 * a courtesy — a reader whose changes are all going through has no reason to
 * come here, and nothing anywhere nags them to. But an operation that stopped
 * trying is the reader's own work sitting on one device and not in their
 * account, and a queue that quietly gave up on it without saying so would be
 * worse than one that failed loudly. This is where it says so, with the two
 * things a person can actually do about it.
 *
 * Nothing here is a progress bar over the whole queue. A count and a list are
 * true; a bar implies a rate, and a queue drains at whatever speed a connection
 * allows.
 */
export function SyncActivityScreen() {
  const router = useRouter();
  const { offline, offlineIdentity, hasNetwork } = useLibraryStatus();
  const { phase, waiting, failed, moving, lastSyncedAt, syncNow, retry, discard } =
    useSyncActivity();

  const quiet = waiting.length === 0 && failed.length === 0 && moving.length === 0;

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
          Sync
        </Text>
      </HStack>

      <ScrollView className="flex-1" contentContainerClassName="grow pb-8">
        <Status
          phase={phase}
          offline={offline}
          offlineIdentity={offlineIdentity}
          hasNetwork={hasNetwork}
          waiting={waiting.length}
          failed={failed.length}
        />

        {failed.length > 0 ? (
          <>
            <SectionLabel>Would not go through</SectionLabel>
            {failed.map((item) => (
              <DeadLetter
                key={item.opId}
                item={item}
                onRetry={() => void retry(item.opId)}
                onDiscard={() => void discard(item.opId)}
              />
            ))}
            <Text size="xs" className="px-4 pt-4 text-fg-subtle">
              Discarding drops the change from this queue. It does not undo anything in your
              library — it stays on this phone, and simply never reaches your other devices.
            </Text>
          </>
        ) : null}

        {moving.length > 0 ? (
          <>
            <SectionLabel>Moving now</SectionLabel>
            {moving.map((row) => (
              <Moving key={row.documentId} title={row.title} transfer={row.transfer} />
            ))}
          </>
        ) : null}

        {waiting.length > 0 ? (
          <>
            <SectionLabel>Waiting</SectionLabel>
            {waiting.map((item) => (
              <Row key={item.opId} item={item} />
            ))}
          </>
        ) : null}

        {/* `flex-1` inside a `grow` content container, so an empty queue puts
            this in the middle of what is left rather than jammed under the
            status line with the rest of the screen blank beneath it. */}
        {quiet ? (
          <Center className="flex-1 px-10 py-12">
            <Icon as={CloudCheck} size="xl" className="h-9 w-9 text-fg-subtle" />
            <Text size="sm" className="mt-4 max-w-[286px] text-center text-muted-foreground">
              Nothing is waiting. Everything you have changed on this device is in your account.
            </Text>
          </Center>
        ) : null}
      </ScrollView>

      {/* Outside the ScrollView on purpose. It used to scroll with the list,
          which put the one control on the screen directly under the last row —
          near the top when the queue was empty, and off the bottom when it was
          long. A control whose position depends on how much work is queued is
          a control nobody can build a habit around. */}
      <VStack className="border-t border-hairline px-4 pb-2 pt-4" space="md">
        <HStack className="items-center" space="sm">
          <Icon as={RefreshCw} size="xs" className="text-fg-subtle" />
          <Text size="xs" className="flex-1 text-fg-subtle">
            {lastSyncedAt === null
              ? 'This device has not finished a sync yet.'
              : `Last synced ${relativeTime(lastSyncedAt)}`}
          </Text>
        </HStack>

        <Button
          variant="outline"
          size="lg"
          onPress={() => void syncNow()}
          isDisabled={offline}
          className="h-11">
          <ButtonText>{offline ? 'Waiting for a connection' : 'Sync now'}</ButtonText>
        </Button>
      </VStack>
    </Screen>
  );
}

/**
 * The one sentence at the top.
 *
 * It leads with what is safe, because that is the fact a reader wants first:
 * whatever is in this queue is already on their phone, and the only thing
 * behind is their account.
 */
function Status({
  phase,
  offline,
  offlineIdentity,
  hasNetwork,
  waiting,
  failed,
}: {
  phase: string;
  offline: boolean;
  offlineIdentity: boolean;
  hasNetwork: boolean;
  waiting: number;
  failed: number;
}) {
  const glyph =
    failed > 0
      ? TriangleAlert
      : offlineIdentity || !hasNetwork
        ? WifiOff
        : offline
          ? CloudOff
          : CloudUpload;

  const headline =
    failed > 0
      ? failed === 1
        ? 'One change would not go'
        : `${failed} changes would not go`
      : offline
        ? waiting === 0
          ? 'Nothing waiting'
          : waiting === 1
            ? 'One change waiting'
            : `${waiting} changes waiting`
        : waiting === 0
          ? 'Everything is synced'
          : phase === 'syncing'
            ? waiting === 1
              ? 'Sending one change'
              : `Sending ${waiting} changes`
            : waiting === 1
              ? 'One change waiting'
              : `${waiting} changes waiting`;

  const body =
    failed > 0
      ? 'It is still here and still yours. Your account is the only thing that has not been told.'
      : offlineIdentity
        ? 'This device has not been able to reach Google since it launched, so nothing can be sent yet. Everything below is already saved here.'
        : offline
          ? hasNetwork
            ? 'Pidom is not answering. Everything below is already saved on this device.'
            : 'There is no connection. Everything below is already saved on this device.'
          : 'Everything below is already saved on this device. This is only your account catching up.';

  return (
    <HStack className="items-start px-4 pt-2 pb-4" space="md">
      <Icon
        as={glyph}
        size="lg"
        className={failed > 0 ? 'mt-0.5 text-fg-muted' : 'mt-0.5 text-primary'}
      />
      <VStack className="flex-1" space="xs">
        <Text size="md" className="text-foreground">
          {headline}
        </Text>
        <Text size="xs" className="text-fg-subtle">
          {body}
        </Text>
      </VStack>
    </HStack>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text size="2xs" className="px-4 pt-2.5 pb-1 uppercase tracking-wider text-fg-subtle">
      {children}
    </Text>
  );
}

const GLYPHS: Record<ActivityKind, React.ComponentProps<typeof Icon>['as']> = {
  position: BookOpen,
  favourite: Heart,
  title: Pencil,
  processing: RefreshCw,
  import: FilePlus2,
  delete: Trash2,
  bookmark: BookOpen,
  note: NotebookPen,
  collection: FolderTree,
  filing: FolderTree,
  share: Share2,
  group: Users,
};

function Row({ item }: { item: ActivityItem }) {
  return (
    <HStack className="items-start border-b border-hairline px-4 py-2.5" space="md">
      <Icon as={GLYPHS[item.kind]} size="sm" className="mt-0.5 text-fg-muted" />
      <VStack className="flex-1" space="xs">
        <Text size="sm" numberOfLines={2} className="font-semibold text-foreground">
          {item.title}
        </Text>
        <Text size="xs" className="text-fg-subtle">
          {item.detail}
        </Text>
      </VStack>
    </HStack>
  );
}

function DeadLetter({
  item,
  onRetry,
  onDiscard,
}: {
  item: ActivityItem;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  return (
    <VStack className="border-b border-hairline px-4 py-2.5">
      <HStack className="items-start" space="md">
        <Icon as={GLYPHS[item.kind]} size="sm" className="mt-0.5 text-destructive" />
        <VStack className="flex-1" space="xs">
          <Text size="sm" numberOfLines={2} className="font-semibold text-foreground">
            {item.title}
          </Text>
          <Text size="xs" className="text-fg-subtle">
            {item.reason ?? item.detail}
          </Text>
        </VStack>
      </HStack>

      <VStack className="ml-7 mt-3" space="sm">
        <Button variant="outline" size="sm" onPress={onRetry} className="h-8">
          <ButtonText>Try again</ButtonText>
        </Button>
        <Button variant="ghost" size="sm" onPress={onDiscard} className="h-8">
          <ButtonText className="text-fg-muted">Discard</ButtonText>
        </Button>
      </VStack>
    </VStack>
  );
}

function Moving({
  title,
  transfer,
}: {
  title: string;
  transfer: { kind: 'upload' | 'download'; sent: number; total: number };
}) {
  const percent = transfer.total > 0 ? Math.round((transfer.sent / transfer.total) * 100) : 0;

  return (
    <HStack className="items-start border-b border-hairline px-4 py-2.5" space="md">
      <Icon
        as={transfer.kind === 'upload' ? CloudUpload : CloudDownload}
        size="sm"
        className="mt-0.5 text-fg-muted"
      />
      <VStack className="flex-1" space="xs">
        <Text size="sm" numberOfLines={2} className="font-semibold text-foreground">
          {title}
        </Text>
        <Text size="xs" className="text-fg-subtle">
          {transfer.total > 0
            ? `${formatBytes(transfer.sent)} of ${formatBytes(transfer.total)}`
            : 'Starting…'}
        </Text>
        {/* The same 2px hairline the tile uses, and it means the same thing:
            the transfer, never the reading position. */}
        <Progress value={percent} className="mt-1 h-0.5 bg-border">
          <ProgressFilledTrack className="bg-primary" />
        </Progress>
      </VStack>
    </HStack>
  );
}

/**
 * Coarse on purpose, as everywhere else this app says how long ago.
 *
 * "3 minutes ago" implies a precision this does not have — a sync finishes
 * whenever the queue drains and the account answers, which is not on any
 * schedule.
 */
function relativeTime(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 2) {
    return 'a moment ago';
  }
  if (minutes < 60) {
    return `${minutes} minutes ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
