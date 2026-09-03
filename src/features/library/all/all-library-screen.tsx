import { FlashList } from '@shopify/flash-list';
import { usePaginatedQuery, useQuery } from 'convex/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowUpDown, Check, ChevronLeft, LayoutGrid, List, Search, X } from 'lucide-react-native';
import React, { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { Screen } from '@/components/layout/screen';
import { Box } from '@/components/ui/box';
import { Center } from '@/components/ui/center';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Input, InputField, InputIcon, InputSlot } from '@/components/ui/input';
import { Menu, MenuItem, MenuItemLabel } from '@/components/ui/menu';
import { Pressable } from '@/components/ui/pressable';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { api } from '@convex/_generated/api';
import { SEARCH_TERM_MAX } from '@convex/model/limits';
import { useLocalLibraryStore } from '@/stores/local-library-store';

import { DocumentActions } from '../components/document-actions';
import { DocumentRow, DocumentTile } from '../components/document-tile';
import type { LibraryDocument } from '../data/types';
import { useCoverSync } from '../data/use-cover-sync';
import { useLibraryActions } from '../data/use-library-actions';
import { useLibraryStatus } from '../data/use-library-status';

/**
 * The whole library, behind "View all".
 *
 * Three controls, and they do not all compose: **the filter chooses the index,
 * so the sort only applies with no filter active.** That is a real constraint
 * rather than a missing feature — a filter plus an unrelated sort means a
 * `.filter()` over a sorted index, which reads the whole table to fill a page
 * and returns pages of wildly uneven size. When a filter is on, the sort
 * control says so instead of lying about what it did.
 *
 * "On this device" is the fourth chip and the odd one out: it filters what the
 * page already returned, because the filesystem cannot be an index on the
 * server.
 */

type Sort = 'recent' | 'opened' | 'title';
type Filter = 'all' | 'favorites' | 'finished';
type Mode = 'grid' | 'list';

const SORT_LABELS: Record<Sort, string> = {
  recent: 'Recently added',
  opened: 'Recently opened',
  title: 'Title',
};

const FILTER_CHIPS: { key: Filter | 'device'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'favorites', label: 'Favourites' },
  { key: 'device', label: 'On this device' },
  { key: 'finished', label: 'Finished' },
];

/** Three columns, 24px page padding, 12px gutters. */
const GRID_COLUMNS = 3;
const GRID_PAGE_PADDING = 24;
const GRID_GUTTER = 12;

/**
 * A tile sized to the screen it is on rather than to one phone.
 *
 * The hardcoded 106 this replaces was measured on a 390pt device. On a 320pt
 * phone three columns have 90.7pt each and a 106pt tile overflows its cell;
 * on a tablet it leaves the grid stranded at the left.
 */
function gridTileWidth(windowWidth: number): number {
  const usable = windowWidth - GRID_PAGE_PADDING * 2 - GRID_GUTTER * (GRID_COLUMNS - 1);
  return Math.floor(usable / GRID_COLUMNS);
}

export function AllLibraryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ focus?: string }>();

  const [term, setTerm] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [chip, setChip] = useState<Filter | 'device'>('all');
  const [mode, setMode] = useState<Mode>('grid');
  const [acting, setActing] = useState<LibraryDocument | null>(null);

  const { ready } = useLibraryStatus();
  const { fetchDocument } = useLibraryActions();
  const { width } = useWindowDimensions();
  const tileWidth = gridTileWidth(width);
  const localIds = useLocalLibraryStore((state) => state.ids);

  // Typing should not fire a query per keystroke. `useDeferredValue` lets the
  // field stay responsive while the results catch up on their own.
  const searchTerm = useDeferredValue(term.trim());
  const searching = searchTerm !== '';

  const filter: Filter = chip === 'device' ? 'all' : chip;

  const { results, status, loadMore } = usePaginatedQuery(
    api.library.list,
    ready && !searching ? { sort, filter } : 'skip',
    { initialNumItems: 24 },
  );

  const searchResults = useQuery(
    api.library.search,
    ready && searching ? { term: searchTerm } : 'skip',
  );

  const documents = useMemo(() => {
    const source: LibraryDocument[] = searching ? (searchResults ?? []) : results;
    // The one filter the server cannot apply: whether this phone holds the file.
    return chip === 'device' ? source.filter((doc) => localIds.has(doc.id)) : source;
  }, [searching, searchResults, results, chip, localIds]);

  useCoverSync(documents);

  const loading = searching ? searchResults === undefined : status === 'LoadingFirstPage';

  const openDocument = useCallback(
    (document: LibraryDocument) => {
      // Same rule as home: a tap on something the account has and this phone
      // does not means fetch it. Anything here opens.
      if (!localIds.has(document.id) && document.isSynced) {
        void fetchDocument(document.id);
        return;
      }
      router.push({ pathname: '/reader', params: { id: document.id } });
    },
    [localIds, fetchDocument, router],
  );

  return (
    <Screen>
      <HStack className="items-center gap-1.5 px-6 pt-5">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="-ml-2 h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
          <Icon as={ChevronLeft} size="xl" className="text-foreground" />
        </Pressable>

        <Heading size="lg" className="flex-1 text-foreground">
          Library
        </Heading>

        <SortControl sort={sort} disabled={chip !== 'all' || searching} onChange={setSort} />

        <HStack className="ml-1 gap-0.5 rounded-md bg-surface p-0.5">
          <ModeToggle icon={LayoutGrid} label="Grid" active={mode === 'grid'} onPress={() => setMode('grid')} />
          <ModeToggle icon={List} label="List" active={mode === 'list'} onPress={() => setMode('list')} />
        </HStack>
      </HStack>

      <Input className="mx-6 mt-4 h-11">
        <InputSlot className="pl-1">
          <InputIcon as={Search} className="text-fg-muted" />
        </InputSlot>
        <InputField
          value={term}
          onChangeText={setTerm}
          maxLength={SEARCH_TERM_MAX}
          autoFocus={params.focus === 'search'}
          placeholder="Search your library"
          returnKeyType="search"
          className="text-foreground"
        />
        {term === '' ? null : (
          <InputSlot onPress={() => setTerm('')} className="pr-1">
            <InputIcon as={X} className="text-fg-muted" />
          </InputSlot>
        )}
      </Input>

      <HStack className="mt-3.5 h-11 items-center px-6" space="sm">
        {FILTER_CHIPS.map((entry) => (
          <Chip
            key={entry.key}
            label={entry.label}
            active={chip === entry.key}
            onPress={() => setChip(entry.key)}
          />
        ))}
      </HStack>

      {loading ? (
        <Center className="flex-1">
          <Spinner />
        </Center>
      ) : documents.length === 0 ? (
        <Center className="flex-1 px-10">
          <Text size="sm" className="text-center text-fg-subtle">
            {searching
              ? `Nothing matches “${searchTerm}”.`
              : chip === 'device'
                ? 'No documents are stored on this device yet.'
                : 'Nothing here yet.'}
          </Text>
        </Center>
      ) : mode === 'grid' ? (
        <FlashList
          key="grid"
          style={FILL}
          data={documents}
          numColumns={GRID_COLUMNS}
          keyExtractor={(document) => document.id}
          renderItem={({ item }) => (
            <Box className="pb-[18px]">
              <DocumentTile
                document={item}
                width={tileWidth}
                showProgress={item.progress > 0}
                onPress={openDocument}
                onLongPress={setActing}
              />
            </Box>
          )}
          contentContainerStyle={GRID_PADDING}
          onEndReached={() => {
            if (!searching && status === 'CanLoadMore') {
              loadMore(24);
            }
          }}
          ListFooterComponent={status === 'LoadingMore' ? <LoadingMore /> : null}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlashList
          key="list"
          style={FILL}
          data={documents}
          keyExtractor={(document) => document.id}
          renderItem={({ item }) => (
            <DocumentRow document={item} onPress={openDocument} onLongPress={setActing} />
          )}
          contentContainerStyle={LIST_PADDING}
          ItemSeparatorComponent={RowRule}
          onEndReached={() => {
            if (!searching && status === 'CanLoadMore') {
              loadMore(24);
            }
          }}
          ListFooterComponent={status === 'LoadingMore' ? <LoadingMore /> : null}
          showsVerticalScrollIndicator={false}
        />
      )}

      <DocumentActions document={acting} onClose={() => setActing(null)} />
    </Screen>
  );
}

/* ── controls ───────────────────────────────────────────────────────── */

function SortControl({
  sort,
  disabled,
  onChange,
}: {
  sort: Sort;
  disabled: boolean;
  onChange: (sort: Sort) => void;
}) {
  return (
    <Menu
      placement="bottom right"
      offset={6}
      trigger={({ ...props }) => (
        <Pressable
          {...props}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={
            disabled ? 'Sorting is unavailable while a filter is on' : `Sort by ${SORT_LABELS[sort]}`
          }
          className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
          <Icon
            as={ArrowUpDown}
            size="md"
            className={disabled ? 'text-fg-disabled' : 'text-foreground'}
          />
        </Pressable>
      )}>
      {(Object.keys(SORT_LABELS) as Sort[]).map((key) => (
        <MenuItem key={key} textValue={SORT_LABELS[key]} onPress={() => onChange(key)}>
          <MenuItemLabel className="text-sm flex-1 text-foreground">
            {SORT_LABELS[key]}
          </MenuItemLabel>
          {key === sort ? <Icon as={Check} size="sm" className="text-primary" /> : null}
        </MenuItem>
      ))}
    </Menu>
  );
}

function ModeToggle({
  icon,
  label,
  active,
  onPress,
}: {
  icon: React.ComponentProps<typeof Icon>['as'];
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      className={`h-8 w-8 items-center justify-center rounded-md ${active ? 'bg-hover' : ''}`}>
      <Icon as={icon} size="sm" className={active ? 'text-foreground' : 'text-fg-subtle'} />
    </Pressable>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={`h-9 items-center justify-center rounded-md border px-3 ${
        active ? 'border-primary bg-primary-tint' : 'border-border'
      }`}>
      <Text size="xs" className={active ? 'text-primary' : 'text-fg-muted'}>
        {label}
      </Text>
    </Pressable>
  );
}

function RowRule() {
  return <Box className="ml-[82px] h-px bg-hairline" />;
}

function LoadingMore() {
  return (
    <Center className="py-6">
      <Spinner size="small" />
    </Center>
  );
}

const GRID_PADDING = { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 32 } as const;
const LIST_PADDING = { paddingBottom: 32 } as const;
// A vertical FlashList is a ScrollView underneath, and a ScrollView in a flex
// column with no flex of its own does not get a height to scroll within. Not a
// className: FlashList's own props take styles and are not interop'd.
const FILL = { flex: 1 } as const;
