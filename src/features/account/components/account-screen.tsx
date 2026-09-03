import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import React from 'react';

import { Screen } from '@/components/layout/screen';
import { Avatar, AvatarFallbackText, AvatarImage } from '@/components/ui/avatar';
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
import { StorageUsage } from '@/features/library/components/storage-usage';

import { SignOutAction } from './sign-out-action';
import { ThemeControl } from './theme-control';

/** A labelled run of rows. Separated by a rule, not boxed in a card. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <VStack space="xs">
      <Text size="xs" className="uppercase tracking-wider text-fg-subtle">
        {title}
      </Text>
      {children}
    </VStack>
  );
}

export function AccountScreen() {
  const router = useRouter();
  const { account } = useSession();
  const { profile, loading } = useProfile();

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
              {photo === null ? null : <AvatarImage source={{ uri: photo }} />}
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

          <Section title="Storage">
            <StorageUsage />
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
