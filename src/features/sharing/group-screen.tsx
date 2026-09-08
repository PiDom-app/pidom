import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronRight,
  LogOut,
  MoreHorizontal,
  Search,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react-native';
import React, { useCallback, useMemo, useState } from 'react';
import { useQuery } from 'convex/react';

import { api } from '@convex/_generated/api';
import { GROUP_NAME_MAX } from '@convex/model/limits';
import { Screen } from '@/components/layout/screen';
import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Input, InputField } from '@/components/ui/input';
import { Menu, MenuItem, MenuItemLabel } from '@/components/ui/menu';
import { Pressable } from '@/components/ui/pressable';
import { ScrollView } from '@/components/ui/scroll-view';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { NameDialog } from '@/features/library/components/name-dialog';
import { useLibraryStatus } from '@/features/library/data/use-library-status';

import { ConfirmDialog } from './components/confirm-dialog';
import { PersonRow, Tag } from './components/person-row';
import { ProfileSheet } from './components/profile-sheet';
import { Empty, ListSkeleton, Notice, ScreenHeader, Segments } from './components/segments';
import { useShareActions } from './data/use-share-actions';
import { useGroup, useGroupDocuments } from './data/use-sharing';

/**
 * One group: who is in it, what has been shared into it, and its settings.
 *
 * Three segments in the navigator's chip row rather than three screens, for the
 * same reason the navigator has four: they answer one question about one thing,
 * and a stack three deep to see who is in a group is a stack nobody unwinds.
 *
 * Adding and removing members is the one action in this whole feature that is
 * **not** queued when there is no connection. Membership decides what somebody
 * can open, and a device that invented memberships offline would be deciding
 * who can read another person's documents with nothing to check against — so it
 * is refused with a sentence instead. See `use-share-actions.ts`.
 */
export function GroupScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { hasNetwork } = useLibraryStatus();
  const { group, members, loading } = useGroup(id ?? null);
  const documents = useGroupDocuments(id ?? null);
  const { renameGroup, deleteGroup, changeMembership, setMemberRole } = useShareActions();

  const [segment, setSegment] = useState<'members' | 'documents' | 'settings'>('members');
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  /** The member the Remove item was tapped on, held until the dialog answers. */
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [viewing, setViewing] = useState<{
    id: string;
    name: string;
    handle: string | null;
    pictureUrl: string | null;
  } | null>(null);

  const remoteId = group?.remoteId ?? null;

  const segments = useMemo(
    () => [
      { key: 'members', label: `Members · ${members.length}` },
      { key: 'documents', label: `Shared PDFs · ${documents.length}` },
      { key: 'settings', label: 'Settings' },
    ],
    [documents.length, members.length],
  );

  const rename = useCallback(
    async (name: string): Promise<boolean> => {
      if (group === null) {
        return false;
      }
      await renameGroup(group.id, name);
      setRenaming(false);
      return true;
    },
    [group, renameGroup],
  );

  const leave = useCallback(async () => {
    if (group === null) {
      return;
    }
    setLeaving(false);
    await deleteGroup(group.id);
    router.back();
  }, [deleteGroup, group, router]);

  if (loading || group === null) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader glyph={Users} title="Group" onBack={() => router.back()} />
        {loading ? (
          <ListSkeleton />
        ) : (
          <Empty
            glyph={Users}
            title="That group is gone"
            body="It was deleted, or you were removed from it. Anything shared into it is no longer open to you."
          />
        )}
      </Screen>
    );
  }

  const canAdminister = group.role === 'owner' || group.role === 'admin';

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        glyph={Users}
        title={group.name}
        subtitle={`${members.length} ${members.length === 1 ? 'member' : 'members'} · ${documents.length} ${documents.length === 1 ? 'document' : 'documents'}`}
        trailing={
          canAdminister ? (
            <Pressable
              onPress={() => setAdding(true)}
              accessibilityRole="button"
              accessibilityLabel="Add someone"
              className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
              <Icon as={UserPlus} size="lg" className="text-foreground" />
            </Pressable>
          ) : undefined
        }
        onBack={() => router.back()}
      />

      <Segments
        segments={segments}
        active={segment}
        onSelect={(key) => setSegment(key as typeof segment)}
      />

      <ScrollView contentContainerStyle={CONTENT}>
        {segment === 'members' ? (
          <VStack className="pt-1">
            {members.map((member) => (
              <PersonRow
                key={member.userId}
                name={member.name ?? 'Someone'}
                detail={member.handle === null ? null : `@${member.handle}`}
                pictureUrl={member.pictureUrl}
                trailing={
                  <HStack className="items-center gap-2.5">
                    <Tag label={member.isOwner ? 'Owner' : member.role === 'admin' ? 'Admin' : 'Member'} />
                    {canAdminister && !member.isOwner ? (
                      <Menu
                        placement="bottom right"
                        offset={6}
                        trigger={({ ...props }) => (
                          <Pressable
                            {...props}
                            accessibilityRole="button"
                            accessibilityLabel="Member actions"
                            className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
                            <Icon as={MoreHorizontal} size="lg" className="text-fg-subtle" />
                          </Pressable>
                        )}>
                        <MenuItem
                          key="profile"
                          textValue="View profile"
                          onPress={() =>
                            setViewing({
                              id: member.userId,
                              name: member.name ?? 'Someone',
                              handle: member.handle,
                              pictureUrl: member.pictureUrl,
                            })
                          }>
                          <MenuItemLabel className="text-sm text-foreground">
                            View profile
                          </MenuItemLabel>
                        </MenuItem>
                        {/* Owner-only, because `Groups.setRole` is: an admin
                            can add people, so who may promote one is the
                            narrowest permission in the group. */}
                        {group.role === 'owner' ? (
                          <MenuItem
                            key="role"
                            textValue={
                              member.role === 'admin' ? 'Make a member' : 'Make an admin'
                            }
                            onPress={() =>
                              void setMemberRole(
                                group.id,
                                member.userId,
                                member.role === 'admin' ? 'member' : 'admin',
                              )
                            }>
                            <MenuItemLabel className="text-sm text-foreground">
                              {member.role === 'admin' ? 'Make a member' : 'Make an admin'}
                            </MenuItemLabel>
                          </MenuItem>
                        ) : null}
                        <MenuItem
                          key="remove"
                          textValue="Remove from group"
                          onPress={() =>
                            setRemoving({ userId: member.userId, name: member.name ?? 'Someone' })
                          }>
                          <MenuItemLabel className="text-sm text-destructive">
                            Remove from group
                          </MenuItemLabel>
                        </MenuItem>
                      </Menu>
                    ) : null}
                  </HStack>
                }
              />
            ))}
            <Notice glyph={Users}>
              Everybody here can open the documents shared into this group. Removing somebody takes
              all of them away at once.
            </Notice>
          </VStack>
        ) : segment === 'documents' ? (
          documents.length === 0 ? (
            <Empty
              glyph={Users}
              title="Nothing shared here yet"
              body="Open a document, tap Share, and pick this group to give everybody in it access at once."
            />
          ) : (
            <VStack className="pt-1">
              {documents.map((share) => (
                <Pressable
                  key={share.id}
                  onPress={() => router.push({ pathname: '/share-detail', params: { id: share.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={share.title ?? 'A shared document'}
                  className="data-[active=true]:bg-hover">
                  <HStack className="items-center px-6 py-3" space="md">
                    <Box className="h-14 w-10 items-center justify-center rounded-md bg-surface">
                      <Text size="2xs" className="font-semibold tracking-wider text-fg-subtle">
                        PDF
                      </Text>
                    </Box>
                    <VStack className="flex-1">
                      <Text size="sm" numberOfLines={2} className="text-foreground">
                        {share.title ?? 'A shared document'}
                      </Text>
                      <Text size="xs" className="mt-0.5 text-fg-subtle">
                        {share.counterpartName ?? 'Someone'} ·{' '}
                        {share.role === 'annotator' ? 'can annotate' : 'can read'}
                      </Text>
                    </VStack>
                    <Icon as={ChevronRight} size="sm" className="text-fg-subtle" />
                  </HStack>
                </Pressable>
              ))}
            </VStack>
          )
        ) : (
          <VStack className="pt-2">
            <Pressable
              onPress={() => setRenaming(true)}
              accessibilityRole="button"
              accessibilityLabel="Rename this group"
              className="px-6 py-3 data-[active=true]:bg-hover"
              disabled={!canAdminister}>
              <HStack className="items-center" space="md">
                <VStack className="flex-1">
                  <Text size="md" className="text-foreground">
                    Name
                  </Text>
                </VStack>
                <Text size="sm" className="text-fg-subtle">
                  {group.name}
                </Text>
                {canAdminister ? <Icon as={ChevronRight} size="sm" className="text-fg-subtle" /> : null}
              </HStack>
            </Pressable>

            <Box className="mx-6 my-2 h-px bg-hairline" />

            <Pressable
              onPress={() => setLeaving(true)}
              accessibilityRole="button"
              accessibilityLabel={group.role === 'owner' ? 'Delete this group' : 'Leave this group'}
              className="px-6 py-3 data-[active=true]:bg-hover">
              <HStack className="items-center" space="md">
                <Icon
                  as={group.role === 'owner' ? Trash2 : LogOut}
                  size="lg"
                  className="text-destructive"
                />
                <VStack className="flex-1">
                  <Text size="md" className="text-destructive">
                    {group.role === 'owner' ? 'Delete this group' : 'Leave this group'}
                  </Text>
                  <Text size="xs" className="mt-0.5 text-fg-subtle">
                    {group.role === 'owner'
                      ? `Everybody loses access to the ${documents.length} ${documents.length === 1 ? 'document' : 'documents'} shared here.`
                      : `You lose access to the ${documents.length} ${documents.length === 1 ? 'document' : 'documents'} shared here.`}
                  </Text>
                </VStack>
              </HStack>
            </Pressable>
          </VStack>
        )}
      </ScrollView>

      <NameDialog
        isOpen={renaming}
        onClose={() => setRenaming(false)}
        onSubmit={rename}
        title="Rename group"
        label="Name"
        initialValue={group.name}
        maxLength={GROUP_NAME_MAX}
      />

      <AddMemberSheet
        isOpen={adding}
        onClose={() => setAdding(false)}
        offline={!hasNetwork}
        onPick={(userId) => {
          void changeMembership(group.id, userId, 'add');
          setAdding(false);
        }}
        exclude={new Set(members.map((member) => member.userId))}
        groupRemoteId={remoteId}
      />

      <ConfirmDialog
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing !== null) {
            void changeMembership(group.id, removing.userId, 'remove');
          }
          setRemoving(null);
        }}
        title={`Remove ${removing?.name ?? 'them'} from ${group.name}?`}
        lines={[
          `They lose access to ${countOf(documents.length, 'document')} shared into this group, all at once.`,
          'Anything they were allowed to download and did is on their device, and this does not delete it.',
        ]}
        confirmLabel="Remove"
      />

      <ConfirmDialog
        isOpen={leaving}
        onClose={() => setLeaving(false)}
        onConfirm={() => void leave()}
        title={group.role === 'owner' ? `Delete ${group.name}?` : `Leave ${group.name}?`}
        lines={
          group.role === 'owner'
            ? [
                `Everybody in it loses access to ${countOf(documents.length, 'document')} shared here.`,
                'The documents themselves stay yours. This cannot be undone.',
              ]
            : [
                `You lose access to ${countOf(documents.length, 'document')} shared here.`,
                'Somebody in the group would have to add you back.',
              ]
        }
        confirmLabel={group.role === 'owner' ? 'Delete group' : 'Leave'}
      />

      <ProfileSheet
        isOpen={viewing !== null}
        onClose={() => setViewing(null)}
        userId={viewing?.id ?? null}
        name={viewing?.name ?? ''}
        handle={viewing?.handle ?? null}
        pictureUrl={viewing?.pictureUrl ?? null}
      />
    </Screen>
  );
}

/**
 * Finding somebody to add.
 *
 * The same lookup the share screen uses, because there is only one way to find
 * a person in this app and a second one would be a second thing to audit.
 */
function AddMemberSheet({
  isOpen,
  onClose,
  onPick,
  exclude,
  offline,
  groupRemoteId,
}: {
  isOpen: boolean;
  onClose: () => void;
  onPick: (userId: string) => void;
  exclude: ReadonlySet<string>;
  offline: boolean;
  groupRemoteId: string | null;
}) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const people = useQuery(
    api.sharing.findPeople,
    debounced.length === 0 || offline ? 'skip' : { term: debounced },
  );

  if (!isOpen) {
    return null;
  }

  return (
    // **Inside a `SafeAreaView`, not just `inset-0`.** An absolutely positioned
    // overlay covers the whole display, status bar included, so this header drew
    // its back arrow and title straight over the clock and the signal icons.
    // Every other full-screen surface gets its inset from `Screen`; this one is
    // not a route, so it takes the same view directly.
    <Box className="absolute inset-0 bg-background">
      <SafeAreaView style={FILL} edges={SHEET_EDGES}>
      <ScreenHeader glyph={UserPlus} title="Add someone" onBack={onClose} backLabel="Cancel" />
      <Box className="mx-6 h-px bg-hairline" />

      <Box className="px-6 pt-3.5">
        <Input className="h-11">
          <Box className="pl-3">
            <Icon as={Search} size="sm" className="text-fg-subtle" />
          </Box>
          <InputField
            value={term}
            onChangeText={setTerm}
            placeholder="An exact @handle or email address"
            autoCapitalize="none"
            autoCorrect={false}
            className="text-foreground"
          />
        </Input>
      </Box>

      <ScrollView contentContainerStyle={CONTENT}>
        {offline ? (
          <Empty
            glyph={Search}
            title="This needs a connection"
            body="Changing who is in a group decides what they can open, so it is not queued."
          />
        ) : groupRemoteId === null ? (
          <Empty
            glyph={Search}
            title="This group has not reached your account yet"
            body="It goes out with the next sync. People can be added after that."
          />
        ) : debounced.length === 0 ? (
          <Empty
            glyph={Search}
            title="Who are you adding?"
            body="Pidom does not list accounts, so a handle or an address has to match exactly."
          />
        ) : people === undefined ? (
          <ListSkeleton />
        ) : people.filter((person) => !exclude.has(person.id)).length === 0 ? (
          <Empty
            glyph={Search}
            title={`No account matching ${debounced}`}
            body="Handles and email addresses have to match exactly."
          />
        ) : (
          people
            .filter((person) => !exclude.has(person.id))
            .map((person) => (
              <PersonRow
                key={person.id}
                name={person.displayName}
                detail={person.handle === null ? null : `@${person.handle}`}
                pictureUrl={person.pictureUrl}
                trailing={<Icon as={UserPlus} size="sm" className="text-primary" />}
                onPress={() => onPick(person.id)}
              />
            ))
        )}
      </ScrollView>
      </SafeAreaView>
    </Box>
  );
}

const FILL = { flex: 1 } as const;
/** Both edges, because the sheet owns the whole display while it is open. */
const SHEET_EDGES = ['top', 'bottom'] as const;

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

/** "1 document" / "3 documents", so the dialogs do not read "1 documents". */
function countOf(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : `${noun}s`}`;
}
