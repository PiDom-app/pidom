import { useCallback, useMemo } from 'react';

import { useAppToast } from '@/components/feedback/use-app-toast';

import { useLibraryActions } from '../data/use-library-actions';
import { useLibraryStatus } from '../data/use-library-status';
import { database } from '../local/db';
import * as Actions from './actions';

/**
 * The Downloads screen's verbs, bound to this profile's database.
 *
 * A thin layer over `downloads/actions.ts` and deliberately thin: the decisions
 * live there, where they can be read without a React component around them, and
 * this exists only to hand them a database handle and put a sentence in front
 * of the reader when one is warranted.
 *
 * `removeDownload` comes from `useLibraryActions` rather than being written
 * again here. It already sweeps the PDF, the cover, the page thumbnails, the
 * mirrored text and the stored password — and a second cascade would be a
 * second thing to keep correct, with the one that got forgotten being the one
 * that leaves somebody's document text on their phone.
 */
export function useDownloadActions() {
  const { profileId } = useLibraryStatus();
  const { removeDownload } = useLibraryActions();
  const showToast = useAppToast();

  const withDb = useCallback(
    async (work: (db: NonNullable<Awaited<ReturnType<typeof database>>>) => Promise<void>) => {
      if (profileId === null) {
        return;
      }
      const db = await database(profileId);
      if (db === null) {
        return;
      }
      await work(db);
    },
    [profileId],
  );

  return useMemo(
    () => ({
      request: (documentId: string) => withDb((db) => Actions.request(db, documentId)),

      downloadAnyway: (documentId: string) =>
        withDb(async (db) => {
          await Actions.downloadAnyway(db, documentId);
          showToast({
            id: 'download',
            tone: 'info',
            title: 'Downloading now',
            description: 'Just this one. Your Wi-Fi and mobile-data settings are unchanged.',
          });
        }),

      pause: (documentId: string) => withDb((db) => Actions.pause(db, documentId)),
      resume: (documentId: string) => withDb((db) => Actions.resume(db, documentId)),

      cancel: (documentId: string) =>
        withDb(async (db) => {
          if (profileId === null) {
            return;
          }
          await Actions.cancel(db, profileId, documentId);
        }),

      verify: (documentId: string) =>
        withDb(async (db) => {
          if (profileId === null) {
            return;
          }
          const outcome = await Actions.verify(db, profileId, documentId);
          if (outcome === 'corrupt') {
            showToast({
              id: 'verify',
              tone: 'error',
              title: 'That file is damaged',
              description: 'Download it again to replace it.',
            });
          }
          if (outcome === 'outdated') {
            showToast({
              id: 'verify',
              tone: 'info',
              title: 'A newer copy is in your account',
              description: 'The one here still opens. Download again to catch up.',
            });
          }
        }),

      /**
       * Reads every downloaded file back.
       *
       * Reports at the end rather than on a progress bar: it runs while the
       * reader is doing something else, and the Downloads screen already shows
       * each row changing as it goes. What it must not do is finish silently —
       * a check whose result nobody sees is a check nobody can rely on.
       */
      verifyEverything: () =>
        withDb(async (db) => {
          if (profileId === null) {
            return;
          }
          const { checked, outdated, corrupt } = await Actions.verifyEverything(db, profileId);
          if (checked === 0) {
            showToast({
              id: 'verify-all',
              tone: 'info',
              title: 'Nothing on this device to check',
            });
            return;
          }
          const problems = outdated + corrupt;
          showToast({
            id: 'verify-all',
            tone: problems === 0 ? 'success' : 'info',
            title: problems === 0 ? 'All good' : `${problems} need attention`,
            description:
              problems === 0
                ? `${checked} document${checked === 1 ? '' : 's'} read back and matched your account.`
                : [
                    corrupt === 0 ? null : `${corrupt} damaged`,
                    outdated === 0 ? null : `${outdated} out of date`,
                  ]
                    .filter(Boolean)
                    .join(' · ') + '. Downloads shows which.',
          });
        }),

      removeDownload: async (documentId: string) => {
        await removeDownload(documentId);
      },
    }),
    [withDb, profileId, removeDownload, showToast],
  );
}
