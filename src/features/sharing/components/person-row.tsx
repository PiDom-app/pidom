import React from 'react';

import { Avatar, AvatarFallbackText, AvatarImage } from '@/components/ui/avatar';
import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

/**
 * One person, in a list.
 *
 * The shape every sharing surface uses — search results, who has access, who is
 * in a group. Flat, like every other row in this app: an avatar, two lines, and
 * whatever the surface needs on the right.
 *
 * The presence dot is `bg-ok` and eight pixels, and it is the only thing on
 * these screens that says anything about what somebody is doing right now.
 * There is deliberately no "active 4 minutes ago": presence is a heartbeat and
 * a timeout, so online and offline are the only two things it knows, and a
 * number invented to fill the space is a number somebody would believe.
 */
export function PersonRow({
  name,
  detail,
  pictureUrl,
  online = false,
  trailing,
  dim = false,
  onPress,
  onLongPress,
  accessibilityLabel,
  recyclingKey,
}: {
  name: string;
  detail?: string | null;
  pictureUrl?: string | null;
  /**
   * What identifies this row's photo in a recycled list.
   *
   * Defaults to the photo's own URL, which is right almost always. A caller
   * passes one when two rows can legitimately share a photo and must not share
   * a decode — or when the same person appears twice.
   */
  recyclingKey?: string;
  online?: boolean;
  trailing?: React.ReactNode;
  dim?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
}) {
  const body = (
    <HStack className={`items-center px-4 py-2 ${dim ? 'opacity-60' : ''}`} space="md">
      <Box className="relative">
        <Avatar className="h-10 w-10">
          <AvatarFallbackText>{name}</AvatarFallbackText>
          {/* No null-check: `AvatarImage` renders nothing without a URI and
              nothing on a failed load, so the initials underneath show either
              way. That is the whole point of the wrapper. */}
          <AvatarImage source={{ uri: pictureUrl }} recyclingKey={recyclingKey} />
        </Avatar>
        {online ? (
          // Outside the avatar rather than an `AvatarBadge`: gluestack's badge
          // carries its own colour, and every colour in this app comes from a
          // token. `ring-2 ring-background` notches it into the corner the way
          // a status dot has to be to read at ten pixels.
          <Box className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-ok ring-2 ring-background" />
        ) : null}
      </Box>

      <VStack className="flex-1">
        <Text size="md" numberOfLines={1} className="text-foreground">
          {name}
        </Text>
        {detail == null ? null : (
          <Text size="xs" numberOfLines={1} className="mt-0.5 text-fg-subtle">
            {detail}
          </Text>
        )}
      </VStack>

      {trailing}
    </HStack>
  );

  if (onPress === undefined && onLongPress === undefined) {
    return body;
  }

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? name}
      className="data-[active=true]:bg-hover">
      {body}
    </Pressable>
  );
}

/**
 * A group, in the same list as the people.
 *
 * Square rather than round, which is the whole of the distinction and enough of
 * it: a round avatar is a person everywhere else in the app, so a group that
 * borrowed one would read as somebody with an odd name.
 */
export function GroupRow({
  name,
  detail,
  initials,
  trailing,
  onPress,
}: {
  name: string;
  detail?: string | null;
  initials: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
}) {
  const body = (
    <HStack className="items-center px-4 py-2" space="md">
      <Box className="h-10 w-10 items-center justify-center rounded-md bg-surface">
        <Text size="sm" className="font-semibold text-fg-muted">
          {initials}
        </Text>
      </Box>
      <VStack className="flex-1">
        <Text size="md" numberOfLines={1} className="text-foreground">
          {name}
        </Text>
        {detail == null ? null : (
          <Text size="xs" numberOfLines={1} className="mt-0.5 text-fg-subtle">
            {detail}
          </Text>
        )}
      </VStack>
      {trailing}
    </HStack>
  );

  if (onPress === undefined) {
    return body;
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      className="data-[active=true]:bg-hover">
      {body}
    </Pressable>
  );
}

/** Two letters off a name, for a group with no picture to show. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '??';
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** A small flat label. The chip vocabulary, used as a role tag rather than a control. */
export function Tag({ label, tone = 'quiet' }: { label: string; tone?: 'quiet' | 'primary' }) {
  return (
    <Box
      className={
        tone === 'primary'
          ? 'shrink-0 rounded-md bg-primary-tint px-2 py-1'
          : 'shrink-0 rounded-md bg-surface px-2 py-1'
      }>
      <Text size="2xs" className={tone === 'primary' ? 'text-primary' : 'text-fg-muted'}>
        {label}
      </Text>
    </Box>
  );
}

/** A trailing icon, sized and coloured the way every other trailing glyph is. */
export function RowGlyph({
  glyph,
  tone = 'subtle',
}: {
  glyph: React.ComponentProps<typeof Icon>['as'];
  tone?: 'subtle' | 'primary' | 'muted';
}) {
  return (
    <Icon
      as={glyph}
      size="sm"
      className={
        tone === 'primary'
          ? 'text-primary'
          : tone === 'muted'
            ? 'text-fg-muted'
            : 'text-fg-subtle'
      }
    />
  );
}
