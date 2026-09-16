import { useRouter } from 'expo-router';
import { AtSign, Check, ShieldCheck, Users } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { api } from '@convex/_generated/api';
import { useLibraryStatus } from '@/features/library/data/use-library-status';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { ChoiceSheet } from '@/components/layout/choice-sheet';
import { Screen } from '@/components/layout/screen';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { ScrollView } from '@/components/ui/scroll-view';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { NameDialog } from '@/features/library/components/name-dialog';
import { HANDLE_MAX } from '@convex/model/limits';
import { messageOf } from '@/features/library/data/errors';

import { ListSkeleton, Notice, ScreenHeader, Section } from './components/segments';
import { EXPIRY_CHOICES, expiryLabel } from './components/share-permission-sheet';

/**
 * Who can reach this account, and what a share of theirs starts as.
 *
 * Nothing on this screen is a security control by itself. Every value here is
 * read again by the function it governs, at the moment it governs it — hiding a
 * download button is a convenience and `requireDownloadable` is the rule. What
 * the screen does is let somebody set the defaults they want to be asked from.
 *
 * The two switches under **What I share out** are off, and stay off unless
 * turned on per share. They are the two permissions that survive being taken
 * away: everything else stops the moment a row changes, and a downloaded PDF is
 * a file on a disk this application cannot reach.
 */
export function SharingPrivacyScreen() {
  const router = useRouter();
  // `ready` is not optional — `settings.mine` starts with `requireUser`, which
  // throws `NO_PROFILE` before the row exists, and `useQuery` re-throws a query
  // error during render. See `use-library-status.ts`.
  const { ready } = useLibraryStatus();
  const settings = useQuery(api.settings.mine, ready ? {} : 'skip');
  const update = useMutation(api.settings.updateSharing);
  const setHandle = useMutation(api.settings.setHandle);
  const showToast = useAppToast();

  const [claiming, setClaiming] = useState(false);
  const [choosingExpiry, setChoosingExpiry] = useState(false);

  const claim = useCallback(
    async (handle: string): Promise<boolean> => {
      try {
        await setHandle({ handle });
        setClaiming(false);
        return true;
      } catch (error) {
        showToast({
          id: 'handle',
          tone: 'error',
          title: 'That handle could not be taken',
          description: messageOf(error, 'Try another one.'),
        });
        return false;
      }
    },
    [setHandle, showToast],
  );

  if (settings === undefined) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader glyph={ShieldCheck} title="Sharing & privacy" onBack={() => router.back()} />
        <Divider className="bg-hairline" />
        <ListSkeleton rows={5} />
      </Screen>
    );
  }

  const { sharing, handle } = settings;

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        glyph={ShieldCheck}
        title="Sharing & privacy"
        subtitle="Who can reach you, and what they get"
        onBack={() => router.back()}
      />
      <Divider className="bg-hairline" />

      <ScrollView contentContainerStyle={CONTENT}>
        <Section title="Being found">
          <Pressable
            onPress={() => setClaiming(true)}
            accessibilityRole="button"
            accessibilityLabel="Your handle"
            className="px-4 py-2 data-[active=true]:bg-hover"
          >
            <HStack className="items-center" space="md">
              <Icon as={AtSign} size="lg" className="text-fg-muted" />
              <VStack className="flex-1">
                <Text size="md" className="text-foreground">
                  Your handle
                </Text>
                <Text size="xs" className="mt-0.5 text-fg-subtle">
                  {handle === null
                    ? 'Not set. Without one, people can only find you by your email address.'
                    : 'How people find you without knowing your email address.'}
                </Text>
              </VStack>
              <Text size="sm" className="text-fg-subtle">
                {handle === null ? 'Set' : `@${handle}`}
              </Text>
            </HStack>
          </Pressable>

          <Choice
            label="Who can find me"
            note="By an exact @handle or email address. Pidom never lists accounts."
            value={sharing.findableBy}
            onChange={(findableBy) => void update({ findableBy })}
          />
          <Choice
            label="Who can share with me"
            value={sharing.shareableBy}
            onChange={(shareableBy) => void update({ shareableBy })}
          />
          <Toggle
            label="Show when I am online"
            note="A dot beside your name, to people who already share a document or a group with you."
            value={sharing.showOnlineStatus}
            onChange={(showOnlineStatus) => void update({ showOnlineStatus })}
          />
          <Toggle
            label="Show which page I am on"
            note="Off. Nobody sees where you are in a document."
            value={sharing.showReadingActivity}
            onChange={(showReadingActivity) => void update({ showReadingActivity })}
          />
        </Section>

        <Divider className="mt-2 bg-hairline" />

        <Section title="What I share out">
          <Toggle
            label="Let people annotate by default"
            note="What a new share starts as, before you change it."
            value={sharing.defaultRole === 'annotator'}
            onChange={(on) => void update({ defaultRole: on ? 'annotator' : 'viewer' })}
          />
          <Toggle
            label="Let people download by default"
            note="Off. A downloaded copy cannot be taken back later."
            value={sharing.defaultCanDownload}
            onChange={(defaultCanDownload) => void update({ defaultCanDownload })}
          />
          <Toggle
            label="Let people share mine on"
            note="Off. When on, they can never grant more than they have themselves."
            value={sharing.defaultCanReshare}
            onChange={(defaultCanReshare) => void update({ defaultCanReshare })}
          />
          <Pressable
            onPress={() => setChoosingExpiry(true)}
            accessibilityRole="button"
            accessibilityLabel="How long a new share lasts"
            className="px-4 py-2 data-[active=true]:bg-hover"
          >
            <HStack className="items-center" space="md">
              <VStack className="flex-1">
                <Text size="md" className="text-foreground">
                  How long a new share lasts
                </Text>
                <Text size="xs" className="mt-0.5 text-fg-subtle">
                  What the picker starts on. You can change it on every share.
                </Text>
              </VStack>
              <Text size="md" className="text-fg-muted">
                {sharing.defaultExpiryDays == null
                  ? 'No end'
                  : expiryLabel(sharing.defaultExpiryDays)}
              </Text>
            </HStack>
          </Pressable>
          <Toggle
            label="Every share must have an end"
            note="A rule, not a default: with this on, a share with no end date is refused."
            value={sharing.requireExpiry === true}
            onChange={(requireExpiry) => void update({ requireExpiry })}
          />
        </Section>

        <Divider className="mt-2 bg-hairline" />

        {/* Ceilings rather than defaults, and the difference is the whole
            reason they are a separate section. The three above decide what a
            *new* share starts as; these two decide what any share of this
            reader's documents may ever be — including ones made months ago,
            and including a reshare somebody else made. */}
        <Section title="Never, whatever a share says">
          <Toggle
            label="Allow downloads at all"
            note="Off takes downloading away from every share of your documents, now and in the past. A copy already on somebody's device is still theirs."
            value={sharing.allowDownloads !== false}
            onChange={(allowDownloads) => void update({ allowDownloads })}
          />
          <Toggle
            label="Allow resharing at all"
            note="Off means nobody can pass your documents on, whatever permission they were given."
            value={sharing.allowReshares !== false}
            onChange={(allowReshares) => void update({ allowReshares })}
          />
          <Toggle
            label="Allow asking a model about them"
            note="Off means nobody you shared a document with can send its pages to a model. Your own Ask is unaffected; it is on Search & Ask."
            value={sharing.allowAiOnSharedDocuments === true}
            onChange={(allowAiOnSharedDocuments) => void update({ allowAiOnSharedDocuments })}
          />
          <Notice glyph={ShieldCheck}>
            These are checked every time somebody opens or downloads, not only when a share is made
            — so turning one off narrows access that already exists.
          </Notice>
        </Section>

        <Divider className="mt-2 bg-hairline" />

        <Section title="Groups">
          <Toggle
            label="Allow group invitations"
            note="Whether other people can add you to a group of theirs."
            value={sharing.allowGroupInvites}
            onChange={(allowGroupInvites) => void update({ allowGroupInvites })}
          />
          <Notice glyph={Users}>
            A document shared with a group is open to its members straight away — being in the group
            is the agreement. Leaving one takes those documents with it.
          </Notice>
        </Section>
      </ScrollView>

      <ChoiceSheet
        isOpen={choosingExpiry}
        onClose={() => setChoosingExpiry(false)}
        title="How long a new share lasts"
        subtitle="What the picker on a new share starts on"
        choices={EXPIRY_CHOICES.map((days) => ({
          value: String(days),
          label: days === null ? 'No end' : expiryLabel(days),
          note: days === null ? 'They keep it until you take it away.' : undefined,
          selected: (sharing.defaultExpiryDays ?? null) === days,
        }))}
        onSelect={(value) => {
          setChoosingExpiry(false);
          void update({ defaultExpiryDays: value === 'null' ? null : Number(value) });
        }}
      />

      <NameDialog
        isOpen={claiming}
        onClose={() => setClaiming(false)}
        onSubmit={claim}
        title="Your handle"
        label="Handle"
        placeholder="amina"
        initialValue={handle ?? ''}
        maxLength={HANDLE_MAX}
      />
    </Screen>
  );
}

function Toggle({
  label,
  note,
  value,
  onChange,
}: {
  label: string;
  note?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <HStack className="items-center px-4 py-2" space="lg">
      <VStack className="flex-1">
        <Text size="md" className="text-foreground">
          {label}
        </Text>
        {note === undefined ? null : (
          <Text size="xs" className="mt-0.5 text-fg-subtle">
            {note}
          </Text>
        )}
      </VStack>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </HStack>
  );
}

/**
 * Three values, expanded in place.
 *
 * A `Select` would be a fourth kind of surface for a choice between three
 * words. The rows are the same radio shape `theme-control.tsx` uses — three
 * rows, one check mark, no segmented control.
 */
function Choice({
  label,
  note,
  value,
  onChange,
}: {
  label: string;
  note?: string;
  value: 'anyone' | 'groups' | 'nobody';
  onChange: (value: 'anyone' | 'groups' | 'nobody') => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <VStack>
      <Pressable
        onPress={() => setOpen((was) => !was)}
        accessibilityRole="button"
        accessibilityLabel={label}
        className="px-4 py-2 data-[active=true]:bg-hover"
      >
        <HStack className="items-center" space="md">
          <VStack className="flex-1">
            <Text size="md" className="text-foreground">
              {label}
            </Text>
            {note === undefined ? null : (
              <Text size="xs" className="mt-0.5 text-fg-subtle">
                {note}
              </Text>
            )}
          </VStack>
          <Text size="sm" className="text-fg-subtle">
            {LABELS[value]}
          </Text>
        </HStack>
      </Pressable>

      {open
        ? (['anyone', 'groups', 'nobody'] as const).map((option) => (
            <Pressable
              key={option}
              onPress={() => {
                onChange(option);
                setOpen(false);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: option === value }}
              className="pl-12 pr-6 py-2.5 data-[active=true]:bg-hover"
            >
              <HStack className="items-center" space="md">
                <Text
                  size="sm"
                  className={option === value ? 'flex-1 text-primary' : 'flex-1 text-fg-muted'}
                >
                  {LABELS[option]}
                </Text>
                {option === value ? <Icon as={Check} size="sm" className="text-primary" /> : null}
              </HStack>
            </Pressable>
          ))
        : null}
    </VStack>
  );
}

const LABELS = {
  anyone: 'Anyone',
  groups: 'People in my groups',
  nobody: 'Nobody',
} as const;

const CONTENT = { paddingBottom: 40 } as const;
