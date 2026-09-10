import React from 'react';

import { ActionSheetPanel } from '@/components/layout/action-sheet-panel';
import { Button, ButtonText } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

/**
 * Confirming that access is going away.
 *
 * An `AlertDialog` because it has a consequence, which is the rule
 * `use-app-toast.tsx` states — a toast is for something the reader need not act
 * on, and this is not that.
 *
 * The second paragraph is the reason this component exists rather than a
 * one-line confirm. Removing access is immediate for everything the account
 * mediates and reaches nothing already downloaded, and a reader who finds that
 * out afterwards has been misled by a dialog that said "remove access" and
 * meant something narrower. So it is said here, before the tap, in the case
 * where it is actually true — and left out when nothing was ever downloaded,
 * because a warning about a file that does not exist is noise.
 */
export function RemoveAccessDialog({
  isOpen,
  onClose,
  onConfirm,
  name,
  downloaded,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  name: string;
  /** Whether they were ever allowed to take a copy. */
  downloaded: boolean;
}) {
  return (
    <ActionSheetPanel isOpen={isOpen} onClose={onClose}>
      <VStack space="md">
        <VStack space="sm">
          <Heading size="md" className="text-foreground">
            Remove {name}&apos;s access?
          </Heading>
          <Text size="sm" className="text-muted-foreground">
            They will not be able to open this document again, and anything they wrote on it
            stops syncing to you.
          </Text>
          {downloaded ? (
            <Text size="sm" className="text-muted-foreground">
              They were allowed to download it. If they did, that copy is on their device and
              this does not delete it — no setting here can.
            </Text>
          ) : null}
        </VStack>
        <HStack className="justify-end" space="sm">
          <Button variant="outline" size="sm" onPress={onClose}>
            <ButtonText>Cancel</ButtonText>
          </Button>
          <Button variant="destructive" size="sm" onPress={onConfirm}>
            <ButtonText>Remove access</ButtonText>
          </Button>
        </HStack>
      </VStack>
    </ActionSheetPanel>
  );
}
