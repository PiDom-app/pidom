import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

import { palette, themeColors } from '@/design/tokens';
import { useResolvedTheme } from '@/providers/theme-provider';

/**
 * The Pidom mark: an open book, drawn as two leaves with text lines.
 *
 * Solid fills and strokes only, no gradient and no background plate, so it sits
 * on any surface at any size. The spine gap is what makes the silhouette
 * readable once it shrinks to a tab bar or a favicon — a closed rectangle at
 * 24px is just a rectangle.
 *
 * The left leaf is brand purple and the right leaf takes the foreground colour,
 * which is the whole reason the mark needs the resolved theme: purple holds
 * against both grounds, but the right leaf has to invert with them.
 */
export function PidomMark({ size = 48 }: { size?: number }) {
  const ink = themeColors[useResolvedTheme()].foreground;

  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* Left leaf. Drawn from the spine outward so the two halves meet on the
          centre line without overlapping. */}
      <Path
        d="M24 12.5C21.2 10.2 17.6 9 13.5 9H6.5C5.7 9 5 9.7 5 10.5V35.5C5 36.3 5.7 37 6.5 37H13.5C17.6 37 21.2 38.2 24 40.5"
        stroke={palette.purple}
        strokeWidth={2.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Right leaf. */}
      <Path
        d="M24 12.5C26.8 10.2 30.4 9 34.5 9H41.5C42.3 9 43 9.7 43 10.5V35.5C43 36.3 42.3 37 41.5 37H34.5C30.4 37 26.8 38.2 24 40.5"
        stroke={ink}
        strokeWidth={2.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The spine, running the full height between them. */}
      <Path
        d="M24 12.5V40.5"
        stroke={palette.purple}
        strokeWidth={2.75}
        strokeLinecap="round"
      />
      {/* Text lines. Rects rather than strokes so they keep their weight
          independently of the leaf stroke, and stay crisp when the mark is
          rasterised for the app icon. */}
      <Rect x={9.5} y={16.5} width={9} height={2.25} rx={1.125} fill={palette.purple} />
      <Rect x={9.5} y={22} width={11} height={2.25} rx={1.125} fill={palette.purple} />
      <Rect x={9.5} y={27.5} width={7} height={2.25} rx={1.125} fill={palette.purple} />

      <Rect x={29.5} y={16.5} width={9} height={2.25} rx={1.125} fill={ink} />
      <Rect x={27.5} y={22} width={11} height={2.25} rx={1.125} fill={ink} />
      <Rect x={31.5} y={27.5} width={7} height={2.25} rx={1.125} fill={ink} />
    </Svg>
  );
}
