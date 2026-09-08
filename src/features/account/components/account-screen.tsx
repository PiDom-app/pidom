import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Bell,
  BellRing,
  ChevronRight,
  Inbox,
  ShieldCheck,
  Users,
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
 * The label sits clear of its rows rather than 4px above them: at `xs` the
 * heading read as part of the first row instead of as a heading over the group,
 * and a section of two rows looked like one four-line paragraph. Rows inside a
 * section separate themselves with a hairline — the same way every other list
 * in the app does — rather than with more whitespace, which is what stops two
 * stacked rows running together.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <VStack space="md">
      <Text size="xs" className="uppercase tracking-wider text-fg-subtle">
        {title}
      </Text>
      <VStack>{children}</VStack>
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
  const name = account?.name ?? profile?.name ?? null;
  const email = account?.email ?? profile?.email ?? null;
  const photo = account?.photoUrl ?? profile?.pictureUrl ?? null;

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

      <ScrollView contentContainerClassName="px-6 pb-12">
        <VStack space="2xl">
          <VStack className="items-center pt-4" space="md">
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
            <VStack className="px-1 py-3" space="xs">
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
      className="rounded-md px-1 py-3 data-[active=true]:bg-hover">
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
