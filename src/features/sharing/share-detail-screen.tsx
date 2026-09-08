import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Ban,
  BookOpen,
  Check,
  Clock,
  CloudDownload,
  Download,
  Eye,
  NotebookPen,
  Quote,
  Share2,
  X,
} from 'lucide-react-native';
import React, { useCallback, useState } from 'react';

import { Screen } from '@/components/layout/screen';
import { Box } from '@/components/ui/box';
import { Button, ButtonIcon, ButtonText } from '@/components/ui/button';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { database } from '@/features/library/local/db';
import * as Documents from '@/features/library/local/repository/documents';
import { useLibraryStatus } from '@/features/library/data/use-library-status';
import type { LibraryShare } from '@/features/library/local/repository/types';

import { PersonRow } from './components/person-row';
import { Notice, ScreenHeader } from './components/segments';
import { useShareActions } from './data/use-share-actions';
import { useShareDownload } from './data/use-share-download';
import { useShare } from './data/use-sharing';

/**
 * One document somebody shared, from the recipient's side.
 *
 * It says what is allowed **before** anything is tapped. A recipient who finds
 * out there is no download button by looking for it has been told the rule by
 * its absence, which is the worst way to be told anything — so the three
 * permissions are a list with ticks and crosses, above the buttons rather than
 * behind them.
 *
 * The revoked state is the one this screen exists for. It says who removed the
 * access and when, it still offers the copy already on this phone, and it says
 * in plain words that removing access could not reach that copy. That is an
 * awkward thing to admit on a screen and it is true, so it is on the screen.
 */
export function ShareDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { profileId } = useLibraryStatus();
  const { share, loading } = useShare(id ?? null);
  const { answer } = useShareActions();
  const { download } = useShareDownload();

  const [busy, setBusy] = useState(false);
  const [localId, setLocalId] = useState<string | null>(null);

  // Whether this device already holds the file. The filesystem is the authority
  // on that, here as everywhere else — no field on the share row claims it.
  React.useEffect(() => {
    let live = true;
    void (async () => {
      if (profileId === null || share?.documentId == null) {
        return;
      }
      const db = await database(profileId);
      if (db === null) {
        return;
      }
      const found = await Documents.localIdForRemote(db, share.documentId);
      if (!live) {
        return;
      }
      const document = found === null ? null : await Documents.documentById(db, found);
      if (live) {
        setLocalId(document?.fileState === 'available' ? document.id : null);
      }
    })();
    return () => {
      live = false;
    };
  }, [profileId, share?.documentId, share?.updatedAt]);

  const accept = useCallback(async () => {
    if (share === null) {
      return;
    }
    setBusy(true);
    await answer(share.id, 'accept');
    setBusy(false);
  }, [answer, share]);

  const decline = useCallback(async () => {
    if (share === null) {
      return;
    }
    setBusy(true);
    await answer(share.id, 'decline');
    setBusy(false);
    router.back();
  }, [answer, router, share]);

  const fetchIt = useCallback(async () => {
    if (share === null) {
      return;
    }
    setBusy(true);
    const ok = await download(share);
    setBusy(false);
    if (ok) {
      router.back();
    }
  }, [download, router, share]);

  if (loading || share === null) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader glyph={Share2} title="Shared with you" onBack={() => router.back()} />
        <Divider className="bg-hairline" />
        <Box className="flex-1 items-center justify-center">
          {loading ? <Spinner /> : <Text size="sm" className="text-fg-subtle">That share is gone.</Text>}
        </Box>
      </Screen>
    );
  }

  const gone = share.status === 'revoked' || share.status === 'expired';
  const who = share.counterpartName ?? 'Someone';

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        glyph={gone ? Ban : Share2}
        title={
          share.status === 'revoked'
            ? 'Access removed'
            : share.status === 'expired'
              ? 'Share expired'
              : 'Shared with you'
        }
        subtitle={share.groupName === null ? `From ${who}` : `Through ${share.groupName}`}
        onBack={() => router.back()}
      />
      <Divider className="bg-hairline" />

      <VStack className="flex-1">
        <Box className="items-center px-6 pt-6 pb-4">
          <Box className="h-[164px] w-[116px] items-center justify-center rounded-md bg-surface">
            <Text size="xs" className="font-semibold tracking-wider text-fg-subtle">
              PDF
            </Text>
          </Box>
        </Box>

        <VStack className="items-center px-6">
          <Text
            size="lg"
            numberOfLines={3}
            className={`text-center font-semibold ${gone ? 'text-fg-muted' : 'text-foreground'}`}>
            {share.title ?? 'A shared document'}
          </Text>
          <Text size="xs" className="mt-1.5 text-fg-subtle">
            {share.pageCount === null ? 'PDF' : `${share.pageCount} pages`} ·{' '}
            {formatBytes(share.byteSize)}
          </Text>
        </VStack>

        <Box className="mx-6 mt-5 h-px bg-hairline" />
        <PersonRow
          name={who}
          detail={share.counterpartHandle === null ? null : `@${share.counterpartHandle}`}
          pictureUrl={share.counterpartPictureUrl}
        />
        <Box className="mx-6 h-px bg-hairline" />

        <VStack className="pt-2">
          <Allowed glyph={Eye} label="Read it" on={!gone} />
          <Allowed glyph={NotebookPen} label="Keep passages and notes" on={!gone && share.role === 'annotator'} />
          <Allowed glyph={Download} label="Download a copy" on={!gone && share.canDownload} />
        </VStack>

        <State share={share} onDevice={localId !== null} />

        <Box className="flex-1" />

        <Actions
          share={share}
          busy={busy}
          onDevice={localId !== null}
          onAccept={() => void accept()}
          onDecline={() => void decline()}
          onDownload={() => void fetchIt()}
          onOpen={() =>
            localId === null
              ? undefined
              : router.push({ pathname: '/reader', params: { id: localId } })
          }
        />
      </VStack>
    </Screen>
  );
}

function Allowed({
  glyph,
  label,
  on,
}: {
  glyph: React.ComponentProps<typeof Icon>['as'];
  label: string;
  on: boolean;
}) {
  return (
    <HStack className="items-center px-6 py-2.5" space="lg">
      <Icon as={glyph} size="md" className={on ? 'text-fg-muted' : 'text-fg-disabled'} />
      <Text size="sm" className={`flex-1 ${on ? 'text-foreground' : 'text-fg-disabled'}`}>
        {label}
      </Text>
      <Icon as={on ? Check : X} size="sm" className={on ? 'text-ok' : 'text-fg-disabled'} />
    </HStack>
  );
}

/** The sentence that explains this particular state. The revoked one is the important one. */
function State({ share, onDevice }: { share: LibraryShare; onDevice: boolean }) {
  if (share.status === 'revoked') {
    return (
      <Notice glyph={Ban}>
        {share.counterpartName ?? 'They'} removed your access
        {share.revokedAt === null ? '' : ` on ${formatDate(share.revokedAt)}`}.
        {onDevice
          ? ' You can still open the copy already on this phone — a file that has been downloaded cannot be recalled, and saying otherwise would be untrue. It will not sync again, and it will not come back if you delete it.'
          : ' Nothing was downloaded, so there is nothing here to open.'}
      </Notice>
    );
  }
  if (share.status === 'expired') {
    return (
      <Notice glyph={Clock}>
        This share ran out. The document is untouched; only the permission expired.
      </Notice>
    );
  }
  if (share.status === 'pending') {
    return share.message === null ? (
      <Notice glyph={Clock}>
        Nothing is downloaded until you accept. Until then all Pidom has told you is the title and
        who sent it.
      </Notice>
    ) : (
      <HStack className="items-start px-6 py-3" space="sm">
        <Icon as={Quote} size="xs" className="mt-0.5 text-fg-muted" />
        <Text size="sm" className="flex-1 text-fg-muted">
          {share.message}
        </Text>
      </HStack>
    );
  }
  return (
    <Notice glyph={CloudDownload}>
      {onDevice
        ? 'On this device. It opens with no connection, like everything else in your library.'
        : `${formatBytes(share.byteSize)}. Once it is here it opens with no connection, like everything else in your library.`}
    </Notice>
  );
}

function Actions({
  share,
  busy,
  onDevice,
  onAccept,
  onDecline,
  onDownload,
  onOpen,
}: {
  share: LibraryShare;
  busy: boolean;
  onDevice: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onDownload: () => void;
  onOpen: () => void;
}) {
  if (share.status === 'pending') {
    return (
      <VStack className="px-6 pb-4" space="sm">
        <Button size="lg" onPress={onAccept} isDisabled={busy} className="h-12">
          {busy ? (
            <Spinner />
          ) : (
            <>
              <ButtonIcon as={Check} />
              <ButtonText>Accept</ButtonText>
            </>
          )}
        </Button>
        <Button size="lg" variant="outline" onPress={onDecline} isDisabled={busy} className="h-12">
          <ButtonText>Decline</ButtonText>
        </Button>
      </VStack>
    );
  }

  if (onDevice) {
    return (
      <Box className="px-6 pb-4">
        <Button size="lg" onPress={onOpen} className="h-12">
          <ButtonIcon as={BookOpen} />
          <ButtonText>Open</ButtonText>
        </Button>
      </Box>
    );
  }

  if (share.status === 'accepted' && share.canDownload) {
    return (
      <Box className="px-6 pb-4">
        <Button size="lg" onPress={onDownload} isDisabled={busy} className="h-12">
          {busy ? (
            <Spinner />
          ) : (
            <>
              <ButtonIcon as={Download} />
              <ButtonText>Download for offline</ButtonText>
            </>
          )}
        </Button>
      </Box>
    );
  }

  // Accepted, and downloading was not part of it. There is nothing to offer
  // that would work, so nothing is offered — see the permission list above,
  // which said so before this point was reached.
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}
