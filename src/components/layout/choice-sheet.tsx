import { Check } from 'lucide-react-native';
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

export type Choice = {
  value: string;
  label: string;
  note?: string;
  selected: boolean;
};

/**
 * One of a fixed few, chosen from a sheet.
 *
 * A sheet rather than a screen, which is the exception `docs/design.md` allows:
 * none of these lists has a height that is the reader's data — the longest is
 * six rows and will never be seven — so there is nothing here for a route to
 * hold. `time-sheet.tsx` is the same shape for the same reason, and this is
 * modelled on it.
 *
 * In `components/layout/` rather than beside the screen that first needed it,
 * because the download settings and the sharing settings both pick from a short
 * fixed list and a second copy would be a second place for the tick to drift
 * into a radio.
 *
 * A `Check` on the current value rather than a radio, matching every other
 * choice in this application: the vocabulary is a tick, and introducing a
 * second one for the same job would be a second vocabulary.
 */
export function ChoiceSheet({
  isOpen,
  onClose,
  title,
  subtitle,
  choices,
  onSelect,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  choices: Choice[];
  onSelect: (value: string) => void;
}) {
  return (
    <Actionsheet isOpen={isOpen} onClose={onClose}>
      <ActionsheetBackdrop />
      <ActionsheetContent className="rounded-t-md border-t border-border bg-elevated pb-7">
        <ActionsheetDragIndicatorWrapper>
          <ActionsheetDragIndicator />
        </ActionsheetDragIndicatorWrapper>

        <VStack className="w-full px-4 pt-2.5 pb-3.5">
          <Text size="md" className="font-semibold text-foreground">
            {title}
          </Text>
          {subtitle === undefined ? null : (
            <Text size="xs" className="mt-0.5 text-fg-subtle">
              {subtitle}
            </Text>
          )}
        </VStack>
        <Divider className="bg-hairline" />

        <VStack className="w-full pt-1">
          {choices.map((choice) => (
            <Pressable
              key={choice.value}
              onPress={() => onSelect(choice.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: choice.selected }}
              accessibilityLabel={choice.label}
              className="px-4 py-2.5 data-[active=true]:bg-hover"
            >
              <HStack className="items-center" space="lg">
                <VStack className="flex-1">
                  <Text size="md" className="text-foreground">
                    {choice.label}
                  </Text>
                  {choice.note === undefined ? null : (
                    <Text size="xs" className="mt-0.5 text-fg-subtle">
                      {choice.note}
                    </Text>
                  )}
                </VStack>
                {choice.selected ? <Icon as={Check} size="md" className="text-primary" /> : null}
              </HStack>
            </Pressable>
          ))}
        </VStack>
      </ActionsheetContent>
    </Actionsheet>
  );
}
