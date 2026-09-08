import {
  ArrowLeft,
  Bookmark,
  ListTree,
  MoreHorizontal,
  Share2,
  TextSearch,
} from 'lucide-react-native';
import React, { useEffect } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { ThemeName } from '@/design/tokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, AvatarFallbackText, AvatarImage } from '@/components/ui/avatar';
import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

import type { OutlineEntry } from './outline';
import { ReaderScrubber } from './reader-scrubber';

/**
 * The controls, which are transient on purpose.
 *
 * Both bars overlay the page rather than sitting above and below it, so showing
 * and hiding them never reflows the document — a reader who taps to check the
 * page number should find the same words in the same places afterwards.
 *
 * They fade rather than unmounting. This is the first animation in application
 * code; `react-native-reanimated` and `react-native-worklets` were already
 * installed and `GestureHandlerRootView` was already at the root, so it costs
 * no new dependency. The opacity and the translation run as worklets on the UI
 * thread, which matters because the thing they are competing with for frames is
 * a native PDF renderer.
 *
 * `pointerEvents` follows the opacity: a bar faded to nothing must not still be
 * catching the tap meant for the page underneath it.
 *
 * The insets are real. The previous reader hardcoded `pt-11` and `pb-7`, which
 * is one particular iPhone and wrong everywhere else.
 */

/** Long enough to read as a fade, short enough that a tap feels answered. */
const FADE_MS = 160;

export function ReaderChrome({
  shown,
  title,
  page,
  pageCount,
  canSearch,
  onBack,
  onNavigator,
  onSearch,
  isBookmarked,
  onToggleBookmark,
  onShare,
  readers,
  onMore,
  onScrubTo,
  onOpenJump,
  onOpenSettings,
  onStep,
  outline,
  uri,
  password,
  theme,
}: {
  shown: boolean;
  title: string;
  page: number;
  /** `null` until the renderer has counted. The bar says `Page 4` until then. */
  pageCount: number | null;
  canSearch: boolean;
  onBack: () => void;
  /** Contents, Bookmarks, Notes and Pages, all behind one button. */
  onNavigator: () => void;
  onSearch: () => void;
  /** Whether the page currently on screen is one of the marked ones. */
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  /** Absent for a document with no cloud copy — there would be nothing to share. */
  onShare?: () => void;
  /**
   * Who else has this document open right now.
   *
   * Empty for a document nobody shares, which is nearly all of them, and the
   * row is absent rather than empty in that case.
   */
  readers?: readonly { id: string; displayName: string; pictureUrl: string | null }[];
  onMore: () => void;
  /** Committed on release, never during the drag. */
  onScrubTo: (page: number) => void;
  onOpenJump: () => void;
  onOpenSettings: () => void;
  /** `+1` / `-1`, for the assistive-technology adjust actions on the track. */
  onStep: (by: 1 | -1) => void;
  /** Chapter starts, for the ticks and for naming the page under the thumb. */
  outline: readonly OutlineEntry[] | undefined;
  /** The open document, for the preview the scrubber mounts while dragging. */
  uri: string;
  password?: string;
  theme: ThemeName;
}) {
  const insets = useSafeAreaInsets();
  const visible = useSharedValue(shown ? 1 : 0);

  useEffect(() => {
    visible.value = withTiming(shown ? 1 : 0, { duration: FADE_MS });
  }, [shown, visible]);

  const topStyle = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateY: (1 - visible.value) * -12 }],
  }));
  const bottomStyle = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateY: (1 - visible.value) * 12 }],
  }));

  const total = pageCount ?? 0;

  return (
    <>
      <Animated.View
        style={topStyle}
        pointerEvents={shown ? 'auto' : 'none'}
        // Opacity zero is invisible to eyes and not to VoiceOver. Without this
        // a reader with the controls hidden still hears the whole toolbar read
        // out over a document that shows none of it.
        accessibilityElementsHidden={!shown}
        importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
        className="absolute inset-x-0 top-0 border-b border-hairline bg-background">
        <HStack
          className="items-center gap-1.5 px-4 pb-3"
          style={{ paddingTop: insets.top + 8 }}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back to your library"
            className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
            <Icon as={ArrowLeft} size="lg" className="text-foreground" />
          </Pressable>

          <Text size="sm" numberOfLines={1} className="flex-1 px-1 font-semibold text-foreground">
            {title}
          </Text>

          {/* Always offered. It used to appear only when the PDF declared an
              outline, on the reasoning that a Contents button opening an empty
              sheet is a button that lies — but the sheet also holds the
              bookmarks, and most PDFs declare no outline. So on most documents
              a reader could mark a page from this very toolbar and then have no
              way left to reach the list. Contents is one of four things behind
              this button now, and an outline the file does not have is an empty
              state inside it. */}
          <Pressable
            onPress={onNavigator}
            accessibilityRole="button"
            accessibilityLabel="Contents, bookmarks and notes"
            className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
            <Icon as={ListTree} size="lg" className="text-foreground" />
          </Pressable>

          {/* Searching inside reads the copy in the account, so a document
              that was never synced has nothing to search and says so by not
              offering it. */}
          {canSearch ? (
            <Pressable
              onPress={onSearch}
              accessibilityRole="button"
              accessibilityLabel="Search inside this document"
              className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
              <Icon as={TextSearch} size="lg" className="text-foreground" />
            </Pressable>
          ) : null}

          <Pressable
            onPress={onToggleBookmark}
            accessibilityRole="button"
            accessibilityState={{ selected: isBookmarked }}
            accessibilityLabel={isBookmarked ? 'Remove this bookmark' : 'Bookmark this page'}
            className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
            {/* Filled when the page is marked. A bookmark is the one control
                here whose state is worth reading off the icon rather than off a
                sheet two taps away. */}
            <Icon
              as={Bookmark}
              size="lg"
              className={isBookmarked ? 'fill-primary text-primary' : 'text-foreground'}
            />
          </Pressable>

          {/* Sharing is one tap rather than two through the sheet, because it
              is the one thing here somebody does *to* a document rather than
              with it — and because the sheet's Share is the operating system's,
              which sends a file rather than granting access. Two different
              acts, so two different controls. Absent when the document has no
              copy in the account: there would be nothing for a recipient to
              fetch, and the account refuses such a share anyway. */}
          {onShare === undefined ? null : (
            <Pressable
              onPress={onShare}
              accessibilityRole="button"
              accessibilityLabel="Share this document"
              className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
              <Icon as={Share2} size="lg" className="text-foreground" />
            </Pressable>
          )}

          <Pressable
            onPress={onMore}
            accessibilityRole="button"
            accessibilityLabel="Document actions"
            className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
            <Icon as={MoreHorizontal} size="lg" className="text-foreground" />
          </Pressable>
        </HStack>

        {/* Under the title rather than in the run of buttons.

            The bar carries six controls already, and a seventh would be the one
            that finally turns the title into an ellipsis. Three faces at most
            and then a count: a row that grows with the number of readers is a
            row that eventually pushes something off the screen. */}
        {readers === undefined || readers.length === 0 ? null : (
          <HStack className="items-center gap-2 px-5 pb-3">
            <HStack className="items-center">
              {readers.slice(0, 3).map((reader, index) => (
                <Box
                  key={reader.id}
                  className={index === 0 ? 'rounded-full' : '-ml-2 rounded-full'}>
                  <Avatar className="h-5 w-5">
                    <AvatarFallbackText>{reader.displayName}</AvatarFallbackText>
                    {reader.pictureUrl == null ? null : (
                      <AvatarImage source={{ uri: reader.pictureUrl }} />
                    )}
                  </Avatar>
                </Box>
              ))}
            </HStack>
            <Text size="xs" numberOfLines={1} className="flex-1 text-fg-subtle">
              {describeReaders(readers)}
            </Text>
          </HStack>
        )}
      </Animated.View>

      <Animated.View
        style={bottomStyle}
        pointerEvents={shown ? 'auto' : 'none'}
        accessibilityElementsHidden={!shown}
        importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
        className="absolute inset-x-0 bottom-0 border-t border-hairline bg-background">
        <VStack
          className="px-6 pt-4"
          style={{ paddingBottom: Math.max(insets.bottom, 12) + 8 }}>
          <ReaderScrubber
            page={page}
            pageCount={total}
            outline={outline}
            uri={uri}
            password={password}
            theme={theme}
            onScrubTo={onScrubTo}
            onOpenJump={onOpenJump}
            onOpenSettings={onOpenSettings}
            onStep={onStep}
          />
        </VStack>
      </Animated.View>
    </>
  );
}

/**
 * "Amina and Grace are reading this."
 *
 * Names rather than a count, up to two, because "2 people are reading this" is
 * a fact nobody can do anything with and a name is somebody you might message.
 * Past two it becomes a count, since a list of five names is a line of
 * ellipsis.
 */
function describeReaders(
  readers: readonly { displayName: string }[],
): string {
  const names = readers.map((reader) => reader.displayName.split(' ')[0]);
  if (names.length === 1) {
    return `${names[0]} is reading this`;
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]} are reading this`;
  }
  return `${names[0]}, ${names[1]} and ${names.length - 2} more are reading this`;
}
