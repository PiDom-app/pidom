import { Target } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';

import {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
} from '@/components/ui/actionsheet';
import { Button, ButtonText } from '@/components/ui/button';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Input, InputField } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

/**
 * Typing a page number.
 *
 * The third of the three ways to reach a page, after the Contents and the
 * track, and the only one that is exact. All three end at the same
 * `goToPage` — see `reader-commands.ts` for why that matters.
 *
 * The field is bounded here as well as in the command, because a reader who
 * types 9999 into a 499-page book should see the button say 499 rather than
 * press it and find out. Nothing is committed while typing: a numeric field
 * that navigates on every keystroke sends somebody to page 4 on their way to
 * page 438.
 */
export function PageJumpSheet({
  isOpen,
  onClose,
  title,
  page,
  pageCount,
  onJump,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  page: number;
  pageCount: number;
  onJump: (page: number) => void;
}) {
  const [typed, setTyped] = useState(String(page));

  // Reopening starts from where the reader is, not from what they typed last
  // time. The sheet is a question about now.
  useEffect(() => {
    if (isOpen) {
      setTyped(String(page));
    }
  }, [isOpen, page]);

  const parsed = Number.parseInt(typed, 10);
  const target = Number.isFinite(parsed)
    ? Math.min(pageCount, Math.max(1, parsed))
    : null;

  return (
    <Actionsheet isOpen={isOpen} onClose={onClose}>
      <ActionsheetBackdrop />
      <ActionsheetContent className="rounded-t-md border-t border-border bg-elevated pb-7">
        <ActionsheetDragIndicatorWrapper>
          <ActionsheetDragIndicator />
        </ActionsheetDragIndicatorWrapper>

        <HStack className="w-full items-center px-6 pt-2.5 pb-3.5" space="lg">
          <Icon as={Target} size="lg" className="text-fg-muted" />
          <VStack className="flex-1">
            <Text size="md" className="font-semibold text-foreground">
              Go to page
            </Text>
            <Text size="xs" numberOfLines={1} className="mt-0.5 text-fg-subtle">
              {title}
            </Text>
          </VStack>
          <Text size="xs" className="text-fg-subtle">
            {`of ${pageCount}`}
          </Text>
        </HStack>

        <Divider className="bg-hairline" />

        <VStack className="w-full px-6 pt-5">
          <Input className="h-12 border-primary">
            <InputField
              value={typed}
              onChangeText={setTyped}
              keyboardType="number-pad"
              autoFocus
              selectTextOnFocus
              accessibilityLabel="Page number"
              className="text-center text-foreground"
            />
          </Input>

          <Button
            size="lg"
            className="mt-5"
            isDisabled={target === null}
            onPress={() => {
              if (target !== null) {
                onJump(target);
                onClose();
              }
            }}>
            <ButtonText>{target === null ? 'Enter a page' : `Go to page ${target}`}</ButtonText>
          </Button>

          <Text size="xs" className="mt-3 text-center text-fg-subtle">
            {`1 to ${pageCount}`}
          </Text>
        </VStack>
      </ActionsheetContent>
    </Actionsheet>
  );
}
