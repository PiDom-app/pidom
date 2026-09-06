import { Bookmark, ListTree, TextSearch, Trash2 } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';

import {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
  ActionsheetFlatList,
  ActionsheetItem,
  ActionsheetItemText,
} from '@/components/ui/actionsheet';
import { Box } from '@/components/ui/box';
import { Center } from '@/components/ui/center';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

import { lastStartingBefore, type OutlineEntry } from './outline';
import type { Bookmark as BookmarkRow } from './use-bookmarks';

/**
 * The document's own table of contents.
 *
 * It costs nothing to have: `react-native-pdf`'s `onLoadComplete` hands back
 * `tableContents` on the same load that renders the import cover, and until
 * now that fourth argument was ignored. Every PDF that carries bookmarks has
 * had this list in it the whole time.
 *
 * An `Actionsheet`, matching `DocumentActions` — full-width targets within
 * thumb reach, over a page the reader is still looking at. Depth is rendered as
 * indentation and capped at three by the probe, because a fourth level in a
 * 390px sheet is four characters of title.
 */
export function ContentsSheet({
  entries,
  title,
  currentPage,
  bookmarks,
  onRemoveBookmark,
  isOpen,
  onClose,
  onJump,
  onSearch,
}: {
  /**
   * The document's table of contents, or `undefined` while it is still being
   * read. Passed in rather than fetched here: the reader already subscribes to
   * this exact query for the scrubber's chapter ticks, so opening the sheet on
   * its own subscription meant waiting out a second round trip for an answer
   * the screen behind it had already been handed.
   */
  entries: readonly OutlineEntry[] | undefined;
  /** The document's title, for the line under the heading. */
  title: string;
  /** Where the reader is, so the entry they are inside is the one marked. */
  currentPage: number;
  /** The pages this reader marked. The second half of the sheet. */
  bookmarks: readonly BookmarkRow[];
  onRemoveBookmark: (page: number) => void;
  isOpen: boolean;
  onClose: () => void;
  /** 1-based, as the reader sees it at the bottom of the screen. */
  onJump: (page: number) => void;
  /** Offered when there is no outline — searching still works. */
  onSearch: () => void;
}) {
  const listMax = useWindowDimensions().height * LIST_SHARE;

  // The entry the reader is *inside*, which is the last one that starts at or
  // before the current page — not the one whose number happens to match. A
  // chapter starting on 142 is the current chapter on page 148 too.
  const here = entries === undefined ? -1 : lastStartingBefore(entries, currentPage);

  const [tab, setTab] = useState<'contents' | 'bookmarks'>('contents');
  // A document with no outline but with bookmarks should open on the half that
  // has something in it, rather than on an empty state the reader has to leave.
  useEffect(() => {
    if (isOpen) {
      setTab(entries !== undefined && entries.length === 0 && bookmarks.length > 0
        ? 'bookmarks'
        : 'contents');
    }
  }, [isOpen, entries, bookmarks.length]);

  return (
    <Actionsheet isOpen={isOpen} onClose={onClose}>
      <ActionsheetBackdrop />
      <ActionsheetContent className="rounded-t-md border-t border-border bg-elevated pb-7">
        <ActionsheetDragIndicatorWrapper>
          <ActionsheetDragIndicator />
        </ActionsheetDragIndicatorWrapper>

        <HStack className="w-full items-center px-6 pt-2.5 pb-3.5" space="lg">
          <Icon as={tab === 'contents' ? ListTree : Bookmark} size="lg" className="text-fg-muted" />
          <VStack className="flex-1">
            <Text size="md" className="font-semibold text-foreground">
              {tab === 'contents' ? 'Contents' : 'Bookmarks'}
            </Text>
            <Text size="xs" numberOfLines={1} className="mt-0.5 text-fg-subtle">
              {title}
            </Text>
          </VStack>
          <Text size="xs" className="text-fg-subtle">
            {tab === 'contents'
              ? entries === undefined || entries.length === 0
                ? ''
                : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`
              : bookmarks.length === 0
                ? ''
                : `${bookmarks.length}`}
          </Text>
        </HStack>

        {/* Two halves of the same question — where in this document do I want
            to be — so they share a sheet rather than competing for a button in
            a toolbar that already has four. */}
        <HStack className="w-full px-6 pb-3" space="xs">
          <Tab label="Contents" on={tab === 'contents'} onPress={() => setTab('contents')} />
          <Tab
            label={bookmarks.length === 0 ? 'Bookmarks' : `Bookmarks · ${bookmarks.length}`}
            on={tab === 'bookmarks'}
            onPress={() => setTab('bookmarks')}
          />
        </HStack>

        <Divider className="bg-hairline" />

        {tab === 'bookmarks' ? (
          <Bookmarks
            bookmarks={bookmarks}
            currentPage={currentPage}
            onJump={onJump}
            onClose={onClose}
            onRemove={onRemoveBookmark}
          />
        ) : entries === undefined ? (
          <Center className="w-full py-12">
            <Spinner />
          </Center>
        ) : entries.length === 0 ? (
          <Empty onSearch={onSearch} />
        ) : (
          // A `FlatList`, not a mapped `ScrollView`. This list runs to
          // `OUTLINE_ENTRY_MAX` — 355 rows in the book this was found on — and
          // building every one of them before the sheet could show is what
          // made Contents take a visible pause to open. The list windows them
          // instead, so the sheet appears on the first frame.
          <ActionsheetFlatList
            // Width and height in the *same* `style` object, and deliberately
            // not a `w-full` class. Passing `style` alongside `className`
            // replaces the class-derived styles rather than merging with them,
            // so the old `className="w-full" style={{ maxHeight }}` silently
            // lost its width — see `LIST_CONTENT` for what that then did to
            // every row.
            style={{ width: '100%', maxHeight: listMax }}
            contentContainerStyle={LIST_CONTENT}
            data={entries as OutlineEntry[]}
            keyExtractor={(item, index) =>
              // The index is part of the key because a PDF can, and does,
              // declare the same title on the same page twice.
              `${(item as OutlineEntry).page}-${(item as OutlineEntry).title}-${index}`
            }
            renderItem={({ item, index }: { item: unknown; index: number }) => {
              const entry = item as OutlineEntry;
              return (
                <Pressable
                  onPress={() => {
                    onJump(entry.page);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: index === here }}
                  accessibilityLabel={`${entry.title}, page ${entry.page}`}
                  className={
                    index === here
                      ? 'w-full bg-hover px-6 py-3'
                      : 'w-full px-6 py-3 data-[active=true]:bg-hover'
                  }
                  style={{ paddingLeft: 24 + entry.depth * 18 }}>
                  <HStack className="w-full items-center" space="md">
                    <Text
                      size={entry.depth === 0 ? 'md' : 'sm'}
                      numberOfLines={1}
                      className={
                        entry.depth === 0
                          ? 'flex-1 font-semibold text-foreground'
                          : 'flex-1 text-fg-muted'
                      }>
                      {entry.title}
                    </Text>
                    <Text size="xs" className={index === here ? 'text-primary' : 'text-fg-subtle'}>
                      {entry.page}
                    </Text>
                  </HStack>
                </Pressable>
              );
            }}
          />
        )}
      </ActionsheetContent>
    </Actionsheet>
  );
}

/**
 * No bookmarks in the file.
 *
 * Most scans and most exports carry none, so this is a common state rather than
 * a failure — and it says what still works instead of only what does not.
 */
function Empty({ onSearch }: { onSearch: () => void }) {
  return (
    <VStack className="w-full items-center px-10 py-11">
      <Icon as={ListTree} size="xl" className="text-fg-subtle" />
      <Text size="md" className="mt-4 text-center font-semibold text-foreground">
        No contents in this PDF
      </Text>
      <Text size="sm" className="mt-1.5 text-center text-fg-muted">
        Nothing was built into the file. Searching inside it still works.
      </Text>
      <Box className="mt-5 w-full">
        <ActionsheetItem onPress={onSearch} className="justify-center">
          <Icon as={TextSearch} size="sm" className="text-foreground" />
          <ActionsheetItemText className="text-foreground">Search inside</ActionsheetItemText>
        </ActionsheetItem>
      </Box>
    </VStack>
  );
}

/** One of the two halves. A chip, not a segmented control: there are two. */
function Tab({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      className={
        on
          ? 'rounded-md bg-primary-tint px-3 py-1.5'
          : 'rounded-md px-3 py-1.5 data-[active=true]:bg-hover'
      }>
      <Text size="xs" className={on ? 'text-primary' : 'text-fg-muted'}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The pages this reader marked.
 *
 * Unlike Contents, this list is the reader's own — so a row can be removed from
 * it, and the page they are on is marked the same way the current chapter is,
 * because it is the same question asked of a different list.
 */
function Bookmarks({
  bookmarks,
  currentPage,
  onJump,
  onClose,
  onRemove,
}: {
  bookmarks: readonly BookmarkRow[];
  currentPage: number;
  onJump: (page: number) => void;
  onClose: () => void;
  onRemove: (page: number) => void;
}) {
  const listMax = useWindowDimensions().height * LIST_SHARE;
  if (bookmarks.length === 0) {
    return (
      <VStack className="w-full items-center px-10 py-11">
        <Icon as={Bookmark} size="xl" className="text-fg-subtle" />
        <Text size="md" className="mt-4 text-center font-semibold text-foreground">
          No bookmarks yet
        </Text>
        <Text size="sm" className="mt-1.5 text-center text-fg-muted">
          Tap the bookmark in the toolbar to mark the page you are on.
        </Text>
      </VStack>
    );
  }
  return (
    <ActionsheetFlatList
      style={{ width: '100%', maxHeight: listMax }}
      contentContainerStyle={LIST_CONTENT}
      data={bookmarks as BookmarkRow[]}
      keyExtractor={(item) => (item as BookmarkRow).id}
      renderItem={({ item }: { item: unknown }) => {
        const row = item as BookmarkRow;
        return (
          <HStack className="w-full items-center">
            <Pressable
              onPress={() => {
                onJump(row.page);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel={`${row.label ?? `Page ${row.page}`}, page ${row.page}`}
              className={
                row.page === currentPage
                  ? 'flex-1 bg-hover py-3 pl-6'
                  : 'flex-1 py-3 pl-6 data-[active=true]:bg-hover'
              }>
              <HStack className="w-full items-center" space="md">
                <Text
                  size="md"
                  numberOfLines={1}
                  className={row.page === currentPage ? 'flex-1 text-foreground' : 'flex-1 text-fg-muted'}>
                  {row.label ?? `Page ${row.page}`}
                </Text>
                <Text
                  size="xs"
                  className={row.page === currentPage ? 'text-primary' : 'text-fg-subtle'}>
                  {row.page}
                </Text>
              </HStack>
            </Pressable>
            <Pressable
              onPress={() => onRemove(row.page)}
              accessibilityRole="button"
              accessibilityLabel={`Remove the bookmark on page ${row.page}`}
              className="h-11 w-12 items-center justify-center rounded-md data-[active=true]:bg-hover">
              <Icon as={Trash2} size="sm" className="text-fg-subtle" />
            </Pressable>
          </HStack>
        );
      }}
    />
  );
}

/**
 * How tall the list may get, as a share of *this* screen.
 *
 * It used to be a flat 480pt picked off a 844pt phone. On a shorter screen
 * that plus the header and the tabs came to more than the sheet's own
 * `max-h-[80vh]`, and the bottom of the list fell off the bottom of the
 * display. A fraction cannot overflow a screen it was measured from.
 */
const LIST_SHARE = 0.5;

/**
 * A definite width for the list's content container.
 *
 * This is half the fix for the collapsed rows, and it is not cosmetic. A
 * vertical scroller sizes its content container to its content, so that
 * container's own width is indefinite — and `w-full` on a row inside it is a
 * percentage of nothing, which Yoga resolves to `auto`. Every row then
 * shrink-wrapped around a `flex-1` title, whose flex-basis is 0, so the title
 * measured to nothing and rendered as a single ellipsis: the whole Contents
 * list came out as a column of "Fore…", "Pref…", "…".
 *
 * The other half is that the scroller itself must have a definite width for
 * this percentage to resolve against — hence the explicit `width` in its
 * `style` rather than a `w-full` class.
 */
const LIST_CONTENT = { width: '100%' } as const;
