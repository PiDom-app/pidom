'use client';
import { createAvatar } from '@gluestack-ui/core/avatar/creator';
import { Image as ExpoImage } from 'expo-image';
import React from 'react';
import { Image, Text, View } from 'react-native';
import type { VariantProps } from '@gluestack-ui/utils/nativewind-utils';
import { tva, withStyleContext } from '@gluestack-ui/utils/nativewind-utils';

import { styled } from '../styled-shim';

const SCOPE = 'AVATAR';

const UIAvatar = createAvatar({
  Root: withStyleContext(View, SCOPE),
  Badge: View,
  Group: View,
  Image: Image,
  FallbackText: Text,
});

const avatarStyle = tva({
  base: 'relative flex h-12 w-12 shrink-0 rounded-full bg-muted items-center justify-center group-[.avatar-group]/avatar-group:-ml-2.5',
});

const avatarFallbackTextStyle = tva({
  base: 'text-foreground text-xs font-medium text-transform:uppercase',
});

const avatarGroupStyle = tva({
  base: 'group/avatar-group flex-row-reverse relative avatar-group',
});

const avatarBadgeStyle = tva({
  base: 'absolute h-3 w-3 rounded-full border-2 border-background right-0 bottom-0 bg-ok',
});

const avatarImageStyle = tva({
  base: 'h-full w-full rounded-full absolute',
});

type IAvatarProps = Omit<
  React.ComponentPropsWithoutRef<typeof UIAvatar>,
  'context'
> &
  VariantProps<typeof avatarStyle>;

const Avatar = React.forwardRef<
  React.ComponentRef<typeof UIAvatar>,
  IAvatarProps
>(function Avatar({ className, ...props }, ref) {
  return (
    <UIAvatar
      ref={ref}
      {...props}
      className={avatarStyle({ class: className })}
      context={{}}
    />
  );
});

type IAvatarBadgeProps = React.ComponentPropsWithoutRef<typeof UIAvatar.Badge> &
  VariantProps<typeof avatarBadgeStyle>;

const AvatarBadge = React.forwardRef<
  React.ComponentRef<typeof UIAvatar.Badge>,
  IAvatarBadgeProps
>(function AvatarBadge({ className, ...props }, ref) {
  return (
    <UIAvatar.Badge
      ref={ref}
      {...props}
      className={avatarBadgeStyle({ class: className })}
    />
  );
});

type IAvatarFallbackTextProps = React.ComponentPropsWithoutRef<
  typeof UIAvatar.FallbackText
> &
  VariantProps<typeof avatarFallbackTextStyle>;
const AvatarFallbackText = React.forwardRef<
  React.ComponentRef<typeof UIAvatar.FallbackText>,
  IAvatarFallbackTextProps
>(function AvatarFallbackText({ className, ...props }, ref) {
  return (
    <UIAvatar.FallbackText
      ref={ref}
      {...props}
      className={avatarFallbackTextStyle({ class: className })}
    />
  );
});

/**
 * The photo, over `expo-image` and not over the creator's `Image` slot.
 *
 * The second departure from what the CLI writes, and the same exception the
 * gluestack skill grants `components/ui/image`: a performance-critical path,
 * documented. Avatars were the one remote-image surface left on React Native's
 * `Image`, and they are the surface that renders inside recycled `FlashList`
 * rows — the people in a search, the senders in an inbox, the members of a
 * group. Three things follow from that.
 *
 *   - `cachePolicy: 'memory-disk'`. Google serves these from
 *     `lh3.googleusercontent.com` and every scroll re-requested them. A face
 *     should survive a relaunch without the network, like a cover does.
 *   - `recyclingKey`. Without it a recycled row shows the previous person's
 *     face for a frame, which in a list of people is worse than in a list of
 *     covers: it briefly attributes a document to the wrong person.
 *   - `transition`. A face fading in beats one appearing.
 *
 * **The error state is ours too, and that is the bug being fixed.** The
 * creator's `AvatarImage` latches `error = true` on a failed load and has no
 * effect keyed on `source`, so once a row has failed it renders nothing for
 * every later person recycled through it — and because the image is
 * `absolute` over the initials, a failure hid the fallback rather than
 * revealing it. Google's photo URLs change when somebody changes their photo,
 * so old ones 404, so this happened. Here the flag resets whenever the URI
 * does, and a failure unmounts the image so the initials underneath show.
 */
const StyledAvatarImage = styled(ExpoImage, { className: 'style' });

type IAvatarImageProps = Omit<
  React.ComponentPropsWithoutRef<typeof StyledAvatarImage>,
  'source'
> &
  VariantProps<typeof avatarImageStyle> & {
    /**
     * Widened to allow a missing photo, which is the common case.
     *
     * Every call site would otherwise carry the same
     * `{url == null ? null : <AvatarImage .../>}` conditional, and half of them
     * did — so the check lives here once and a nullish URI renders the
     * initials.
     */
    source?: { uri?: string | null } | null;
  };

const AvatarImage = React.forwardRef<
  React.ComponentRef<typeof ExpoImage>,
  IAvatarImageProps
>(function AvatarImage({ className, source, recyclingKey, ...props }, ref) {
  const uri =
    source !== null && typeof source === 'object' && typeof source.uri === 'string'
      ? source.uri
      : null;

  const [failed, setFailed] = React.useState(false);
  // Resets when the photo changes, which is what the creator's version never
  // did. A row recycled onto a different person gets a fresh attempt.
  React.useEffect(() => setFailed(false), [uri]);

  if (uri === null || failed) {
    return null;
  }

  return (
    <StyledAvatarImage
      ref={ref}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={120}
      // Defaults to the photo itself: two rows showing the same person should
      // share a decode, and a row recycled onto somebody else should not.
      recyclingKey={recyclingKey ?? uri}
      {...props}
      source={{ uri }}
      onError={() => setFailed(true)}
      className={avatarImageStyle({ class: className })}
    />
  );
});

type IAvatarGroupProps = React.ComponentPropsWithoutRef<typeof UIAvatar.Group> &
  VariantProps<typeof avatarGroupStyle>;

const AvatarGroup = React.forwardRef<
  React.ComponentRef<typeof UIAvatar.Group>,
  IAvatarGroupProps
>(function AvatarGroup({ className, ...props }, ref) {
  return (
    <UIAvatar.Group
      ref={ref}
      {...props}
      className={avatarGroupStyle({
        class: className,
      })}
    />
  );
});

// Alias for shadcn compatibility
const AvatarFallback = AvatarFallbackText;

export {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarFallbackText,
  AvatarGroup,
  AvatarImage
};
