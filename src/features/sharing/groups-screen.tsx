import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { ChevronRight, Info, Plus, Users } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';

import { Screen } from '@/components/layout/screen';
import { Divider } from '@/components/ui/divider';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { GROUP_NAME_MAX } from '@convex/model/limits';
import { NameDialog } from '@/features/library/components/name-dialog';

import { GroupRow, RowGlyph, initialsOf } from './components/person-row';
import { Empty, ListSkeleton, Notice, ScreenHeader } from './components/segments';
import { useShareActions } from './data/use-share-actions';
import { useGroups } from './data/use-sharing';

/**
 * The reader's groups.
 *
 * A group is a way to give the same people access to a document without adding
 * them one at a time — and, more usefully, to take it away the same way. That
 * sentence is on the screen because a groups list with nothing else on it looks
 * like a social feature, and this one is not: it exists so that somebody
 * leaving takes their access with them.
 */
export function GroupsScreen() {
  const router = useRouter();
  const { groups, loading } = useGroups();
  const { createGroup } = useShareActions();
  const [naming, setNaming] = useState(false);

  const make = useCallback(
    async (name: string): Promise<boolean> => {
      const id = await createGroup(name);
      if (id === null) {
        return false;
      }
      setNaming(false);
      router.push({ pathname: '/group', params: { id } });
      return true;
    },
    [createGroup, router],
  );

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        glyph={Users}
        title="Groups"
        subtitle={
          groups.length === 0
            ? 'None yet'
            : `${groups.length} ${groups.length === 1 ? 'group' : 'groups'}`
        }
        trailing={
          <Pressable
            onPress={() => setNaming(true)}
            accessibilityRole="button"
            accessibilityLabel="New group"
            className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover"
          >
            <Icon as={Plus} size="lg" className="text-foreground" />
          </Pressable>
        }
        onBack={() => router.back()}
      />
      <Divider className="bg-hairline" />

      {loading ? (
        <ListSkeleton />
      ) : groups.length === 0 ? (
        <Empty
          glyph={Users}
          title="No groups yet"
          body="A group lets you share a document with several people at once — and take it back from all of them by removing one row."
        />
      ) : (
        <FlashList
          style={FILL}
          data={groups}
          keyExtractor={(group) => group.id}
          contentContainerStyle={CONTENT}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <GroupRow
              name={item.name}
              detail={describe(item.memberCount, item.role)}
              initials={initialsOf(item.name)}
              trailing={<RowGlyph glyph={ChevronRight} />}
              onPress={() => router.push({ pathname: '/group', params: { id: item.id } })}
            />
          )}
          ListFooterComponent={
            <Notice glyph={Info}>
              A document shared with a group is open to its members straight away — being in the
              group is the agreement. Leaving one takes those documents with it.
            </Notice>
          }
        />
      )}

      <NameDialog
        isOpen={naming}
        onClose={() => setNaming(false)}
        onSubmit={make}
        title="New group"
        label="Name"
        placeholder="Reading group"
        maxLength={GROUP_NAME_MAX}
      />
    </Screen>
  );
}

function describe(members: number, role: 'owner' | 'admin' | 'member' | null): string {
  const count = `${members} ${members === 1 ? 'member' : 'members'}`;
  if (role === 'owner') {
    return `${count} · yours`;
  }
  if (role === 'admin') {
    return `${count} · you are an admin`;
  }
  return count;
}

// A vertical FlashList is a ScrollView underneath, and one in a flex column
// with no flex of its own gets no height to scroll within.
const FILL = { flex: 1 } as const;
const CONTENT = { paddingBottom: 32 } as const;
