import { Check, Monitor, Moon, Sun } from 'lucide-react-native';
import React from 'react';

import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { useThemeStore, type ThemeMode } from '@/stores/theme-store';

const OPTIONS: { mode: ThemeMode; label: string; hint: string; icon: typeof Sun }[] = [
  { mode: 'light', label: 'Light', hint: 'Always light', icon: Sun },
  { mode: 'dark', label: 'Dark', hint: 'Always dark', icon: Moon },
  { mode: 'system', label: 'System', hint: 'Follow device setting', icon: Monitor },
];

/**
 * Three rows, one check mark. No cards, no segmented control.
 *
 * A list makes room for the hint under each label, which is what distinguishes
 * `System` from whichever of the other two happens to be active right now —
 * the distinction a segmented control cannot show.
 */
export function ThemeControl() {
  const mode = useThemeStore((state) => state.mode);
  const setMode = useThemeStore((state) => state.setMode);

  return (
    <VStack>
      {OPTIONS.map((option) => {
        const selected = option.mode === mode;
        return (
          <Pressable
            key={option.mode}
            onPress={() => setMode(option.mode)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            className="rounded-md px-4 py-2 data-[active=true]:bg-hover"
          >
            <HStack className="items-center" space="md">
              <Icon
                as={option.icon}
                size="lg"
                className={selected ? 'text-primary' : 'text-muted-foreground'}
              />
              <VStack className="flex-1">
                <Text size="md" className="text-foreground">
                  {option.label}
                </Text>
                <Text size="xs" className="text-fg-subtle">
                  {option.hint}
                </Text>
              </VStack>
              {selected ? <Icon as={Check} size="md" className="text-primary" /> : null}
            </HStack>
          </Pressable>
        );
      })}
    </VStack>
  );
}
