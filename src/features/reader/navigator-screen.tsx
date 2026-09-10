import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Bookmark,
  Highlighter,
  LayoutGrid,
  ListTree,
  TextSearch,
  Trash2,
} from 'lucide-react-native';
import React, { useEffect, useState } from 'react';

import { Screen } from '@/components/layout/screen';
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
import { THUMBNAIL_PAGE_MAX } from '@convex/model/limits';
import { useResolvedTheme } from '@/providers/theme-provider';
import { useReaderStore } from '@/stores/reader-store';

import { useLibraryStatus } from '../library/data/use-library-status';
import { documentFile } from '../library/local/paths';
import { AnnotationsList } from './annotations-list';
import { readPassword } from './document-password';
import { ContentsList } from './contents-list';
import { PageGrid } from './page-grid';
import type { NavigatorSegment } from './reader-location';
import type { OutlineEntry } from './outline';
import { useReaderDocument } from './use-reader-document';
import { useAnnotations } from './use-annotations';
import { useBookmarks, type Bookmark as BookmarkRow } from './use-bookmarks';

/**
 * Where in this document do I want to be.
 *
 * Four answers to one question — the document's own outline, the pages the
 * reader marked, what they kept out of it, and the document as pictures. All
 * four end in the same jump.
 *
 * **A screen, not a sheet.** It was an `Actionsheet`, and that was wrong in a
 * way only using it on a device showed: a sheet is as tall as its content, so
 * moving from Contents (355 rows) to Bookmarks (one row) shrank it by two
 * thirds — and the segmented control moved down with it, so the next tap landed
 * on the backdrop and dismissed the whole thing. A control must not hang off a
 * box whose height is the reader's data. A screen is the same height every
 * time.
 *
 * It costs nothing: expo-router keeps the reader mounted underneath, so going
 * back is not reopening the document. And it gives Pages a full screen, which
 * is what a grid wants.
 *
 * Its own queries rather than props, because it is a route: reachable by deep
 * link as well as by push, and a screen that cannot draw itself from its own
 * params is a screen that works from exactly one caller.
 */
export function NavigatorScreen() {
  const router = useRouter();
  const theme = useResolvedTheme();
  const { profileId } = useLibraryStatus();
  const params = useLocalSearchParams<{ id: string; page?: string; segment?: string }>();
  const documentId = params.id === undefined || params.id === '' ? undefined : params.id;

  const currentPage = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  // `null` until the reader taps a chip. The segment shown is derived from
  // that rather than synced into state by an effect — a document with no
  // outline should land on the half that has something in it, and "what to show
  // when nobody has chosen" is a value, not a state change.
  const [chosen, setChosen] = useState<NavigatorSegment | null>(null);

  const requestJump = useReaderStore((state) => state.requestJump);

  // The same read the reader below it is drawn from, so moving between the two
  // never shows a different answer while a subscription catches up.
  const { document, outline } = useReaderDocument(documentId);

  const { bookmarks, toggle: toggleBookmark } = useBookmarks({ documentId });
  const { annotations, forget } = useAnnotations({ documentId });

  // Only Pages needs it, and only to render a page of an encrypted document.
  const [password, setPassword] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (documentId === undefined) {
      return;
    }
    let live = true;
    readPassword(documentId)
      .then((stored) => {
        if (live && stored !== null) {
          setPassword(stored);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [documentId]);

  const entries: readonly OutlineEntry[] | undefined =
    document?.hasOutline === true ? outline : [];
  const pageCount = document?.pageCount ?? null;

  // Past this many pages a grid is a long scroll past pages nobody is looking
  // for, and the scrubber reaches any page in one drag regardless of length.
  // Absent rather than present and slow — the rule `DocumentActions` follows.
  const canShowPages =
    profileId !== null && pageCount !== null && pageCount > 0 && pageCount <= THUMBNAIL_PAGE_MAX;

  const asked = asSegment(params.segment);
  const segment: NavigatorSegment =
    chosen ??
    // Contents was asked for and there is none, so fall through to whichever of
    // the reader's own lists has anything in it. `entries === undefined` is
    // still loading and holds on Contents rather than flickering past it.
    (asked === 'contents' && entries !== undefined && entries.length === 0
      ? bookmarks.length > 0
        ? 'bookmarks'
        : annotations.length > 0
          ? 'notes'
          : 'contents'
      : asked);

  function jump(page: number) {
    if (documentId !== undefined) {
      requestJump(documentId, page);
    }
    router.back();
  }

  function compose(next: Record<string, string>) {
    router.push({ pathname: '/note', params: { id: String(documentId), ...next } });
  }

  if (documentId === undefined || document === undefined) {
    return (
      <Screen>
        <Center className="flex-1">
          <Spinner />
        </Center>
      </Screen>
    );
  }

  const heading = HEADINGS[segment];

  return (
    <Screen edges={['top', 'bottom']}>
      <HStack className="items-center px-4 pt-3 pb-3">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to the document"
          className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
          <Icon as={ArrowLeft} size="lg" className="text-foreground" />
        </Pressable>
        <Icon as={heading.glyph} size="md" className="ml-1.5 text-fg-muted" />
        <VStack className="ml-2.5 flex-1">
          <Text size="md" className="font-semibold text-foreground">
            {heading.label}
          </Text>
          <Text size="xs" numberOfLines={1} className="mt-0.5 text-fg-subtle">
            {document.title}
          </Text>
        </VStack>
        <Text size="xs" className="text-fg-subtle">
          {countFor(segment, { entries, bookmarks, annotations, currentPage, pageCount })}
        </Text>
      </HStack>

      {/* The row scrolls, and every chip refuses to shrink.

          Getting this right took two attempts on a device. `flexShrink: 0` in a
          `style` prop did nothing, because passing `style` beside `className`
          replaces the class-derived styles rather than merging — the same trap
          the Contents list hit. `shrink-0` in the class fixed the chip and not
          the label inside it, which went on clipping its last character:
          "Content", "Note", "Page", and a "Bookmarks ·" with the count gone.
          What the label needed was `flexGrow: 0` on the content container, so
          the row is measured against its content instead of the scroller. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={SEGMENTS}
        contentContainerStyle={SEGMENTS_CONTENT}>
        <Segment
          label="Contents"
          on={segment === 'contents'}
          onPress={() => setChosen('contents')}
        />
        <Segment
          label={bookmarks.length === 0 ? 'Bookmarks' : `Bookmarks · ${bookmarks.length}`}
          on={segment === 'bookmarks'}
          onPress={() => setChosen('bookmarks')}
        />
        <Segment
          label={annotations.length === 0 ? 'Notes' : `Notes · ${annotations.length}`}
          on={segment === 'notes'}
          onPress={() => setChosen('notes')}
        />
        {canShowPages ? (
          <Segment label="Pages" on={segment === 'pages'} onPress={() => setChosen('pages')} />
        ) : null}
      </ScrollView>

      <Divider className="bg-hairline" />

      {segment === 'bookmarks' ? (
        <Bookmarks
          bookmarks={bookmarks}
          currentPage={currentPage}
          onJump={jump}
          onRemove={toggleBookmark}
          onRename={(row) =>
            compose({ kind: 'bookmark', page: String(row.page), value: row.label ?? '' })
          }
        />
      ) : segment === 'notes' ? (
        <AnnotationsList
          annotations={annotations}
          currentPage={currentPage}
          onJump={jump}
          onEdit={(annotation) =>
            compose({
              kind: 'note',
              page: String(annotation.page),
              annotationId: annotation.id,
              value: annotation.note ?? '',
              ...(annotation.text === null ? {} : { passage: annotation.text }),
            })
          }
          onRemove={forget}
          onWriteNote={() => compose({ kind: 'note', page: String(currentPage), value: '' })}
        />
      ) : segment === 'pages' && canShowPages && profileId !== null ? (
        <PageGrid
          uri={documentFile(profileId, documentId).uri}
          password={password}
          profileId={profileId}
          documentId={documentId}
          pageCount={pageCount ?? 1}
          currentPage={currentPage}
          theme={theme}
          onJump={jump}
        />
      ) : entries === undefined ? (
        <Center className="flex-1">
          <Spinner />
        </Center>
      ) : entries.length === 0 ? (
        <Empty
          onSearch={() => {
            router.back();
            router.push({ pathname: '/search', params: { documentId } });
          }}
        />
      ) : (
        <ContentsList entries={entries} currentPage={currentPage} onJump={jump} />
      )}
    </Screen>
  );
}

/** A route param is a string somebody can type. Anything else opens Contents. */
function asSegment(value: string | undefined): NavigatorSegment {
  return value === 'bookmarks' || value === 'notes' || value === 'pages' ? value : 'contents';
}

/** The glyph and word at the top, per segment. */
const HEADINGS: Record<NavigatorSegment, { glyph: typeof ListTree; label: string }> = {
  contents: { glyph: ListTree, label: 'Contents' },
  bookmarks: { glyph: Bookmark, label: 'Bookmarks' },
  notes: { glyph: Highlighter, label: 'Notes' },
  pages: { glyph: LayoutGrid, label: 'Pages' },
};

/**
 * The number on the right of the heading.
 *
 * Empty rather than a zero: a count of nothing beside a heading is noise, and
 * the empty state underneath already says it better.
 */
function countFor(
  segment: NavigatorSegment,
  {
    entries,
    bookmarks,
    annotations,
    currentPage,
    pageCount,
  }: {
    entries: readonly OutlineEntry[] | undefined;
    bookmarks: readonly BookmarkRow[];
    annotations: readonly { id: string }[];
    currentPage: number;
    pageCount: number | null;
  },
): string {
  switch (segment) {
    case 'contents':
      return entries === undefined || entries.length === 0
        ? ''
        : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
    case 'bookmarks':
      return bookmarks.length === 0 ? '' : String(bookmarks.length);
    case 'notes':
      return annotations.length === 0 ? '' : String(annotations.length);
    case 'pages':
      return pageCount === null ? '' : `${currentPage} of ${pageCount}`;
  }
}

/**
 * No bookmarks in the file.
 *
 * Most scans and most exports carry none, so this is a common state rather than
 * a failure — and it says what still works instead of only what does not.
 */
function Empty({ onSearch }: { onSearch: () => void }) {
  return (
    <VStack className="flex-1 items-center justify-center px-10 py-12">
      <Icon as={ListTree} size="xl" className="text-fg-subtle" />
      <Text size="md" className="mt-4 text-center font-semibold text-foreground">
        No contents in this PDF
      </Text>
      <Text size="sm" className="mt-1.5 text-center text-fg-muted">
        Nothing was built into the file. Searching inside it still works.
      </Text>
      <Pressable
        onPress={onSearch}
        accessibilityRole="button"
        accessibilityLabel="Search inside this document"
        className="mt-5 flex-row items-center gap-2 rounded-md border border-border px-3.5 py-2 data-[active=true]:bg-hover">
        <Icon as={TextSearch} size="sm" className="text-foreground" />
        <Text size="sm" className="font-medium text-foreground">
          Search inside
        </Text>
      </Pressable>
    </VStack>
  );
}

/** One of the four. A chip, not a sliding control: they change width. */
function Segment({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      // `shrink-0` in the class rather than `flexShrink` in a `style` prop:
      // passing `style` alongside `className` replaces the class-derived styles
      // instead of merging with them, which is the trap the Contents list hit
      // once already. Both the chip and its label refuse to shrink — a row
      // child's default is to give up width rather than overflow, and with only
      // the chip pinned the text inside it still clipped to "Conte…".
      className={
        on
          ? 'shrink-0 rounded-md bg-primary-tint px-3 py-1.5'
          : 'shrink-0 rounded-md px-3 py-1.5 data-[active=true]:bg-hover'
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
 * it and named, and the page they are on is marked the same way the current
 * chapter is, because it is the same question asked of a different list.
 *
 * The long press is the naming affordance, matching the document tile: a tap is
 * navigation, which is what a row in this screen is for.
 */
function Bookmarks({
  bookmarks,
  currentPage,
  onJump,
  onRemove,
  onRename,
}: {
  bookmarks: readonly BookmarkRow[];
  currentPage: number;
  onJump: (page: number) => void;
  onRemove: (page: number) => void;
  onRename: (row: BookmarkRow) => void;
}) {
  if (bookmarks.length === 0) {
    return (
      <VStack className="flex-1 items-center justify-center px-10 py-12">
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
    <ScrollView contentContainerStyle={LIST_CONTENT}>
      {bookmarks.map((row) => (
        // The row is one surface. The highlight used to sit on the tappable
        // half only, so the page you were on drew a grey block with a white
        // notch cut out of it where the delete button was.
        <Box
          key={row.id}
          className={row.page === currentPage ? 'w-full flex-row bg-hover' : 'w-full flex-row'}>
          <Pressable
            onPress={() => onJump(row.page)}
            onLongPress={() => onRename(row)}
            accessibilityRole="button"
            accessibilityLabel={`${row.label ?? `Page ${row.page}`}, page ${row.page}`}
            accessibilityHint="Double tap and hold to name this bookmark"
            className="flex-1 py-3.5 pl-6 data-[active=true]:bg-hover">
            <HStack className="w-full items-center" space="md">
              <Text
                size="md"
                numberOfLines={1}
                className={
                  row.page === currentPage ? 'flex-1 text-foreground' : 'flex-1 text-fg-muted'
                }>
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
            className="w-12 items-center justify-center rounded-md data-[active=true]:bg-hover">
            <Icon as={Trash2} size="sm" className="text-fg-subtle" />
          </Pressable>
        </Box>
      ))}
    </ScrollView>
  );
}

const SEGMENTS = { flexGrow: 0 } as const;
const SEGMENTS_CONTENT = {
  flexGrow: 0,
  alignItems: 'center',
  paddingHorizontal: 16,
  paddingBottom: 12,
  gap: 6,
} as const;
const LIST_CONTENT = { paddingBottom: 32 } as const;
