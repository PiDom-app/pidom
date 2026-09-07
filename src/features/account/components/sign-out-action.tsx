import { LogOut } from 'lucide-react-native';
import React, { useState } from 'react';

import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
} from '@/components/ui/alert-dialog';
import { Button, ButtonText } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { useSession } from '@/features/auth/session-provider';
import { closeDatabase } from '@/features/library/local/db';

/**
 * Sign out, behind a confirmation.
 *
 * An `AlertDialog` rather than a `Modal` because this needs acknowledging: it
 * ends the session, and once local documents arrive it will have consequences
 * for what stays on the device. A `Toast` would be the wrong shape entirely —
 * there would be nothing to confirm.
 */
export function SignOutAction() {
  const { signOut } = useSession();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        className="rounded-md px-1 py-3 data-[active=true]:bg-hover">
        <HStack className="items-center" space="md">
          <Icon as={LogOut} size="lg" className="text-destructive" />
          <Text size="md" className="text-destructive">
            Sign out
          </Text>
        </HStack>
      </Pressable>

      <AlertDialog isOpen={open} onClose={() => setOpen(false)} size="md">
        <AlertDialogBackdrop />
        <AlertDialogContent className="rounded-md border border-border bg-popover">
          <AlertDialogHeader>
            <Heading size="md" className="text-foreground">
              Sign out of Pidom?
            </Heading>
          </AlertDialogHeader>
          <AlertDialogBody className="mt-2 mb-4">
            <Text size="sm" className="text-muted-foreground">
              Your library stays in your account and your documents stay on this
              device. Sign back in with Google to pick up where you left off.
            </Text>
          </AlertDialogBody>
          <AlertDialogFooter>
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
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
