'use client';
import { Image as ExpoImage, type ImageProps as ExpoImageProps } from 'expo-image';
import React from 'react';
import { tva } from '@gluestack-ui/utils/nativewind-utils';
import type { VariantProps } from '@gluestack-ui/utils/nativewind-utils';

import { styled } from '../styled-shim';

/**
 * gluestack's Image API over `expo-image` rather than React Native's `Image`.
 *
 * This is the one place in `components/ui` that departs from what the CLI would
 * write, and the gluestack skill's own exception for it is "performance-critical
 * paths, must document". Three properties of `expo-image` are what the library
 * screen needs and RN's `Image` does not have:
 *
 *   - `recyclingKey`. Covers live in a recycled FlashList. Without it a cell
 *     shows the previous document's cover for a frame while the next one
 *     decodes, which on a fast scroll reads as the library shuffling itself.
 *   - `cachePolicy: 'memory-disk'`. A rail scrolled twice should not decode
 *     twice, and a cover should survive a relaunch without the network.
 *   - `transition`. A cover fading in beats one appearing, and it costs nothing.
 *
 * The surface is gluestack's, so call sites read like every other component
 * here: `size` variants, `className`, `alt`.
 */
const StyledImage = styled(ExpoImage, { className: 'style' });

const imageStyle = tva({
  base: 'max-w-full',
  variants: {
    size: {
      '2xs': 'h-6 w-6',
      'xs': 'h-10 w-10',
      'sm': 'h-16 w-16',
      'md': 'h-20 w-20',
      'lg': 'h-24 w-24',
      'xl': 'h-32 w-32',
      '2xl': 'h-64 w-64',
      'full': 'h-full w-full',
    },
  },
});

type IImageProps = Omit<ExpoImageProps, 'alt'> &
  VariantProps<typeof imageStyle> & {
    className?: string;
    /** Announced by a screen reader. Pass `''` for a purely decorative image. */
    alt: string;
  };

const Image = React.forwardRef<React.ComponentRef<typeof ExpoImage>, IImageProps>(
  function Image({ className, size = 'md', alt, ...props }, ref) {
    return (
      <StyledImage
        ref={ref}
        // Defaults rather than requirements: a call site that wants `contain`
        // or no fade passes its own and wins, because these come before the
        // spread.
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={120}
        accessible={alt !== ''}
        accessibilityRole="image"
        accessibilityLabel={alt === '' ? undefined : alt}
        {...props}
        className={imageStyle({ size, class: className })}
      />
    );
  },
);

Image.displayName = 'Image';

export { Image };
