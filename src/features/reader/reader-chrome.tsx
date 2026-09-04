import { ArrowLeft, Bookmark, ListTree, MoreHorizontal, TextSearch } from 'lucide-react-native';
import React, { useEffect } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { ThemeName } from '@/design/tokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  hasOutline,
  canSearch,
  onBack,
  onContents,
  onSearch,
  isBookmarked,
  onToggleBookmark,
  onMore,
  onScrubTo,
  onOpenJump,
  onOpenModes,
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
  hasOutline: boolean;
  canSearch: boolean;
  onBack: () => void;
  onContents: () => void;
  onSearch: () => void;
  /** Whether the page currently on screen is one of the marked ones. */
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  onMore: () => void;
  /** Committed on release, never during the drag. */
  onScrubTo: (page: number) => void;
  onOpenJump: () => void;
  onOpenModes: () => void;
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

          {/* Only when the PDF actually declares one. A Contents button that
              opens an empty sheet is a button that lies. */}
          {hasOutline ? (
            <Pressable
              onPress={onContents}
              accessibilityRole="button"
              accessibilityLabel="Contents"
              className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
              <Icon as={ListTree} size="lg" className="text-foreground" />
            </Pressable>
          ) : null}

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

          <Pressable
            onPress={onMore}
            accessibilityRole="button"
            accessibilityLabel="Document actions"
            className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
            <Icon as={MoreHorizontal} size="lg" className="text-foreground" />
          </Pressable>
        </HStack>
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
            onOpenModes={onOpenModes}
            onStep={onStep}
          />
        </VStack>
      </Animated.View>
    </>
  );
}
