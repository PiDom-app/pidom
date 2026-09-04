import { BookOpen, Check, Columns2, Maximize, Rows3, RectangleVertical } from 'lucide-react-native';
import React from 'react';

import {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
} from '@/components/ui/actionsheet';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import type { ReadingMode } from '@convex/model/library';
import type { FitPolicy } from '@/stores/reader-store';

/**
 * How a document reads.
 *
 * An `Actionsheet`, matching `DocumentActions` and `ContentsSheet` — full-width
 * targets in thumb reach, over a page the reader is still looking at.
 *
 * **Two pages is disabled, not hidden.** A control that vanishes on a small
 * screen reads as a bug to somebody who has seen it on their tablet, and the
 * sentence under it is the whole answer: turn the device, or use a bigger one.
 *
 * The last two rows are about this phone rather than about this book, which is
 * what the closing line says. Mode syncs because how a document reads is a
 * property of the document; a wake lock is a property of a room.
 */

const MODES: readonly {
  mode: ReadingMode;
  glyph: typeof Rows3;
  label: string;
  note: string;
}[] = [
  {
    mode: 'continuous',
    glyph: Rows3,
    label: 'Continuous',
    note: 'One long scroll, fit to the width of the screen.',
  },
  {
    mode: 'single',
    glyph: RectangleVertical,
    label: 'One page at a time',
    note: 'Swipe sideways. The whole page is always on screen.',
  },
  {
    mode: 'spread',
    glyph: Columns2,
    label: 'Two pages',
    note: 'Side by side, like an open book.',
  },
];

const FITS: readonly { fit: FitPolicy; label: string }[] = [
  { fit: 'width', label: 'Width' },
  { fit: 'height', label: 'Height' },
  { fit: 'both', label: 'Whole page' },
];

export function ReaderModesSheet({
  isOpen,
  onClose,
  title,
  mode,
  fit,
  canSpread,
  onPickMode,
  onPickFit,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  mode: ReadingMode;
  fit: FitPolicy;
  /** False on a narrow screen, which is what disables Two pages. */
  canSpread: boolean;
  onPickMode: (mode: ReadingMode) => void;
  onPickFit: (fit: FitPolicy) => void;
}) {
  return (
    <Actionsheet isOpen={isOpen} onClose={onClose}>
      <ActionsheetBackdrop />
      <ActionsheetContent className="rounded-t-md border-t border-border bg-elevated pb-7">
        <ActionsheetDragIndicatorWrapper>
          <ActionsheetDragIndicator />
        </ActionsheetDragIndicatorWrapper>

        <HStack className="w-full items-center px-6 pt-2.5 pb-3.5" space="lg">
          <Icon as={BookOpen} size="lg" className="text-fg-muted" />
          <VStack className="flex-1">
            <Text size="md" className="font-semibold text-foreground">
              How it reads
            </Text>
            <Text size="xs" numberOfLines={1} className="mt-0.5 text-fg-subtle">
              {title}
            </Text>
          </VStack>
        </HStack>

        <Divider className="bg-hairline" />

        <VStack className="w-full pt-1">
          {MODES.map((option) => {
            const off = option.mode === 'spread' && !canSpread;
            return (
              <Pressable
                key={option.mode}
                onPress={() => {
                  if (!off) {
                    onPickMode(option.mode);
                  }
                }}
                disabled={off}
                accessibilityRole="button"
                accessibilityState={{ disabled: off, selected: option.mode === mode }}
                accessibilityLabel={option.label}
                className="px-6 py-3 data-[active=true]:bg-hover">
                <HStack className="items-center" space="lg">
                  <Icon
                    as={option.glyph}
                    size="lg"
                    className={off ? 'text-fg-disabled' : 'text-fg-muted'}
                  />
                  <VStack className="flex-1">
                    <Text size="md" className={off ? 'text-fg-disabled' : 'text-foreground'}>
                      {option.label}
                    </Text>
                    <Text size="xs" className="mt-0.5 text-fg-subtle">
                      {off
                        ? 'Needs a wider screen. Turn a tablet sideways, or rotate this phone.'
                        : option.note}
                    </Text>
                  </VStack>
                  {option.mode === mode && !off ? (
                    <Icon as={Check} size="md" className="text-primary" />
                  ) : null}
                </HStack>
              </Pressable>
            );
          })}

          <Divider className="my-1 bg-hairline" />

          <HStack className="items-center px-6 py-3" space="lg">
            <Icon as={Maximize} size="lg" className="text-fg-muted" />
            <VStack className="flex-1">
              <Text size="md" className="text-foreground">
                Fit
              </Text>
              {mode === 'continuous' ? null : (
                <Text size="xs" className="mt-0.5 text-fg-subtle">
                  Set by the mode. One page and two pages size the page themselves.
                </Text>
              )}
            </VStack>
            {/* Only offered where it is honoured. It used to be live in every
                mode, where tapping it reloaded the whole document and changed
                nothing on screen. */}
            {mode === 'continuous' ? (
              <HStack space="xs">
                {FITS.map((option) => (
                  <Pressable
                    key={option.fit}
                    onPress={() => onPickFit(option.fit)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: option.fit === fit }}
                    accessibilityLabel={`Fit ${option.label}`}
                    className={
                      option.fit === fit
                        ? 'rounded-md bg-primary-tint px-2.5 py-1.5'
                        : 'rounded-md px-2.5 py-1.5 data-[active=true]:bg-hover'
                    }>
                    <Text
                      size="xs"
                      className={option.fit === fit ? 'text-primary' : 'text-fg-muted'}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </HStack>
            ) : null}
          </HStack>
        </VStack>
      </ActionsheetContent>
    </Actionsheet>
  );
}
