import React from 'react';

import { ActionSheetPanel } from '@/components/layout/action-sheet-panel';
import { Button, ButtonText } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

/**
 * A destructive action, asked about first.
 *
 * `RemoveAccessDialog` next door is the same shape with one screen's wording
 * baked in; this is the general one, for the two on the group screen that used
 * to fire on the tap itself — deleting a group and removing somebody from it,
 * both of which take documents away from people and neither of which can be
 * undone by tapping again.
 *
 * `lines` rather than one body string because both of these have a second
 * sentence that only applies sometimes, and a paragraph that reads "and, if
 * applicable, …" is worse than not saying it.
 */
export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  lines,
  confirmLabel,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  lines: string[];
  confirmLabel: string;
}) {
  return (
    <ActionSheetPanel isOpen={isOpen} onClose={onClose}>
      <VStack space="md">
        <VStack space="sm">
          <Heading size="md" className="text-foreground">
            {title}
          </Heading>
          {lines.map((line) => (
            <Text key={line} size="sm" className="text-muted-foreground">
              {line}
            </Text>
          ))}
        </VStack>
        <HStack className="justify-end" space="sm">
          <Button variant="outline" size="sm" onPress={onClose}>
            <ButtonText>Cancel</ButtonText>
          </Button>
          <Button variant="destructive" size="sm" onPress={onConfirm}>
            <ButtonText>{confirmLabel}</ButtonText>
          </Button>
        </HStack>
      </VStack>
    </ActionSheetPanel>
  );
}
