import { LogOut } from 'lucide-react-native';
import React, { useState } from 'react';

import { ActionSheetPanel } from '@/components/layout/action-sheet-panel';
import { Button, ButtonIcon, ButtonText } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { useSession } from '@/features/auth/session-provider';
import { closeDatabase } from '@/features/library/local/db';

/**
 * Sign out, behind a confirmation.
 *
 * A bottom sheet because this needs acknowledging: it
 * ends the session, and once local documents arrive it will have consequences
 * for what stays on the device. A `Toast` would be the wrong shape entirely —
 * there would be nothing to confirm.
 */
export function SignOutAction() {
  const { signOut } = useSession();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* A button rather than a row, and the last thing on the screen.
          Everything above it is a fact or a place to go; this is the one
          irreversible act, and a destructive act dressed as a list row is a
          destructive act somebody taps by accident on the way past. */}
      <Button
        variant="outline"
        size="lg"
        onPress={() => setOpen(true)}
        className="mt-2 h-11 border-destructive">
        <ButtonIcon as={LogOut} className="text-destructive" />
        <ButtonText className="text-destructive">Sign out</ButtonText>
      </Button>

      <ActionSheetPanel isOpen={open} onClose={() => setOpen(false)}>
        <VStack space="md">
          <VStack space="sm">
            <Heading size="md" className="text-foreground">
              Sign out of Pidom?
            </Heading>
            <Text size="sm" className="text-muted-foreground">
              Your library stays in your account and your documents stay on this
              device. Sign back in with Google to pick up where you left off.
            </Text>
          </VStack>
          <HStack className="justify-end" space="sm">
            <Button variant="outline" size="sm" onPress={() => setOpen(false)}>
              <ButtonText>Cancel</ButtonText>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onPress={() => {
                // The handle on this account's database is closed, so nothing
                // of one reader's library stays open into the next one's
                // session. The file is left where it is, encrypted, under a key
                // in this device's keychain.
                //
                // Nothing is deleted. The PDFs and their database live under
                // this account's own profile id, nothing else can reach them,
                // and removing a reader's documents is not what "sign out"
                // means — it is what "delete" means, and there is a different
                // button for that.
                void closeDatabase();

                // The dialog closes with the screen it sits on: the router
                // swaps to the sign-in stack as soon as the session clears.
                setOpen(false);
                void signOut();
              }}>
              <ButtonText>Sign out</ButtonText>
            </Button>
          </HStack>
        </VStack>
      </ActionSheetPanel>
    </>
  );
}
