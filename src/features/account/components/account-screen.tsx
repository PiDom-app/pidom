import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Bell,
  BellRing,
  ChevronRight,
  Inbox,
  ShieldCheck,
  User,
  Users,
  Wifi,
} from 'lucide-react-native';
import React from 'react';

import { Screen } from '@/components/layout/screen';
import { Avatar, AvatarFallbackText, AvatarImage } from '@/components/ui/avatar';
import { Badge, BadgeText } from '@/components/ui/badge';
import { Divider } from '@/components/ui/divider';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { ScrollView } from '@/components/ui/scroll-view';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { useProfile } from '@/features/auth/use-profile';
import { useSession } from '@/features/auth/session-provider';
import {
  DeviceStorageSummary,
  StorageUsage,
} from '@/features/library/components/storage-usage';
import { SyncSummary } from '@/features/library/components/sync-summary';
import { useInbox, useShareEvents } from '@/features/sharing/data/use-sharing';

import { SignOutAction } from './sign-out-action';
import { ThemeControl } from './theme-control';

/**
 * A labelled run of rows. Separated by a rule, not boxed in a card.
 *
 * **The spacing is the whole of this component, and it was wrong.** The label
 * sat in a `space="md"` stack inside a `space="2xl"` one, so every section
 * boundary cost about 57dp of nothing: a gap under the last row, a divider, and
 * another gap before the next heading. On a 720px phone that is a third of the
 * screen spent on four headings, and it read as a screen still loading.
 *
 * The rhythm here is the one `search-inside-screen.tsx` uses for its results,
 * because that is the densest list in the app and nobody has ever called it
 * cramped: rows at `py-3.5` separated by a hairline, and nothing else between
 * them. A heading needs air above it and almost none below — it belongs to the
 * rows under it, not to the divider over it — so the label carries `pt-2.5 pb-1`
 * and the group closes with `pb-1`, the rows' own `py-3` being most of the gap
 * before the next rule already.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <VStack>
      <Text size="xs" className="px-4 pt-2.5 pb-1 uppercase tracking-wider text-fg-subtle">
        {title}
      </Text>
      <VStack className="pb-1">{children}</VStack>
    </VStack>
  );
}

/** A hairline between two rows of one section. Never above the first or below the last. */
function RowRule() {
  return <Divider className="bg-hairline" />;
}

export function AccountScreen() {
  const router = useRouter();
  const { account } = useSession();
  const { profile, loading } = useProfile();

  // Both read the device's own database, so they are right offline and right
  // immediately — the live subscription writes into it as things arrive.
  const { unread } = useShareEvents();
  const { pending } = useInbox();

  // Google's copy is available the instant the sheet closes; the Convex row
  // arrives a round trip later. Preferring the local one keeps the header from
  // flashing a skeleton for data the app already has.
  const name = profile?.name ?? account?.name ?? null;
  const email = account?.email ?? profile?.email ?? null;
  // The photo is the exception to that order. `profile.pictureUrl` is already
  // `null` when the reader has turned their photo off, and the session's copy
  // knows nothing about that — so preferring the session here would show
  // somebody the face they have just hidden from everybody else.
  const photo = profile === null ? account?.photoUrl ?? null : profile.pictureUrl;

  return (
    <Screen>
      {/* The stack runs headerless, so this is the only way back on iOS, where
          there is no hardware button. */}
      <HStack className="items-center px-4 py-2">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="rounded-md p-2 data-[active=true]:bg-hover">
          <Icon as={ArrowLeft} size="lg" className="text-foreground" />
        </Pressable>
      </HStack>

      <ScrollView contentContainerClassName="pb-8">
        <VStack>
          <VStack className="items-center pt-2 pb-6" space="md">
            {/* gluestack v5's Avatar has no size variant — it is fixed at
                h-12 w-12, so the profile header sizes it through className. */}
            <Avatar className="h-20 w-20">
              <AvatarFallbackText>{name ?? email ?? 'Reader'}</AvatarFallbackText>
              <AvatarImage source={{ uri: photo }} />
            </Avatar>

            <VStack className="items-center" space="xs">
              <Heading size="lg" className="text-foreground">
                {name ?? 'Your account'}
              </Heading>
              {email === null ? (
                <Skeleton className="h-4 w-40 rounded-md" />
              ) : (
                <Text size="sm" className="text-muted-foreground">
                  {email}
                </Text>
              )}
            </VStack>
          </VStack>

          <Divider className="bg-hairline" />

          <Section title="You">
            <NavRow
              glyph={User}
              title="Profile"
              hint="The name and photo other people see on a share you send."
              onPress={() => router.push('/profile')}
            />
          </Section>

          <Divider className="bg-hairline" />

          <Section title="Appearance">
            <ThemeControl />
          </Section>

          <Divider className="bg-hairline" />

          {/* Two rows, because they answer different questions: what the
              account is holding, and what this phone is. A document can be in
              one, the other, or both. Only the second has anywhere to go. */}
          <Section title="Storage">
            <StorageUsage />
            <RowRule />
            <DeviceStorageSummary />
          </Section>

          <Divider className="bg-hairline" />

          {/* Between Storage and Account, because it is a fact about the
              library like Storage is — and because Account has to stay last:
              signing out is the terminal, destructive row on this screen. */}
          <Section title="Sync">
            <SyncSummary />
            <RowRule />
            <NavRow
              glyph={Wifi}
              title="Sync &amp; data"
              hint="Wi-Fi-only downloads, the image cache, and deleting your account."
              onPress={() => router.push('/data')}
            />
          </Section>

          <Divider className="bg-hairline" />

          {/* Before Account for the same reason Sync is: these are facts about
              the library rather than about the identity, and signing out has to
              stay the last row on the screen. */}
          <Section title="Sharing">
            <NavRow
              glyph={Inbox}
              title="Shared"
              hint="Documents other people sent you, and what you sent them."
              count={pending.length}
              onPress={() => router.push('/shared')}
            />
            <RowRule />
            <NavRow
              glyph={BellRing}
              title="Activity"
              hint="Everything that has happened, whether or not a notification arrived."
              count={unread}
              onPress={() => router.push('/activity')}
            />
            <RowRule />
            <NavRow
              glyph={Users}
              title="Groups"
              hint="Share with several people at once, and take it back the same way."
              onPress={() => router.push('/groups')}
            />
            <RowRule />
            <NavRow
              glyph={ShieldCheck}
              title="Sharing & privacy"
              hint="Who can find you, and what a share of yours starts as."
              onPress={() => router.push('/sharing-privacy')}
            />
            <RowRule />
            <NavRow
              glyph={Bell}
              title="Notifications"
              hint="What you are told about, and on which device."
              onPress={() => router.push('/notification-settings')}
            />
          </Section>

          <Divider className="bg-hairline" />

          <Section title="Account">
            <VStack className="px-4 py-2" space="xs">
              <Text size="sm" className="text-foreground">
                Signed in with Google
              </Text>
              <Text size="xs" className="text-fg-subtle">
                {loading
                  ? 'Syncing your library…'
                  : profile === null
                    ? 'Setting up your library…'
                    : `Library created ${new Date(profile.createdAt).toLocaleDateString()}`}
              </Text>
            </VStack>
            <SignOutAction />
          </Section>
        </VStack>
      </ScrollView>
    </Screen>
  );
}

/**
 * A row that goes somewhere.
 *
 * The same shape `storage-usage.tsx` and `sync-summary.tsx` already use — a
 * leading glyph, a title, a hint, and a chevron — written once here because
 * this screen now has four of them.
 */
function NavRow({
  glyph,
  title,
  hint,
  count = 0,
  onPress,
}: {
  glyph: React.ComponentProps<typeof Icon>['as'];
  title: string;
  hint: string;
  /**
   * Things waiting behind this row. Zero renders nothing.
   *
   * The only filled shape on this screen, and the only number on it somebody
   * has to act on — which is what separates it from every other piece of
   * metadata here, all of which is `text-fg-subtle` and stays that way.
   */
  count?: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="rounded-md px-4 py-2 data-[active=true]:bg-hover">
      <HStack className="items-center" space="md">
        <Icon as={glyph} size="lg" className="text-fg-muted" />
        <VStack className="flex-1" space="xs">
          <Text size="sm" className="text-foreground">
            {title}
          </Text>
          <Text size="xs" className="text-fg-subtle">
            {hint}
          </Text>
        </VStack>
        {count === 0 ? null : (
          <Badge className="rounded-full px-2">
            <BadgeText className="tracking-normal normal-case">{String(count)}</BadgeText>
          </Badge>
        )}
        <Icon as={ChevronRight} size="sm" className="text-fg-subtle" />
      </HStack>
    </Pressable>
  );
}
