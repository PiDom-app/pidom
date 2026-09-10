import React from 'react';

import {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
  ActionsheetScrollView,
} from '@/components/ui/actionsheet';
import { VStack } from '@/components/ui/vstack';

/**
 * The common shell for confirmations and compact forms.
 *
 * The inner scroll view makes long copy and fields reachable when the software
 * keyboard lifts the sheet. `ActionsheetContent` supplies the matching
 * keyboard spacer, so the scrollable area is never left behind the keyboard.
 */
export function ActionSheetPanel({
  children,
  isOpen,
  isDismissable = true,
  onClose,
}: {
  children: React.ReactNode;
  isOpen: boolean;
  isDismissable?: boolean;
  onClose: () => void;
}) {
  const close = isDismissable ? onClose : () => {};

  return (
    <Actionsheet
      isOpen={isOpen}
      onClose={close}
      closeOnOverlayClick={isDismissable}>
      <ActionsheetBackdrop />
      <ActionsheetContent className="max-h-none rounded-t-md border-t border-border bg-elevated p-0">
        <ActionsheetDragIndicatorWrapper>
          <ActionsheetDragIndicator />
        </ActionsheetDragIndicatorWrapper>
        <ActionsheetScrollView
          className="w-full max-h-[60vh]"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled">
          <VStack className="w-full px-6 pt-2 pb-7">{children}</VStack>
        </ActionsheetScrollView>
      </ActionsheetContent>
    </Actionsheet>
  );
}
