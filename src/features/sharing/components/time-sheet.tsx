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
import { ScrollView } from '@/components/ui/scroll-view';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

/**
 * Picking a time of day, in half hours.
 *
 * A list rather than a platform date picker, and the reason is worth stating:
 * `@react-native-community/datetimepicker` is a dependency, two native
 * behaviours and two sets of theming to fight, for a value that is one of
 * forty-eight. Quiet hours are not a calendar appointment — nobody sets them to
 * 22:17 — so the list is both smaller and easier to hit than a spinner.
 *
 * The height is fixed rather than fitted to its content, which is the one thing
 * a sheet full of rows has to get right: forty-eight rows would otherwise push
 * the sheet past the top of the screen and take the drag indicator with it.
 */
export function TimeSheet({
  isOpen,
  onClose,
  title,
  value,
  onPick,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** Minutes since midnight, local time. */
  value: number;
  onPick: (minute: number) => void;
}) {
  const times = React.useMemo(
    () => Array.from({ length: 48 }, (_, index) => index * 30),
    [],
  );

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
        </VStack>
        <Divider className="bg-hairline" />

        <ScrollView style={LIST} contentContainerStyle={CONTENT}>
          {times.map((minute) => {
            const selected = minute === value;
            return (
              <Pressable
                key={minute}
                onPress={() => {
                  onPick(minute);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={formatMinute(minute)}
                className="px-4 py-2 data-[active=true]:bg-hover">
                <HStack className="items-center" space="md">
                  <Text
                    size="md"
                    className={selected ? 'flex-1 text-primary' : 'flex-1 text-foreground'}>
                    {formatMinute(minute)}
                  </Text>
                  {selected ? <Icon as={Check} size="md" className="text-primary" /> : null}
                </HStack>
              </Pressable>
            );
          })}
        </ScrollView>
      </ActionsheetContent>
    </Actionsheet>
  );
}

/** `22:00`, in the 24-hour form the setting is stored in. */
export function formatMinute(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Width belongs in here, not in a `className`.
 *
 * This had `className="w-full"` and `style={{ maxHeight }}` together, and
 * **passing `style` alongside `className` replaces the class-derived styles
 * rather than merging with them** — the rule `docs/design.md` states and this
 * component broke. The width went, the list collapsed to a narrow column, and
 * every label wrapped in the middle of itself: `00:0` on one line and `0` on
 * the next, forty-eight times.
 *
 * The cap is still a cap rather than a height: forty-eight rows would otherwise
 * push the sheet past the top of the screen and take the drag indicator with
 * it.
 */
const LIST = { maxHeight: 320, width: '100%' } as const;
const CONTENT = { paddingBottom: 8 } as const;
