import React, { useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Box } from '@/components/ui/box';
import { Image } from '@/components/ui/image';
import { palette, themeColors } from '@/design/tokens';
import { useResolvedTheme } from '@/providers/theme-provider';

/**
 * The decorative hero that fills the top of the sign-in screen and dissolves
 * into the canvas just above the wordmark.
 *
 * The image is a hardcoded HTTPS constant to Unsplash's CDN — never user- or
 * server-supplied, and no query params carry data. It is purely decoration:
 * a solid canvas sits behind it and an `onError` fallback drops it entirely,
 * so with no network the screen is whole and the sign-in button never waits on
 * a pixel. This keeps the app's offline-first invariant on its one pre-login
 * screen. See the `.design/SignInHero.dc.html` comp for the target.
 */
const HERO_URI =
  'https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0?w=1200&q=80&auto=format&fit=crop';

/** The image covers roughly the top three-fifths; the rest is solid canvas. */
const HERO_FRACTION = 0.58;

/**
 * `#rrggbb` → `rgba()` at the given alpha.
 *
 * The fade endpoints are colours a native gradient consumes as props, not
 * classNames, so — like `StatusBar` and the SVG marks — they read from the
 * token mirror rather than CSS vars. This keeps the stops sourced from
 * `tokens.ts` instead of hand-written hex.
 */
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function AuthHero() {
  const theme = useResolvedTheme();
  const { height } = useWindowDimensions();
  const [failed, setFailed] = useState(false);

  const background = themeColors[theme].background;
  const isDark = theme === 'dark';

  // transparent → canvas, matching the comp: a faint dark scrim at the very top
  // keeps the (light) status-bar icons legible over the photo, the middle stays
  // clear, then the image dissolves into the background just above the content.
  const fadeColors = [
    withAlpha(palette.canvas, isDark ? 0.28 : 0.18),
    withAlpha(background, 0),
    withAlpha(background, isDark ? 0.55 : 0.6),
    withAlpha(background, isDark ? 0.92 : 0.94),
    background,
  ] as const;
  const fadeLocations = isDark
    ? ([0, 0.22, 0.62, 0.85, 1] as const)
    : ([0, 0.3, 0.66, 0.86, 1] as const);

  return (
    <Box
      // Bleeds to the very top edge, under the translucent status bar, and never
      // intercepts touches — the button lives in a sibling in front of it.
      className="absolute inset-x-0 top-0"
      style={{ height: Math.round(height * HERO_FRACTION) }}
      pointerEvents="none"
    >
      <Box className="absolute inset-0 bg-background" />
      {!failed ? (
        <Image
          source={{ uri: HERO_URI }}
          alt=""
          size="full"
          className="absolute inset-0"
          contentFit="cover"
          cachePolicy="disk"
          transition={240}
          recyclingKey={HERO_URI}
          onError={() => setFailed(true)}
        />
      ) : null}
      <LinearGradient
        colors={fadeColors}
        locations={fadeLocations}
        style={StyleSheet.absoluteFill}
      />
    </Box>
  );
}
