import { Rows3 } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { THUMBNAIL_PAGE_MAX } from '@convex/model/limits';
import type { ThemeName } from '@/design/tokens';

import { chapterAt, type OutlineEntry } from './outline';
import { PagePreview } from './page-preview';

/**
 * The page position, and a way to drag it.
 *
 * A 500-page document has no other realistic way to reach page 438: swiping is
 * three hundred gestures and the Contents only lands on chapter starts. So the
 * progress track is a control, and the page count above it is one too — tapping
 * `142 of 499` is the obvious way to ask for a different number.
 *
 * **The document does not move during the drag.** Only on release. Asking the
 * renderer to turn to each page under a moving finger is asking it to render
 * three hundred pages nobody will look at. What follows the finger is the thumb
 * and the card, both driven by shared values on the UI thread; JavaScript is
 * involved at the start and the end and not in between.
 *
 * **The card is mounted, not faded.** It used to be an always-present
 * `Animated.View` at zero opacity, which meant it always occupied layout — the
 * bar sat permanently at its dragging height and the resting height never
 * existed. Now the resting bar is the resting bar.
 *
 * The ticks are the document's own chapters, and appear only while dragging:
 * they are an aid to aiming, and a row of marks under a static progress bar is
 * decoration.
 */

/** Below this the track is a readout: two pages is not worth dragging between. */
const MIN_PAGES = 3;

/**
 * The page a fraction of the track points at.
 *
 * A worklet, because the pan handlers run on the UI thread and calling a
 * JavaScript-thread function from one is the thing this file is trying to do
 * less of.
 */
function pageAt(fraction: number, pageCount: number): number {
  'worklet';
  return Math.min(pageCount, Math.max(1, Math.round(fraction * pageCount)));
}

export function ReaderScrubber({
  page,
  pageCount,
  outline,
  uri,
  password,
  theme,
  onScrubTo,
  onOpenJump,
  onOpenSettings,
  onStep,
}: {
  page: number;
  /** `0` while the renderer is still counting. */
  pageCount: number;
  outline: readonly OutlineEntry[] | undefined;
  /** For the preview, which is the same file the canvas has open. */
  uri: string;
  password?: string;
  theme: ThemeName;
  onScrubTo: (page: number) => void;
  onOpenJump: () => void;
  onOpenSettings: () => void;
  /** `+1` / `-1`, for the assistive-technology adjust actions. */
  onStep: (by: 1 | -1) => void;
}) {
  const [width, setWidth] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [preview, setPreview] = useState(page);

  const draggable = pageCount >= MIN_PAGES && width > 0;
  const at = pageCount > 0 ? Math.min(1, Math.max(0, page / pageCount)) : 0;

  const held = useSharedValue(at);
  const active = useSharedValue(0);
  // The last page number handed to JavaScript. A drag produces a touch event
  // every few milliseconds and almost all of them land on the page already
  // shown, so without this the bubble re-rendered ~50 times a second to display
  // the same number — and React warned about the updates it could not land.
  const announced = useSharedValue(-1);

  // While nobody is dragging, the thumb follows the page the renderer reports —
  // and while somebody is, it does not, or their finger would fight the pages
  // turning underneath it. A plain effect: `at` is a JavaScript value, so there
  // is nothing here for a worklet to do.
  useEffect(() => {
    if (active.value === 0) {
      held.value = at;
    }
  }, [at, active, held]);

  // `runOnJS` needs stable identities, and a worklet cannot call a setter.
  const setDragging = useCallback((next: boolean) => setScrubbing(next), []);
  const setPreviewPage = useCallback((next: number) => setPreview(next), []);
  const commit = useCallback(
    (fraction: number) => {
      onScrubTo(Math.min(pageCount, Math.max(1, Math.round(fraction * pageCount))));
    },
    [pageCount, onScrubTo],
  );

  const pan = Gesture.Pan()
    .enabled(draggable)
    // The track is a few points tall and a fingertip is not, so the gesture is
    // claimed from the first pixel rather than after a threshold the reader
    // would feel as the control ignoring them.
    .minDistance(0)
    .onBegin((event) => {
      active.value = 1;
      held.value = Math.min(1, Math.max(0, event.x / width));
      const page = pageAt(held.value, pageCount);
      announced.value = page;
      runOnJS(setDragging)(true);
      runOnJS(setPreviewPage)(page);
    })
    .onUpdate((event) => {
      held.value = Math.min(1, Math.max(0, event.x / width));
      // The thumb keeps following the finger on the UI thread; only a change of
      // page crosses to JavaScript.
      const page = pageAt(held.value, pageCount);
      if (page !== announced.value) {
        announced.value = page;
        runOnJS(setPreviewPage)(page);
      }
    })
    .onFinalize(() => {
      active.value = 0;
      announced.value = -1;
      runOnJS(setDragging)(false);
      runOnJS(commit)(held.value);
    });

  const fillStyle = useAnimatedStyle(() => ({ width: `${held.value * 100}%` }));
  const thumbStyle = useAnimatedStyle(() => ({
    left: `${held.value * 100}%`,
    opacity: withTiming(active.value, { duration: 120 }),
    transform: [{ translateX: -9 }, { scale: 0.6 + active.value * 0.4 }],
  }));

  // A preview is a second document handle. Worth it for the seconds of a drag
  // on a book, refused on something long enough that opening it twice is a
  // stall — which is what `THUMBNAIL_PAGE_MAX` was declared for.
  const showPreview = scrubbing && pageCount > 0 && pageCount <= THUMBNAIL_PAGE_MAX;
  const chapter = chapterAt(outline, scrubbing ? preview : page);

  return (
    <VStack>
      {scrubbing ? (
        <View className="items-center pb-3" pointerEvents="none">
          <HStack
            className="items-center rounded-md border border-border bg-elevated p-2"
            space="md"
          >
            {showPreview ? (
              <PagePreview
                uri={uri}
                page={preview}
                password={password}
                theme={theme}
                width={38}
                height={54}
              />
            ) : null}
            <VStack>
              <Text size="sm" className="font-semibold text-foreground">
                {`Page ${preview}`}
              </Text>
              <Text size="xs" numberOfLines={1} className="mt-0.5 max-w-[180px] text-fg-subtle">
                {chapter ?? 'Release to go there'}
              </Text>
            </VStack>
          </HStack>
        </View>
      ) : null}

      <HStack className="items-center justify-between">
        <Pressable
          onPress={onOpenJump}
          disabled={pageCount === 0}
          accessibilityRole="button"
          accessibilityLabel={
            pageCount > 0 ? `Page ${page} of ${pageCount}. Go to a page.` : `Page ${page}`
          }
          className="-mx-2 rounded-md px-2 py-1 data-[active=true]:bg-hover"
        >
          <Text size="xs" className={scrubbing ? 'text-foreground' : 'text-fg-muted'}>
            {pageCount > 0 ? `${scrubbing ? preview : page} of ${pageCount}` : `Page ${page}`}
          </Text>
        </Pressable>

        <HStack className="items-center" space="sm">
          <Text size="xs" className="text-fg-subtle">
            {pageCount > 0 ? `${Math.round((page / pageCount) * 100)}%` : ''}
          </Text>
          <Pressable
            onPress={onOpenSettings}
            accessibilityRole="button"
            accessibilityLabel="Reading settings"
            className="-mr-1.5 h-8 w-8 items-center justify-center rounded-md data-[active=true]:bg-hover"
          >
            <Icon as={Rows3} size="sm" className="text-fg-muted" />
          </Pressable>
        </HStack>
      </HStack>

      <GestureDetector gesture={pan}>
        {/* The hit area is the whole strip, not the line inside it. A control
            you have to hit precisely on a phone is a control nobody uses twice.

            `adjustable` is claimed only alongside the actions that honour it —
            declaring the role and then ignoring every increment, as this did,
            tells a screen reader the control works and then wastes the swipe. */}
        <View
          className="mt-1.5 justify-center py-2.5"
          accessibilityRole="adjustable"
          accessibilityLabel="Page position"
          accessibilityValue={{ min: 1, max: Math.max(1, pageCount), now: page }}
          accessibilityActions={ADJUST_ACTIONS}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') {
              onStep(1);
            } else if (event.nativeEvent.actionName === 'decrement') {
              onStep(-1);
            }
          }}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        >
          <View className={scrubbing ? 'h-1 rounded-md bg-border' : 'h-0.5 rounded-md bg-border'}>
            <Animated.View
              style={fillStyle}
              className={scrubbing ? 'h-1 rounded-md bg-primary' : 'h-0.5 rounded-md bg-primary'}
            />
            {scrubbing
              ? outline?.map((entry) => (
                  <View
                    key={`${entry.page}-${entry.title}`}
                    pointerEvents="none"
                    className="absolute -top-1.5 h-1.5 w-px bg-border-strong"
                    style={{
                      left: `${Math.min(100, (entry.page / Math.max(1, pageCount)) * 100)}%`,
                    }}
                  />
                ))
              : null}
            <Animated.View
              style={thumbStyle}
              pointerEvents="none"
              className="absolute -top-2 h-[18px] w-[18px] rounded-full bg-primary"
            />
          </View>
        </View>
      </GestureDetector>
    </VStack>
  );
}

/** What VoiceOver and TalkBack route a swipe-up / swipe-down to. */
const ADJUST_ACTIONS = [
  { name: 'increment', label: 'Next page' },
  { name: 'decrement', label: 'Previous page' },
] as const;
