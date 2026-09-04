import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';

import { log } from '@/lib/logger';

const SCOPE = 'reader-wake-lock';

/** One tag, so a second activation cannot leave a lock nothing releases. */
const TAG = 'pidom.reader';

/**
 * Keeps the screen on while somebody is reading.
 *
 * A person reading a page is not touching the screen, and the system cannot
 * tell that apart from a phone left on a table. This is the fix, and it is
 * scoped as tightly as it can be: only while a document is open, only while the
 * reader has asked for it, and released the moment either stops being true.
 *
 * `useKeepAwake` from `expo-keep-awake` would be the obvious choice and cannot
 * be used, because it holds the lock for as long as the component is mounted
 * and hooks cannot be called conditionally — so a reader who turned the setting
 * off would keep the lock anyway. The imperative pair takes a flag.
 *
 * Both calls swallow. A wake lock that could not be taken is a screen that
 * dims, which is the behaviour without this hook at all.
 */
export function useReaderWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    activateKeepAwakeAsync(TAG).catch((error: unknown) => {
      log.debug(SCOPE, 'could not keep the screen awake', error);
    });
    return () => {
      deactivateKeepAwake(TAG).catch((error: unknown) => {
        log.debug(SCOPE, 'could not release the wake lock', error);
      });
    };
  }, [enabled]);
}
