import { useWindowDimensions } from 'react-native';

import type { ReadingMode } from '@convex/model/library';

/**
 * What this screen is wide enough to do.
 *
 * **Width, not orientation.** Expo's own documentation says that from iOS 27 a
 * supported orientation is a preference rather than a requirement once an app
 * is resizable, so a layout that keys off "am I landscape" is a layout that is
 * wrong in a split view and on a foldable. `useWindowDimensions` reports the
 * space actually available, which is the question being asked.
 *
 * 900 points is where two pages stop being a novelty: a page rendered at half
 * of it is ~430 wide, which is a phone's worth of column each. A 10.9" iPad is
 * 1180 across in landscape and 820 in portrait, so it spreads when turned and
 * does not when held upright — which is what a person would expect a book to do.
 */

/** Below this, two pages side by side is two unreadable pages. */
const SPREAD_MIN_WIDTH = 900;

export type ReaderLayout = {
  /** True when Two pages is offered rather than explained. */
  canSpread: boolean;
  /**
   * The mode to open under when the document has never been read.
   *
   * Never `spread` on a narrow screen, so a tablet document opened on a phone
   * falls back rather than rendering two slivers.
   */
  defaultMode: (stored: ReadingMode | null, lastUsed: ReadingMode) => ReadingMode;
};

export function useReaderLayout(): ReaderLayout {
  const { width } = useWindowDimensions();
  const canSpread = width >= SPREAD_MIN_WIDTH;

  return {
    canSpread,
    defaultMode: (stored, lastUsed) => {
      const wanted = stored ?? lastUsed;
      return wanted === 'spread' && !canSpread ? 'single' : wanted;
    },
  };
}
