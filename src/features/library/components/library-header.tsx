import { Search } from 'lucide-react-native';
import React from 'react';

import { Avatar, AvatarFallbackText, AvatarImage } from '@/components/ui/avatar';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

/**
 * The top of the home screen: who is signed in, and one way into the library.
 *
 * Compact rather than a hero. The covers below are what the reader came for,
 * and every vertical pixel spent here is one they have to scroll past on every
 * launch.
 */
export function LibraryHeader({
  name,
  email,
  photoUrl,
  onOpenAccount,
  onOpenSearch,
}: {
  name: string | null;
  email: string | null;
  photoUrl: string | null;
  onOpenAccount: () => void;
  onOpenSearch: () => void;
}) {
  return (
    <VStack>
      <HStack className="items-start justify-between px-6 pt-5" space="lg">
        <VStack className="flex-1">
          <Text size="xs" className="text-fg-subtle">
            {greeting()}
          </Text>
          <Text size="2xl" numberOfLines={1} className="mt-0.5 font-bold text-foreground">
            {name ?? 'Your library'}
          </Text>
        </VStack>

        <Pressable
          onPress={onOpenAccount}
          accessibilityRole="button"
          accessibilityLabel="Account"
          className="rounded-full">
          <Avatar className="h-9 w-9">
            <AvatarFallbackText>{name ?? email ?? 'Reader'}</AvatarFallbackText>
            {photoUrl === null ? null : <AvatarImage source={{ uri: photoUrl }} />}
          </Avatar>
        </Pressable>
      </HStack>

      <Pressable
        onPress={onOpenSearch}
        accessibilityRole="search"
        accessibilityLabel="Search your library"
        className="mx-6 mt-5 h-11 flex-row items-center gap-2.5 rounded-md border border-hairline bg-surface px-3 data-[active=true]:bg-hover">
        <Icon as={Search} size="md" className="text-fg-subtle" />
        <Text size="sm" className="text-fg-subtle">
          Search your library
        </Text>
      </Pressable>
    </VStack>
  );
}

/**
 * Time of day, on the device's clock.
 *
 * Deliberately not from the server: a query that reads `Date.now()` cannot be
 * cached, and Convex's own guidance says so. The greeting is also the one thing
 * on the screen that should follow the reader's timezone rather than a
 * deployment's.
 */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) {
    return 'Good morning';
  }
  return hour < 18 ? 'Good afternoon' : 'Good evening';
}
