import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, MessageSquare, Plus, Search, Send, Share2, WifiOff, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { useQuery } from 'convex/react';

import { api } from '@convex/_generated/api';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { Screen } from '@/components/layout/screen';
import { Box } from '@/components/ui/box';
import { Button, ButtonIcon, ButtonText } from '@/components/ui/button';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Input, InputField } from '@/components/ui/input';
import { KeyboardAvoidingView } from '@/components/ui/keyboard-avoiding-view';
import { Pressable } from '@/components/ui/pressable';
import { ScrollView } from '@/components/ui/scroll-view';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { DocumentCover } from '@/features/library/components/document-cover';
import { useLibraryStatus } from '@/features/library/data/use-library-status';
import { useReaderDocument } from '@/features/reader/use-reader-document';
import { useShareStore, type Recipient } from '@/stores/share-store';

import { GroupRow, PersonRow, initialsOf } from './components/person-row';
import { Empty, ListSkeleton, Notice, ScreenHeader } from './components/segments';
import { SharePermissionSheet, permissionLabel } from './components/share-permission-sheet';
import { useShareActions } from './data/use-share-actions';
import { useGroups } from './data/use-sharing';

/**
 * Sharing a document with people.
 *
 * One continuous surface, no cards: the document is the header's subject, then
 * a field, then whoever has been picked, then results, then what they will be
 * allowed and an optional line to them.
 *
 * **The search is a lookup.** It matches an exact `@handle` or an exact email
 * address, plus display-name prefixes among people already in a group with the
 * reader — and nothing else. A Convex query cannot spend a rate-limiter token,
 * so an index over every account in the deployment would be an enumeration
 * endpoint with nothing to bound it. The empty state says that in words rather
 * than leaving somebody to conclude the app is broken.
 *
 * A screen rather than a sheet, for the reason `navigator-screen.tsx` gives: a
 * sheet is as tall as its content, and this one's content is a list that goes
 * from nothing to twenty rows as somebody types.
 */
export function ShareScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { document } = useReaderDocument(id);
  const { hasNetwork } = useLibraryStatus();
  const showToast = useAppToast();

  const settings = useQuery(api.settings.mine, {});
  const { groups } = useGroups();
  const { share } = useShareActions();

  const begin = useShareStore((state) => state.begin);
  const recipients = useShareStore((state) => state.recipients);
  const permission = useShareStore((state) => state.permission);
  const message = useShareStore((state) => state.message);
  const sending = useShareStore((state) => state.sending);
  const toggle = useShareStore((state) => state.toggle);
  const setMessage = useShareStore((state) => state.setMessage);
  const setSending = useShareStore((state) => state.setSending);
  const clear = useShareStore((state) => state.clear);

  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [choosingPermission, setChoosingPermission] = useState(false);

  // The reader's own default, once the account has answered. Until then the
  // store holds the narrowest thing a share can be, which is the right thing
  // to be holding while waiting.
  useEffect(() => {
    if (id === undefined || settings === undefined) {
      return;
    }
    begin(id, {
      role: settings.sharing.defaultRole,
      canDownload: settings.sharing.defaultCanDownload,
      canReshare: settings.sharing.defaultCanReshare,
    });
  }, [begin, id, settings]);

  // A round trip per keystroke would be a round trip per keystroke. 250ms is
  // long enough that typing a handle is one query and short enough that the
  // list does not feel like it is lagging behind the field.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const people = useQuery(
    api.sharing.findPeople,
    debounced.length === 0 || !hasNetwork ? 'skip' : { term: debounced },
  );

  const matchingGroups = useMemo(() => {
    const needle = debounced.toLowerCase();
    return groups.filter((group) => needle === '' || group.name.toLowerCase().includes(needle));
  }, [debounced, groups]);

  const send = useCallback(async () => {
    if (document === undefined || recipients.length === 0 || sending) {
      return;
    }
    setSending(true);
    const ok = await share(document.id, recipients, permission, message);
    setSending(false);
    if (!ok) {
      return;
    }
    clear();
    showToast({
      id: 'share',
      tone: 'success',
      title: hasNetwork ? 'Shared' : 'Waiting for a connection',
      description: hasNetwork
        ? undefined
        : 'It goes out as soon as there is one. Nobody has been told yet.',
    });
    router.back();
  }, [
    clear,
    document,
    hasNetwork,
    message,
    permission,
    recipients,
    router,
    sending,
    setSending,
    share,
    showToast,
  ]);

  if (document === undefined) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader glyph={Share2} title="Share" onBack={() => router.back()} />
        <Divider className="bg-hairline" />
        <ListSkeleton rows={3} />
      </Screen>
    );
  }

  const searching = debounced.length > 0;
  const nothingFound =
    searching && hasNetwork && people !== undefined && people.length === 0 && matchingGroups.length === 0;

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        glyph={Share2}
        title="Share"
        subtitle={document.title}
        onBack={() => router.back()}
        backLabel="Back to the document"
      />
      <Divider className="bg-hairline" />

      {/* The document, as the header's subject rather than an object on the
          page. The reader arrived here from it and does not need it sold back. */}
      <HStack className="items-center px-6 py-3.5" space="md">
        <DocumentCover documentId={document.id} title={document.title} width={44} />
        <VStack className="flex-1">
          <Text size="sm" numberOfLines={2} className="font-semibold text-foreground">
            {document.title}
          </Text>
          <Text size="xs" className="mt-0.5 text-fg-subtle">
            {document.pageCount === null ? 'PDF' : `${document.pageCount} pages`}
          </Text>
        </VStack>
      </HStack>

      <Box className="mx-6 h-px bg-hairline" />

      <Box className="px-6 pt-3.5">
        <Input className="h-11">
          <Box className="pl-3">
            <Icon as={Search} size="sm" className="text-fg-subtle" />
          </Box>
          <InputField
            value={term}
            onChangeText={setTerm}
            placeholder="Search people or groups"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            className="text-foreground"
          />
        </Input>
      </Box>

      {recipients.length === 0 ? null : (
        <FlashList
          horizontal
          data={recipients}
          keyExtractor={(item) => `${item.kind}:${item.id}`}
          showsHorizontalScrollIndicator={false}
          style={RAIL}
          contentContainerStyle={RAIL_CONTENT}
          renderItem={({ item }) => <ChosenChip recipient={item} onRemove={() => toggle(item)} />}
        />
      )}

      <Box className="flex-1">
        {nothingFound ? (
          <Empty
            glyph={Search}
            title={`No account matching ${debounced}`}
            body="Handles and email addresses have to match exactly. Pidom does not list accounts you have no connection to, so there is nothing to browse here."
          />
        ) : (
          <Results
            people={people}
            groups={matchingGroups}
            searching={searching}
            offline={!hasNetwork}
            onToggle={toggle}
            chosen={recipients}
          />
        )}
      </Box>

      <Divider className="bg-hairline" />

      {/* The permission row, the message and the Share button move with the
          keyboard. Without this the keyboard covers the button the reader is
          typing a message in order to press. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}>
      <Pressable
        onPress={() => setChoosingPermission(true)}
        accessibilityRole="button"
        accessibilityLabel="What they can do"
        className="data-[active=true]:bg-hover">
        <HStack className="items-center px-6 py-3" space="md">
          <Icon as={Check} size="lg" className="text-fg-muted" />
          <VStack className="flex-1">
            <Text size="md" className="text-foreground">
              {permissionLabel(permission)}
            </Text>
            <Text size="xs" className="mt-0.5 text-fg-subtle">
              {permission.canDownload ? 'Downloading allowed' : 'No downloading, no resharing'}
            </Text>
          </VStack>
        </HStack>
      </Pressable>

      <HStack className="items-center px-6 pb-2" space="md">
        <Icon as={MessageSquare} size="lg" className="text-fg-muted" />
        <Input className="h-11 flex-1">
          <InputField
            value={message}
            onChangeText={setMessage}
            placeholder="Say something (optional)"
            className="text-foreground"
          />
        </Input>
      </HStack>

      {hasNetwork ? null : (
        <Notice glyph={WifiOff}>
          No connection. This share is queued and goes out the moment there is one — the people
          you pick are not told anything until it does.
        </Notice>
      )}

      <Box className="px-6 pt-2 pb-3">
        <Button
          size="lg"
          onPress={() => void send()}
          isDisabled={recipients.length === 0 || sending}
          className="h-12">
          {sending ? (
            <Spinner />
          ) : (
            <>
              <ButtonIcon as={Send} />
              <ButtonText>
                {recipients.length === 0 ? 'Share' : `Share with ${recipients.length}`}
              </ButtonText>
            </>
          )}
        </Button>
      </Box>

      </KeyboardAvoidingView>

      <SharePermissionSheet
        isOpen={choosingPermission}
        onClose={() => setChoosingPermission(false)}
        documentTitle={document.title}
      />
    </Screen>
  );
}

type Person = { id: string; displayName: string; handle: string | null; pictureUrl: string | null };

function Results({
  people,
  groups,
  searching,
  offline,
  chosen,
  onToggle,
}: {
  people: Person[] | undefined;
  groups: { id: string; name: string; memberCount: number }[];
  searching: boolean;
  offline: boolean;
  chosen: Recipient[];
  onToggle: (recipient: Recipient) => void;
}) {
  const isChosen = useCallback(
    (kind: Recipient['kind'], id: string) =>
      chosen.some((one) => one.kind === kind && one.id === id),
    [chosen],
  );

  if (offline && searching) {
    return (
      <Empty
        glyph={WifiOff}
        title="Finding people needs a connection"
        body="Your groups are here, and a share you set up now goes out when there is one."
      />
    );
  }

  if (searching && people === undefined && groups.length === 0) {
    return <ListSkeleton rows={3} />;
  }

  return (
    /**
     * Scrollable, which it was not.
     *
     * The results rendered as two `.map()`s inside a plain `VStack`, so a
     * search that matched more people than fit simply clipped — there was
     * nothing to scroll. A `ScrollView` rather than a `FlashList`, because
     * `DISCOVERY_LIMIT` bounds this at twenty rows and a virtualiser inside a
     * flex column that also holds a chip rail and a footer is more machinery
     * than twenty rows are worth.
     */
    <ScrollView contentContainerStyle={RESULTS} keyboardShouldPersistTaps="handled">
      {people === undefined || people.length === 0 ? null : (
        <>
          <Text size="xs" className="px-6 pt-3 pb-1 uppercase tracking-wider text-fg-subtle">
            People
          </Text>
          {people.map((person) => {
            const on = isChosen('person', person.id);
            return (
              <PersonRow
                key={person.id}
                name={person.displayName}
                detail={person.handle === null ? null : `@${person.handle}`}
                pictureUrl={person.pictureUrl}
                trailing={
                  <Icon
                    as={on ? Check : Plus}
                    size="sm"
                    className={on ? 'text-primary' : 'text-fg-subtle'}
                  />
                }
                onPress={() =>
                  onToggle({
                    kind: 'person',
                    id: person.id,
                    name: person.displayName,
                    handle: person.handle,
                    pictureUrl: person.pictureUrl,
                  })
                }
              />
            );
          })}
        </>
      )}

      {groups.length === 0 ? null : (
        <>
          <Text size="xs" className="px-6 pt-3 pb-1 uppercase tracking-wider text-fg-subtle">
            Groups
          </Text>
          {groups.map((group) => {
            const on = isChosen('group', group.id);
            return (
              <GroupRow
                key={group.id}
                name={group.name}
                detail={`${group.memberCount} ${group.memberCount === 1 ? 'member' : 'members'}`}
                initials={initialsOf(group.name)}
                trailing={
                  <Icon
                    as={on ? Check : Plus}
                    size="sm"
                    className={on ? 'text-primary' : 'text-fg-subtle'}
                  />
                }
                onPress={() =>
                  onToggle({
                    kind: 'group',
                    id: group.id,
                    name: group.name,
                    memberCount: group.memberCount,
                  })
                }
              />
            );
          })}
          <Notice glyph={Check}>
            Everybody in a group can open it straight away — being in the group is the agreement,
            so there is nothing for them to accept.
          </Notice>
        </>
      )}

      {searching || groups.length > 0 || (people?.length ?? 0) > 0 ? null : (
        <Empty
          glyph={Search}
          title="Who is this for?"
          body="Search an exact @handle or email address, or pick one of your groups."
        />
      )}
    </ScrollView>
  );
}

/** One picked recipient, in the rail above the results. */
function ChosenChip({
  recipient,
  onRemove,
}: {
  recipient: Recipient;
  onRemove: () => void;
}) {
  const label = recipient.name.split(' ')[0];
  return (
    <Pressable
      onPress={onRemove}
      accessibilityRole="button"
      accessibilityLabel={`Remove ${recipient.name}`}
      className="w-[60px] items-center rounded-md py-1 data-[active=true]:bg-hover">
      <Box className="relative">
        <Box
          className={
            recipient.kind === 'group'
              ? 'h-11 w-11 items-center justify-center rounded-md bg-surface'
              : 'h-11 w-11 items-center justify-center rounded-full bg-primary-tint'
          }>
          <Text size="xs" className="font-semibold text-primary">
            {initialsOf(recipient.name)}
          </Text>
        </Box>
        <Box className="absolute -right-1 -top-1 h-[18px] w-[18px] items-center justify-center rounded-full bg-hover ring-2 ring-background">
          <Icon as={X} size="2xs" className="text-fg-muted" />
        </Box>
      </Box>
      <Text size="2xs" numberOfLines={1} className="mt-1.5 text-center text-fg-subtle">
        {label}
      </Text>
    </Pressable>
  );
}

const RESULTS = { paddingBottom: 8 } as const;
const RAIL = { flexGrow: 0 } as const;
const RAIL_CONTENT = { paddingHorizontal: 24, paddingTop: 12, gap: 10 } as const;
