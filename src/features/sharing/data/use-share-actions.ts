import { useCallback } from 'react';
import { useMutation } from 'convex/react';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { useLibraryStatus } from '@/features/library/data/use-library-status';
import { database } from '@/features/library/local/db';
import * as Documents from '@/features/library/local/repository/documents';
import * as Groups from '@/features/library/local/repository/groups';
import * as Queue from '@/features/library/local/repository/queue';
import * as Shares from '@/features/library/local/repository/shares';
import type { Permission, Recipient } from '@/stores/share-store';
import { log } from '@/lib/logger';

const SCOPE = 'sharing';

/**
 * The writes.
 *
 * Every one of them follows the shape the rest of this app settled on:
 * **write locally, queue, let the outbox deliver.** A reader who taps Share in
 * a tunnel has made a decision, and the alternative to recording it is refusing
 * it — so the row is written, the outbox is told, and the screen says "waiting
 * for connection" rather than pretending it went.
 *
 * The one thing a queued share cannot do is take effect. Nobody is told
 * anything until the queue drains, and the share screen says so in those words
 * rather than leaving the sender to assume otherwise.
 *
 * Two exceptions, and both are deliberate. **Group membership** is never
 * queued: adding somebody to a group changes what they can open, and a device
 * that invented memberships offline would be deciding who can read another
 * person's documents with nothing to check against. **Downloading** is not
 * queued either, because it is a network act by definition. Both are refused
 * with a sentence when there is no connection, which is the honest answer.
 */
export function useShareActions() {
  const { profileId, hasNetwork } = useLibraryStatus();
  const showToast = useAppToast();

  const respond = useMutation(api.sharing.respondToShare);
  const changePermission = useMutation(api.sharing.changePermission);
  const revoke = useMutation(api.sharing.revokeShare);
  const addMember = useMutation(api.groups.addMember);
  const removeMember = useMutation(api.groups.removeMember);
  const setRole = useMutation(api.groups.setRole);
  const markRead = useMutation(api.sharing.markEventsRead);

  const withDb = useCallback(
    async <T>(run: (db: Awaited<ReturnType<typeof database>>) => Promise<T>): Promise<T | null> => {
      if (profileId === null) {
        return null;
      }
      const db = await database(profileId);
      if (db === null) {
        return null;
      }
      return await run(db);
    },
    [profileId],
  );

  /**
   * Offers a document to everybody picked, as one row each.
   *
   * A group counts as one recipient and one row, because that is what it is on
   * the account — membership is resolved when somebody asks rather than copied
   * into a share per member.
   */
  const share = useCallback(
    async (
      documentId: string,
      recipients: Recipient[],
      permission: Permission,
      message: string,
    ): Promise<boolean> => {
      const document = await withDb(async (db) => await Documents.documentById(db!, documentId));
      if (document === null || document === undefined) {
        return false;
      }

      const trimmed = message.trim();
      let ok = true;

      for (const recipient of recipients) {
        const made = await withDb(async (db) => {
          const shareId = await Shares.addLocalShare(db!, {
            documentId,
            direction: 'outgoing',
            subject: recipient.kind === 'group' ? 'group' : 'user',
            counterpartId: recipient.kind === 'person' ? recipient.id : null,
            counterpartName: recipient.kind === 'person' ? recipient.name : null,
            counterpartHandle: recipient.kind === 'person' ? recipient.handle : null,
            counterpartPictureUrl: recipient.kind === 'person' ? recipient.pictureUrl : null,
            groupId: recipient.kind === 'group' ? recipient.id : null,
            groupName: recipient.kind === 'group' ? recipient.name : null,
            title: document.title,
            author: document.author,
            pageCount: document.pageCount,
            byteSize: document.byteSize,
            hasCover: document.hasCover,
            role: permission.role,
            canDownload: permission.canDownload,
            canReshare: permission.canReshare,
            message: trimmed === '' ? null : trimmed,
          });
          await Queue.enqueue(db!, 'share', shareId, 'create');
          return shareId;
        });
        ok = ok && made !== null;
      }

      if (!ok) {
        showToast({ id: 'share', tone: 'error', title: 'That could not be shared' });
      }
      return ok;
    },
    [showToast, withDb],
  );

  /**
   * Accepts or declines.
   *
   * Written locally first so the row leaves Pending straight away — an answer
   * that waits for a socket is an answer the reader gives twice. If the account
   * refuses it, because the share was revoked in the meantime, the next
   * reconcile overwrites this with the truth.
   */
  const answer = useCallback(
    async (shareId: string, response: 'accept' | 'decline'): Promise<void> => {
      const share = await withDb(async (db) => {
        const row = await Shares.shareById(db!, shareId);
        if (row === null) {
          return null;
        }
        await Shares.answerLocally(db!, row.id, response);
        await Queue.enqueue(db!, 'share', row.id, 'update', ['status']);
        return row;
      });

      if (share?.remoteId == null || !hasNetwork) {
        return;
      }

      // Sent straight away when there is a connection, so the sender hears back
      // in seconds rather than on the next drain. The queue row is still there
      // and is what covers a failure.
      try {
        await respond({ shareId: share.remoteId as Id<'documentShares'>, answer: response });
      } catch (error) {
        log.debug(SCOPE, 'answer will go through the queue instead', error);
      }
    },
    [hasNetwork, respond, withDb],
  );

  /**
   * Removes somebody's access.
   *
   * Immediate for everything the account mediates, and the dialog in front of
   * this says the rest out loud: it does not reach a copy already downloaded to
   * their device, and no setting here can.
   */
  const removeAccess = useCallback(
    async (shareId: string): Promise<void> => {
      const share = await withDb(async (db) => {
        const row = await Shares.shareById(db!, shareId);
        if (row === null) {
          return null;
        }
        await Shares.revokeLocally(db!, row.id);
        await Queue.enqueue(db!, 'share', row.id, 'update', ['status']);
        return row;
      });

      if (share?.remoteId == null || !hasNetwork) {
        return;
      }
      try {
        await revoke({ shareId: share.remoteId as Id<'documentShares'> });
      } catch (error) {
        log.debug(SCOPE, 'revoke will go through the queue instead', error);
      }
    },
    [hasNetwork, revoke, withDb],
  );

  /**
   * Changes what somebody already has.
   *
   * Takes either id. The Manage access screen renders the account's own list
   * rather than the mirror, so what it holds is the remote id — and
   * `Shares.shareById` matches on both columns for exactly this reason. When
   * there is no local row at all, which is the case for a group share the
   * device has never mirrored, the account is still told: the queue is the
   * offline path, not the only path.
   */
  const setPermission = useCallback(
    async (shareId: string, permission: Permission): Promise<void> => {
      const share = await withDb(async (db) => {
        const row = await Shares.shareById(db!, shareId);
        if (row === null) {
          return null;
        }
        await Shares.setPermissionLocally(db!, row.id, permission);
        await Queue.enqueue(db!, 'share', row.id, 'update', ['role', 'canDownload', 'canReshare']);
        return row;
      });

      // The local row's remote id when there is one, and the id we were handed
      // when there is not — a screen reading the account passes a remote id.
      const remoteId = share?.remoteId ?? (share === null ? shareId : null);
      if (remoteId == null || !hasNetwork) {
        return;
      }
      try {
        await changePermission({
          shareId: remoteId as Id<'documentShares'>,
          ...permission,
        });
      } catch (error) {
        log.debug(SCOPE, 'permission change will go through the queue instead', error);
      }
    },
    [changePermission, hasNetwork, withDb],
  );

  const createGroup = useCallback(
    async (name: string): Promise<string | null> => {
      return await withDb(async (db) => {
        const id = await Groups.createGroup(db!, name);
        await Queue.enqueue(db!, 'group', id, 'create');
        return id;
      });
    },
    [withDb],
  );

  const renameGroup = useCallback(
    async (groupId: string, name: string): Promise<void> => {
      await withDb(async (db) => {
        await Groups.renameGroup(db!, groupId, name);
        await Queue.enqueue(db!, 'group', groupId, 'update', ['name']);
      });
    },
    [withDb],
  );

  const deleteGroup = useCallback(
    async (groupId: string): Promise<void> => {
      await withDb(async (db) => {
        await Groups.removeGroup(db!, groupId);
        const outcome = await Queue.enqueue(db!, 'group', groupId, 'remove');
        if (outcome === 'annihilated') {
          await db!.runAsync('DELETE FROM groupsLocal WHERE id = ?', groupId);
        }
      });
    },
    [withDb],
  );

  /**
   * Adds or removes a member. Never queued — see the note at the top.
   */
  const changeMembership = useCallback(
    async (groupId: string, userId: string, action: 'add' | 'remove'): Promise<boolean> => {
      if (!hasNetwork) {
        showToast({
          id: 'group-member',
          tone: 'error',
          title: 'This needs a connection',
          description:
            'Changing who is in a group decides what they can open, so it is not queued.',
        });
        return false;
      }

      const remoteId = await withDb(
        async (db) => (await Groups.groupById(db!, groupId))?.remoteId ?? null,
      );
      if (remoteId == null) {
        showToast({
          id: 'group-member',
          tone: 'error',
          title: 'This group has not reached your account yet',
        });
        return false;
      }

      try {
        const args = { groupId: remoteId as Id<'groups'>, userId: userId as Id<'users'> };
        if (action === 'add') {
          await addMember(args);
        } else {
          await removeMember(args);
        }

        // The account is the authority on membership and the mirror is a copy,
        // but the copy is what the screen renders — so it moves now rather than
        // at the next reconcile. Removing is the half that matters: a name left
        // in a list of who can read your document is a name you believe.
        await withDb(async (db) => {
          if (action === 'remove') {
            await db!.runAsync('DELETE FROM groupMembersLocal WHERE groupId = ? AND userId = ?', [
              groupId,
              userId,
            ]);
          }
          await db!.runAsync(
            `UPDATE groupsLocal
                SET memberCount = MAX(0, memberCount + ?), updatedAt = ?
              WHERE id = ?`,
            [action === 'add' ? 1 : -1, Date.now(), groupId],
          );
        });
        return true;
      } catch (error) {
        log.error(SCOPE, 'membership change refused');
        log.debug(SCOPE, 'membership error', error);
        showToast({ id: 'group-member', tone: 'error', title: 'That could not be changed' });
        return false;
      }
    },
    [addMember, hasNetwork, removeMember, showToast, withDb],
  );

  /**
   * Promotes a member to admin, or puts them back.
   *
   * Owner-only on the account — `Groups.setRole` refuses anybody else and
   * refuses the owner's own row — so the menu item that calls this is drawn
   * only for an owner, and the refusal is the backstop rather than the rule.
   *
   * Not queued, for the same reason membership is not: an admin can add people
   * to the group, so this decides who can decide who can read.
   */
  const setMemberRole = useCallback(
    async (groupId: string, userId: string, role: 'admin' | 'member'): Promise<boolean> => {
      if (!hasNetwork) {
        showToast({
          id: 'group-role',
          tone: 'error',
          title: 'This needs a connection',
          description: 'An admin can add people to the group, so it is not queued.',
        });
        return false;
      }

      const remoteId = await withDb(
        async (db) => (await Groups.groupById(db!, groupId))?.remoteId ?? null,
      );
      if (remoteId == null) {
        showToast({
          id: 'group-role',
          tone: 'error',
          title: 'This group has not reached your account yet',
        });
        return false;
      }

      try {
        await setRole({
          groupId: remoteId as Id<'groups'>,
          userId: userId as Id<'users'>,
          role,
        });
        // The mirror is what the row renders, so the tag moves now rather than
        // at the next reconcile.
        await withDb(async (db) => {
          await db!.runAsync(
            'UPDATE groupMembersLocal SET role = ? WHERE groupId = ? AND userId = ?',
            [role, groupId, userId],
          );
        });
        return true;
      } catch (error) {
        log.error(SCOPE, 'role change refused');
        log.debug(SCOPE, 'role error', error);
        showToast({ id: 'group-role', tone: 'error', title: 'That could not be changed' });
        return false;
      }
    },
    [hasNetwork, setRole, showToast, withDb],
  );

  /**
   * Clears the badge.
   *
   * Locally first, like every other action here. It used to write only to the
   * account — which meant the badge stayed lit until the next reconcile
   * overwrote the mirror, so opening Activity did not clear the number beside
   * it. Best effort on the network half: a failure means the account catches up
   * on the next pass, and the reader has already seen the rows.
   */
  const markEventsRead = useCallback(
    async (eventIds: string[]): Promise<void> => {
      if (eventIds.length === 0) {
        return;
      }
      const now = Date.now();
      await withDb(async (db) => {
        for (const eventId of eventIds) {
          await db!.runAsync('UPDATE shareEvents SET readAt = ? WHERE id = ? AND readAt IS NULL', [
            now,
            eventId,
          ]);
        }
      });

      if (!hasNetwork) {
        return;
      }
      try {
        await markRead({ eventIds: eventIds as Id<'shareEvents'>[] });
      } catch (error) {
        log.debug(SCOPE, 'could not mark events read', error);
      }
    },
    [hasNetwork, markRead, withDb],
  );

  return {
    share,
    answer,
    removeAccess,
    setPermission,
    createGroup,
    renameGroup,
    deleteGroup,
    changeMembership,
    setMemberRole,
    markEventsRead,
  };
}
