import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Ban,
  Info,
  MoreHorizontal,
  ShieldCheck,
  SlidersHorizontal,
  User,
  UserPlus,
  Users,
} from 'lucide-react-native';
import React, { useCallback, useMemo, useState } from 'react';
import { useQuery } from 'convex/react';

import { api } from '@convex/_generated/api';
import { Screen } from '@/components/layout/screen';
import { Box } from '@/components/ui/box';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Menu, MenuItem, MenuItemLabel } from '@/components/ui/menu';
import { Pressable } from '@/components/ui/pressable';
import { ScrollView } from '@/components/ui/scroll-view';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { DocumentCover } from '@/features/library/components/document-cover';
import { useProfile } from '@/features/auth/use-profile';
import { useSession } from '@/features/auth/session-provider';
import { useReaderDocument } from '@/features/reader/use-reader-document';

import { GroupRow, PersonRow, Tag, initialsOf } from './components/person-row';
import { ProfileSheet } from './components/profile-sheet';
import { RemoveAccessDialog } from './components/remove-access-dialog';
import { SharePermissionSheet } from './components/share-permission-sheet';
import { Empty, ListSkeleton, Notice, ScreenHeader } from './components/segments';
import { useDocumentPresence } from './data/use-document-presence';
import { useShareActions } from './data/use-share-actions';
import type { Permission } from '@/stores/share-store';

/**
 * Who can open this document, from the owner's side.
 *
 * The list comes from the account rather than from the device, and that is the
 * one place in this feature where it should: everything else here is a fact
 * about the reader's own library, and this is a fact about other people's
 * access — a stale copy of it would be a screen quietly claiming somebody still
 * has a document they do not.
 *
 * Presence is here, and nowhere near the page. A dot beside a name in a list
 * somebody deliberately opened answers a question they might have; a live
 * header over a document being read answers one nobody asked.
 */
export function AccessScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { document } = useReaderDocument(id);
  const { removeAccess, setPermission } = useShareActions();
  const { account: me } = useSession();
  const { profile } = useProfile();

  const remoteId = document?.remoteId ?? null;
  const shares = useQuery(
    api.sharing.accessList,
    remoteId === null ? 'skip' : { documentId: remoteId as never },
  );

  const [removing, setRemoving] = useState<{ id: string; name: string; downloaded: boolean } | null>(
    null,
  );
  /**
   * The share whose permission is being changed, and the draft for it.
   *
   * Held here rather than in `share-store`, which is the compose screen's
   * draft: two screens editing one global permission would mean opening this
   * sheet quietly rewrote what the reader had set up on the other one.
   */
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [draft, setDraft] = useState<Permission>({
    role: 'viewer',
    canDownload: false,
    canReshare: false,
  });
  const [viewing, setViewing] = useState<{
    id: string | null;
    name: string;
    handle: string | null;
    pictureUrl: string | null;
    online: boolean;
  } | null>(null);

  // Anybody with a grant can be in the room, so the two lists line up.
  const { people: watchers, beat } = useDocumentPresence(
    remoteId,
    shares !== undefined && shares.length > 0,
  );
  const onlineIds = useMemo(
    () => new Set(watchers.map((person) => person.id)),
    [watchers],
  );

  const people = useMemo(
    () => (shares ?? []).filter((share) => share.subject === 'user'),
    [shares],
  );
  const groups = useMemo(
    () => (shares ?? []).filter((share) => share.subject === 'group'),
    [shares],
  );

  const openEditor = useCallback(
    (share: { id: string; role: 'viewer' | 'annotator'; canDownload: boolean; canReshare: boolean }, name: string) => {
      setDraft({
        role: share.role,
        canDownload: share.canDownload,
        canReshare: share.canReshare,
      });
      setEditing({ id: share.id, name });
    },
    [],
  );

  /** Applied on close rather than on each tap: three taps are one decision. */
  const closeEditor = useCallback(() => {
    if (editing !== null) {
      void setPermission(editing.id, draft);
    }
    setEditing(null);
  }, [draft, editing, setPermission]);

  const confirmRemove = useCallback(async () => {
    if (removing === null) {
      return;
    }
    await removeAccess(removing.id);
    setRemoving(null);
  }, [removeAccess, removing]);

  if (document === undefined) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader glyph={Users} title="Who can open this" onBack={() => router.back()} />
        <Divider className="bg-hairline" />
        <ListSkeleton />
      </Screen>
    );
  }

  const anyDownloadable = people.some((share) => share.canDownload);

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        glyph={Users}
        title="Who can open this"
        subtitle={document.title}
        trailing={
          <Pressable
            onPress={() => router.push({ pathname: '/share', params: { id: document.id } })}
            accessibilityRole="button"
            accessibilityLabel="Share with somebody else"
            className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
            <Icon as={UserPlus} size="lg" className="text-foreground" />
          </Pressable>
        }
        onBack={() => router.back()}
      />
      <Divider className="bg-hairline" />
      {beat}

      <ScrollView contentContainerStyle={CONTENT}>
        <HStack className="items-center px-6 py-3.5" space="md">
          <DocumentCover documentId={document.id} title={document.title} width={44} />
          <VStack className="flex-1">
            <Text size="sm" numberOfLines={2} className="font-semibold text-foreground">
              {document.title}
            </Text>
            <Text size="xs" className="mt-0.5 text-fg-subtle">
              {shares === undefined
                ? 'Checking…'
                : summarise(people.length, groups.length)}
            </Text>
          </VStack>
        </HStack>
        <Box className="mx-6 h-px bg-hairline" />

        {shares === undefined ? (
          <ListSkeleton />
        ) : people.length === 0 && groups.length === 0 ? (
          <Empty
            glyph={Users}
            title="Only you"
            body="Nobody else can open this document. Tap the icon above to share it with somebody or with one of your groups."
          />
        ) : (
          <>
            <VStack className="pt-1">
              <PersonRow
                name="You"
                detail="Owner"
                // The account's answer when it has one, and the session's
                // only until then. The account is the half that knows the
                // photo has been turned off, and this row sits in a list of
                // what other people can see.
                pictureUrl={profile === null ? me?.photoUrl ?? null : profile.pictureUrl}
                trailing={<Tag label="Owner" />}
                online
              />

              {people.map((share) => {
                const name = share.counterpart?.displayName ?? 'Someone';
                return (
                  <PersonRow
                    key={share.id}
                    name={name}
                    detail={detailFor(share, onlineIds.has(share.counterpart?.id ?? ''))}
                    pictureUrl={share.counterpart?.pictureUrl ?? null}
                    online={onlineIds.has(share.counterpart?.id ?? '')}
                    dim={share.status === 'revoked' || share.status === 'expired'}
                    trailing={
                      <HStack className="items-center gap-2.5">
                        <Tag label={share.role === 'annotator' ? 'Annotate' : 'Read'} />
                        <RowMenu
                          onProfile={() =>
                            setViewing({
                              id: share.counterpart?.id ?? null,
                              name,
                              handle: share.counterpart?.handle ?? null,
                              pictureUrl: share.counterpart?.pictureUrl ?? null,
                              online: onlineIds.has(share.counterpart?.id ?? ''),
                            })
                          }
                          onChange={
                            share.status === 'revoked' || share.status === 'expired'
                              ? undefined
                              : () => openEditor(share, name)
                          }
                          onRemove={() =>
                            setRemoving({
                              id: share.id,
                              name: name.split(' ')[0],
                              downloaded: share.canDownload,
                            })
                          }
                          removable={share.status !== 'revoked'}
                        />
                      </HStack>
                    }
                  />
                );
              })}
            </VStack>

            {groups.length === 0 ? null : (
              <>
                <Text size="xs" className="px-6 pt-4 pb-1.5 uppercase tracking-wider text-fg-subtle">
                  Groups
                </Text>
                {groups.map((share) => (
                  <GroupRow
                    key={share.id}
                    name={share.group?.name ?? 'A group'}
                    detail={share.role === 'annotator' ? 'Can annotate' : 'Can read'}
                    initials={initialsOf(share.group?.name ?? '?')}
                    trailing={
                      <HStack className="items-center gap-2.5">
                        <Tag label={share.role === 'annotator' ? 'Annotate' : 'Read'} />
                        <RowMenu
                          onChange={
                            share.status === 'revoked' || share.status === 'expired'
                              ? undefined
                              : () => openEditor(share, share.group?.name ?? 'this group')
                          }
                          onRemove={() =>
                            setRemoving({
                              id: share.id,
                              name: share.group?.name ?? 'this group',
                              downloaded: share.canDownload,
                            })
                          }
                          removable={share.status !== 'revoked'}
                        />
                      </HStack>
                    }
                  />
                ))}
              </>
            )}

            <Notice glyph={anyDownloadable ? Info : ShieldCheck}>
              {anyDownloadable
                ? 'Somebody here can download this. Once they have, removing their access stops the next open and does not reach the copy on their device.'
                : 'Nobody here can download this. Turning that on for one person puts the file on their device permanently.'}
            </Notice>
          </>
        )}
      </ScrollView>

      <RemoveAccessDialog
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
        name={removing?.name ?? ''}
        downloaded={removing?.downloaded ?? false}
      />

      <SharePermissionSheet
        isOpen={editing !== null}
        onClose={closeEditor}
        documentTitle={`${editing?.name ?? 'They'} · ${document.title}`}
        value={draft}
        onChange={setDraft}
      />

      <ProfileSheet
        isOpen={viewing !== null}
        onClose={() => setViewing(null)}
        userId={viewing?.id ?? null}
        name={viewing?.name ?? ''}
        handle={viewing?.handle ?? null}
        pictureUrl={viewing?.pictureUrl ?? null}
        online={viewing?.online ?? false}
      />
    </Screen>
  );
}

function RowMenu({
  onProfile,
  onChange,
  onRemove,
  removable,
}: {
  onProfile?: () => void;
  /** Absent once access is gone: there is no permission left to change. */
  onChange?: () => void;
  onRemove: () => void;
  removable: boolean;
}) {
  return (
    <Menu
      placement="bottom right"
      offset={6}
      trigger={({ ...props }) => (
        <Pressable
          {...props}
          accessibilityRole="button"
          accessibilityLabel="Access actions"
          className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
          <Icon as={MoreHorizontal} size="lg" className="text-fg-subtle" />
        </Pressable>
      )}>
      {/* A group has no profile to show, so the item is absent rather than
          present and inert. gluestack's `MenuItem` has no disabled state, and
          a row that looks tappable and is not is worse than one that is not
          there. */}
      {onProfile === undefined ? (
        <></>
      ) : (
        <MenuItem key="profile" textValue="View profile" onPress={onProfile}>
          <Icon as={User} size="sm" className="mr-2 text-fg-muted" />
          <MenuItemLabel className="text-sm text-foreground">View profile</MenuItemLabel>
        </MenuItem>
      )}
      {onChange === undefined ? (
        <></>
      ) : (
        <MenuItem key="permission" textValue="Change permission" onPress={onChange}>
          <Icon as={SlidersHorizontal} size="sm" className="mr-2 text-fg-muted" />
          <MenuItemLabel className="text-sm text-foreground">Change permission</MenuItemLabel>
        </MenuItem>
      )}
      {removable ? (
        <MenuItem key="remove" textValue="Remove access" onPress={onRemove}>
          <Icon as={Ban} size="sm" className="mr-2 text-destructive" />
          <MenuItemLabel className="text-sm text-destructive">Remove access</MenuItemLabel>
        </MenuItem>
      ) : (
        <MenuItem key="gone" textValue="Already removed">
          <MenuItemLabel className="text-sm text-fg-subtle">Access already removed</MenuItemLabel>
        </MenuItem>
      )}
    </Menu>
  );
}

function summarise(people: number, groups: number): string {
  if (people === 0 && groups === 0) {
    return 'Only you';
  }
  const parts: string[] = [];
  if (people > 0) {
    parts.push(`${people} ${people === 1 ? 'person' : 'people'}`);
  }
  if (groups > 0) {
    parts.push(`${groups} ${groups === 1 ? 'group' : 'groups'}`);
  }
  return `Shared with ${parts.join(' and ')}`;
}

function detailFor(
  share: { status: string; canDownload: boolean; counterpart?: { handle?: string | null } | null },
  online: boolean,
): string {
  const handle = share.counterpart?.handle == null ? '' : `@${share.counterpart.handle}`;
  if (share.status === 'pending') {
    return handle === '' ? 'Invited, not answered' : `${handle} · invited, not answered`;
  }
  if (share.status === 'revoked') {
    return 'Access removed';
  }
  if (share.status === 'expired') {
    return 'Expired';
  }
  const suffix = online ? ' · reading now' : share.canDownload ? ' · can download' : '';
  return `${handle}${suffix}`;
}

/**
 * `flexGrow` rather than `flex`, and it is what lets an empty state centre.
 *
 * A `ScrollView`'s content container is sized by its children, so a `flex-1`
 * child inside one has nothing to fill and collapses to its own height — which
 * is how every empty state on a scrolling screen ended up pinned under the
 * header. `flexGrow: 1` gives the container the viewport as a floor and no
 * ceiling: short content centres, long content scrolls exactly as before.
 */
const CONTENT = { flexGrow: 1, paddingBottom: 32 } as const;
