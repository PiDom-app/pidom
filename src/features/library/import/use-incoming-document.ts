import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import ReactNativeBlobUtil from 'react-native-blob-util';

import { log } from '@/lib/logger';

import { ensureStagingDirectory } from '../local/paths';

const SCOPE = 'incoming';

/**
 * A PDF handed to Pidom by another app.
 *
 * `app.json` registers Pidom as a PDF handler on both platforms — Android
 * through an `intentFilters` entry for `VIEW` on `application/pdf`, iOS through
 * `CFBundleDocumentTypes` plus `LSSupportsOpeningDocumentsInPlace`. That is the
 * "Open with" / "Open in" entry from Files, Drive, Mail and a browser download.
 *
 * **Android's share sheet is deliberately not covered.** `ACTION_SEND` delivers
 * the file as an `EXTRA_STREAM` extra rather than as the intent's data URI, and
 * `expo-linking` surfaces the URI only. Reading that extra needs a native module
 * Expo does not ship, and writing one is a larger change than this capability —
 * so "Open with" works and the share sheet does not, which is worth knowing
 * rather than discovering.
 *
 * The URL arrives as `content://` on Android, which the `expo-file-system`
 * `File` class cannot open — this is the same problem `copyToCacheDirectory`
 * solves for the picker. `react-native-blob-util` is already in the dependency
 * set for the reader and *can* read a content URI, so it copies the file into
 * the same staging directory the picker uses. Everything downstream is then the
 * existing import path, magic-byte refusal included.
 *
 * Mount it once, in the authenticated layout. A document arriving while signed
 * out is dropped rather than queued: there is no account to import it into, and
 * holding a copy of somebody's file against a sign-in that may never come is
 * not a thing to do quietly.
 */
export function useIncomingDocument(): void {
  const router = useRouter();
  const url = Linking.useURL();

  // Every URL is handled once. `useURL` re-reports the same value across
  // re-renders, and a second handling would stage the file twice and open the
  // import screen on top of itself.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (url === null || handled.current === url) {
      return;
    }
    handled.current = url;

    // Pidom's own deep links are `pidom://…` and belong to the router. Only a
    // file handed over by the system is this hook's business.
    if (!url.startsWith('content://') && !url.startsWith('file://')) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const directory = ensureStagingDirectory();
        // A UUID, not the incoming name: a filename from another app is a
        // string somebody else chose, and it never becomes a path segment here
        // any more than the picker's does.
        const destination = `${directory.uri.replace(/^file:\/\//, '')}/${Crypto.randomUUID()}.pdf`;

        // The name before the copy, because the copy is named after a UUID.
        // On Android this is a ContentResolver lookup behind the scenes and can
        // come back empty; on iOS it is the last path segment. Either way it is
        // presentation metadata and nothing rides on it.
        const name = await ReactNativeBlobUtil.fs
          .stat(url)
          .then((stat) => stat.filename)
          .catch(() => '');

        await ReactNativeBlobUtil.fs.cp(url, destination);
        if (cancelled) {
          return;
        }

        // The import screen owns validation, the probe and the commit. It is
        // handed a path and behaves exactly as it does after the picker — the
        // header check refuses a renamed file here too.
        router.push({
          pathname: '/import',
          params: {
            incoming: `file://${destination}`,
            ...(name === '' ? {} : { incomingName: name }),
          },
        });
      } catch (error) {
        // Nothing to say to the reader: they opened a file in another app and
        // Pidom did not appear. A toast over whatever screen they landed on
        // would be the first they knew Pidom was involved at all.
        log.error(SCOPE, 'could not take an incoming document');
        log.debug(SCOPE, 'copy failed', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, router]);
}
