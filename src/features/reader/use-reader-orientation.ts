import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect } from 'react';

import { log } from '@/lib/logger';

const SCOPE = 'reader-orientation';

/**
 * Lets the reader turn, and only the reader.
 *
 * `app.json` says `"orientation": "default"` rather than `"portrait"`, because
 * `"portrait"` writes a hard `UISupportedInterfaceOrientations` and a hard
 * `android:screenOrientation` that no runtime call can override on iOS. The
 * app is therefore locked to portrait *here*, screen by screen, and this hook
 * is the one place that lifts it — a document is the one thing worth turning
 * the phone for.
 *
 * Both calls are fire-and-forget and both swallow their failure. Expo's docs
 * are explicit that from iOS 27 a lock is a preference rather than a
 * requirement for a resizable app, so this can simply not work, and nothing
 * about the reader depends on it: the layout reads `useWindowDimensions`, so a
 * screen that rotates when it was asked not to still renders correctly.
 */
export function useReaderOrientation(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    ScreenOrientation.unlockAsync().catch((error: unknown) => {
      log.debug(SCOPE, 'could not unlock rotation', error);
    });
    return () => {
      // Back to portrait on the way out, so leaving a document sideways does
      // not hand the library a layout it was never designed for.
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
        (error: unknown) => {
          log.debug(SCOPE, 'could not restore portrait', error);
        },
      );
    };
  }, [enabled]);
}
