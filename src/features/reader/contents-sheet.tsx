import { useQuery } from 'convex/react';
import { Bookmark, ListTree, TextSearch, Trash2 } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';

import {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
  ActionsheetItem,
  ActionsheetItemText,
} from '@/components/ui/actionsheet';
import { Box } from '@/components/ui/box';
import { Center } from '@/components/ui/center';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { ScrollView } from '@/components/ui/scroll-view';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';

import { useLibraryStatus } from '../library/data/use-library-status';
import { lastStartingBefore } from './outline';
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
  documentId,
  title,
  currentPage,
  bookmarks,
  onRemoveBookmark,
  isOpen,
  onClose,
  onJump,
  onSearch,
}: {
  documentId: Id<'documents'>;
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
  const { ready } = useLibraryStatus();
  // Skipped while closed, so opening a document does not subscribe to a list
  // nobody has asked for. See `useLibraryStatus` for why `ready` gates it.
  const entries = useQuery(api.library.outline, ready && isOpen ? { documentId } : 'skip');

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
          // Capped at 60% of the screen so the sheet never swallows the page
          // behind it — the reader is choosing where to go in a document they
          // can still see.
          <ScrollView className="w-full" style={LIST}>
            <VStack className="w-full pt-1">
              {entries.map((entry, index) => (
                <Pressable
                  // The index is part of the key because a PDF can, and does,
                  // declare the same title on the same page twice.
                  key={`${entry.page}-${entry.title}-${index}`}
                  onPress={() => {
                    onJump(entry.page);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: index === here }}
                  accessibilityLabel={`${entry.title}, page ${entry.page}`}
                  className={
                    index === here
                      ? 'bg-hover px-6 py-3'
                      : 'px-6 py-3 data-[active=true]:bg-hover'
                  }
                  style={{ paddingLeft: 24 + entry.depth * 18 }}>
                  <HStack className="items-center" space="md">
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
              ))}
            </VStack>
          </ScrollView>
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
    <ScrollView className="w-full" style={LIST}>
      <VStack className="w-full pt-1">
        {bookmarks.map((row) => (
          <HStack key={row.id} className="items-center">
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
              <HStack className="items-center" space="md">
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
        ))}
      </VStack>
    </ScrollView>
  );
}

/** Six-tenths of a 844pt screen, rounded to something a designer would pick. */
const LIST = { maxHeight: 480 } as const;
