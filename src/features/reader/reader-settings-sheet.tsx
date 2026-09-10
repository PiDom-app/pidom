import { Eye, Maximize, Rows3, Settings, Sun } from 'lucide-react-native';
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
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import type { ReadingMode } from '@convex/model/library';
import type { FitPolicy, PageTint } from '@/stores/reader-store';

/**
 * Reader settings.
 *
 * Split from the modes sheet, which had grown into both. `How it reads` is a
 * question about a document; this is a question about a screen in a room, and
 * the closing line says which of these follows the reader to another device.
 *
 * **`Follow the document` is the tint control, phrased the right way round.**
 * On — the default — means pages render as they were authored, which is what a
 * PDF reader owes a PDF. Turning it off is the reader deciding they would
 * rather have a dimmer or warmer page than a faithful one, and that is a choice
 * worth making explicitly rather than inheriting from a theme toggle.
 */

const MODE_LABEL: Record<ReadingMode, string> = {
  continuous: 'Continuous',
  single: 'One page at a time',
  spread: 'Two pages',
};

const FIT_LABEL: Record<FitPolicy, string> = {
  width: 'Width',
  height: 'Height',
  both: 'Whole page',
};

const TINTS: readonly { tint: Exclude<PageTint, 'none'>; label: string }[] = [
  { tint: 'dim', label: 'Dim' },
  { tint: 'warm', label: 'Warm' },
];

export function ReaderSettingsSheet({
  isOpen,
  onClose,
  title,
  mode,
  fit,
  tint,
  keepAwake,
  onOpenModes,
  onKeepAwake,
  onTint,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  mode: ReadingMode;
  fit: FitPolicy;
  tint: PageTint;
  keepAwake: boolean;
  onOpenModes: () => void;
  onKeepAwake: (on: boolean) => void;
  onTint: (tint: PageTint) => void;
}) {
  const faithful = tint === 'none';

  return (
    <Actionsheet isOpen={isOpen} onClose={onClose}>
      <ActionsheetBackdrop />
      <ActionsheetContent className="rounded-t-md border-t border-border bg-elevated pb-7">
        <ActionsheetDragIndicatorWrapper>
          <ActionsheetDragIndicator />
        </ActionsheetDragIndicatorWrapper>

        <HStack className="w-full items-center px-4 pt-2.5 pb-3.5" space="lg">
          <Icon as={Settings} size="lg" className="text-fg-muted" />
          <VStack className="flex-1">
            <Text size="md" className="font-semibold text-foreground">
              Reader
            </Text>
            <Text size="xs" numberOfLines={1} className="mt-0.5 text-fg-subtle">
              {title}
            </Text>
          </VStack>
        </HStack>

        <Divider className="bg-hairline" />

        <VStack className="w-full pt-1">
          <Pressable
            onPress={onOpenModes}
            accessibilityRole="button"
            accessibilityLabel={`How it reads. ${MODE_LABEL[mode]}.`}
            className="px-4 py-2 data-[active=true]:bg-hover">
            <HStack className="items-center" space="lg">
              <Icon as={Rows3} size="lg" className="text-fg-muted" />
              <Text size="md" className="flex-1 text-foreground">
                How it reads
              </Text>
              <Text size="sm" className="text-fg-subtle">
                {MODE_LABEL[mode]}
              </Text>
            </HStack>
          </Pressable>

          <HStack className="items-center px-4 py-2" space="lg">
            <Icon as={Maximize} size="lg" className="text-fg-muted" />
            <Text size="md" className="flex-1 text-foreground">
              Fit
            </Text>
            <Text size="sm" className="text-fg-subtle">
              {mode === 'continuous' ? FIT_LABEL[fit] : 'Set by the mode'}
            </Text>
          </HStack>

          <Divider className="my-1 bg-hairline" />

          <HStack className="items-center px-4 py-2" space="lg">
            <Icon as={Eye} size="lg" className="text-fg-muted" />
            <VStack className="flex-1">
              <Text size="md" className="text-foreground">
                Keep the screen awake
              </Text>
              <Text size="xs" className="mt-0.5 text-fg-subtle">
                While this document is open, and only while it is.
              </Text>
            </VStack>
            <Switch
              value={keepAwake}
              onValueChange={onKeepAwake}
              accessibilityLabel="Keep the screen awake"
            />
          </HStack>

          <HStack className="items-center px-4 py-2" space="lg">
            <Icon as={Sun} size="lg" className="text-fg-muted" />
            <VStack className="flex-1">
              <Text size="md" className="text-foreground">
                Follow the document
              </Text>
              <Text size="xs" className="mt-0.5 text-fg-subtle">
                Pages render as they were authored. Dark mode changes what is around them.
              </Text>
            </VStack>
            <Switch
              value={faithful}
              onValueChange={(on) => onTint(on ? 'none' : 'dim')}
              accessibilityLabel="Follow the document"
            />
          </HStack>

          {faithful ? null : (
            <HStack className="items-center px-4 pt-1 pb-3" space="lg">
              <VStack className="flex-1">
                <Text size="sm" className="text-fg-muted">
                  Over the page
                </Text>
                <Text size="xs" className="mt-0.5 text-fg-subtle">
                  A layer over the page, not a change to it — the document is not inverted.
                </Text>
              </VStack>
              <HStack space="xs">
                {TINTS.map((option) => (
                  <Pressable
                    key={option.tint}
                    onPress={() => onTint(option.tint)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: option.tint === tint }}
                    accessibilityLabel={option.label}
                    className={
                      option.tint === tint
                        ? 'rounded-md bg-primary-tint px-2.5 py-1.5'
                        : 'rounded-md px-2.5 py-1.5 data-[active=true]:bg-hover'
                    }>
                    <Text
                      size="xs"
                      className={option.tint === tint ? 'text-primary' : 'text-fg-muted'}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </HStack>
            </HStack>
          )}

          <Text size="xs" className="px-4 pt-2 pb-1 text-fg-subtle">
            How it reads follows the document to your other devices. Everything else stays on
            this phone.
          </Text>
        </VStack>
      </ActionsheetContent>
    </Actionsheet>
  );
}
