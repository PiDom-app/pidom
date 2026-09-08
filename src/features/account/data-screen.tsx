import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Trash2, TriangleAlert, Wifi } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { useMutation } from 'convex/react';

import { api } from '@convex/_generated/api';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { Screen } from '@/components/layout/screen';
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
} from '@/components/ui/alert-dialog';
import { Button, ButtonIcon, ButtonText } from '@/components/ui/button';
import { Divider } from '@/components/ui/divider';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { Input, InputField } from '@/components/ui/input';
import { Pressable } from '@/components/ui/pressable';
import { ScrollView } from '@/components/ui/scroll-view';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { useSession } from '@/features/auth/session-provider';
import { closeDatabase } from '@/features/library/local/db';
import { Notice, ScreenHeader, Section } from '@/features/sharing/components/segments';
import { useConnectionKind } from '@/lib/connectivity';
import { usePreferencesStore } from '@/stores/preferences-store';

/**
 * What this device is allowed to pull down, and how to leave.
 *
 * Three rows and a wall. The first two are about bytes on this handset — a
 * setting and a cache — and the third ends the account, which is why it is
 * below a rule, in the destructive colour, behind a dialog that will not accept
 * a tap.
 *
 * **Wi-Fi only is a device setting and stays on the device.** See
 * `preferences-store.ts`: syncing it to the account would apply a phone's
 * answer about its data plan to a tablet that has none.
 *
 * **Deleting the account is not deleting the app.** Files already downloaded
 * are on this disk under this profile's encrypted database; signing out closes
 * that, and deleting the account removes what the *account* holds. Both are
 * said in the dialog rather than implied, because a reader who finds out
 * afterwards has been misled by a button.
 */
export function DataScreen() {
  const router = useRouter();
  const { signOut } = useSession();
  const showToast = useAppToast();
  const deleteAccount = useMutation(api.account.deleteAccount);

  const wifiOnly = usePreferencesStore((state) => state.wifiOnly);
  const setWifiOnly = usePreferencesStore((state) => state.setWifiOnly);
  const connection = useConnectionKind();

  const [clearing, setClearing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);

  const clearCache = useCallback(async () => {
    setClearing(true);
    try {
      // Covers is what this holds: `expo-image` caps its own disk cache at
      // 100 MB and evicts by least-recently-used, so this is not a leak being
      // plugged — it is a number a reader can see and could not previously
      // move.
      await Image.clearDiskCache();
      await Image.clearMemoryCache();
      showToast({
        id: 'cache',
        tone: 'success',
        title: 'Image cache cleared',
        description: 'Covers will be fetched again the next time you see them.',
      });
    } finally {
      setClearing(false);
    }
  }, [showToast]);

  const confirmDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await deleteAccount({});
      // The handle on this profile's encrypted database closes with the
      // session, as it does on any sign-out. The rows behind the account are
      // already being removed on the server.
      void closeDatabase();
      setConfirming(false);
      await signOut();
    } catch {
      showToast({
        id: 'delete-account',
        tone: 'error',
        title: 'That could not be started',
        description: 'Check your connection and try again.',
      });
      setDeleting(false);
    }
  }, [deleteAccount, showToast, signOut]);

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        glyph={Wifi}
        title="Sync &amp; data"
        subtitle="What this device downloads"
        onBack={() => router.back()}
      />
      <Divider className="bg-hairline" />

      <ScrollView contentContainerStyle={CONTENT}>
        <Section title="Downloads">
          <HStack className="items-center px-6 py-3" space="lg">
            <VStack className="flex-1">
              <Text size="md" className="text-foreground">
                Download over Wi-Fi only
              </Text>
              <Text size="xs" className="mt-0.5 text-fg-subtle">
                {connection === 'cellular' && wifiOnly
                  ? 'You are on mobile data, so downloads are held until Wi-Fi.'
                  : 'Holds full documents until you are on Wi-Fi. Reading what is already here is unaffected.'}
              </Text>
            </VStack>
            <Switch
              value={wifiOnly}
              onValueChange={setWifiOnly}
              accessibilityLabel="Download over Wi-Fi only"
            />
          </HStack>
        </Section>

        <Divider className="mx-6 mt-2 bg-hairline" />

        <Section title="Storage">
          <Pressable
            onPress={() => void clearCache()}
            disabled={clearing}
            accessibilityRole="button"
            accessibilityLabel="Clear image cache"
            className="px-6 py-3 data-[active=true]:bg-hover">
            <VStack>
              <Text size="md" className="text-foreground">
                {clearing ? 'Clearing…' : 'Clear image cache'}
              </Text>
              <Text size="xs" className="mt-0.5 text-fg-subtle">
                Cover thumbnails only. Your documents and your notes are not touched.
              </Text>
            </VStack>
          </Pressable>
          <Pressable
            onPress={() => router.push('/storage')}
            accessibilityRole="button"
            accessibilityLabel="Manage what is on this device"
            className="px-6 py-3 data-[active=true]:bg-hover">
            <VStack>
              <Text size="md" className="text-foreground">
                What is on this device
              </Text>
              <Text size="xs" className="mt-0.5 text-fg-subtle">
                The downloaded documents themselves, and room to remove them.
              </Text>
            </VStack>
          </Pressable>
        </Section>

        <Divider className="mx-6 mt-2 bg-hairline" />

        {/* A button rather than a row, and the last thing on the screen — the
            same shape Sign out takes on the account screen, for the same
            reason. A row that deletes an account is a row somebody taps on the
            way past. */}
        <Section title="Account">
          <VStack className="px-6 pt-1" space="sm">
            <Text size="xs" className="text-fg-subtle">
              Every document, note, group and share. This cannot be undone.
            </Text>
            <Button
              variant="outline"
              size="lg"
              onPress={() => {
                setTyped('');
                setConfirming(true);
              }}
              className="mt-1 h-11 border-destructive">
              <ButtonIcon as={Trash2} className="text-destructive" />
              <ButtonText className="text-destructive">Delete my account</ButtonText>
            </Button>
          </VStack>
        </Section>

        <Notice glyph={TriangleAlert}>
          Anything you were allowed to download and did is a file on somebody&apos;s device.
          Deleting your account removes what your account holds and cannot reach those copies — no
          setting here can.
        </Notice>
      </ScrollView>

      <AlertDialog
        isOpen={confirming}
        onClose={() => (deleting ? undefined : setConfirming(false))}
        size="md">
        <AlertDialogBackdrop />
        <AlertDialogContent className="rounded-md border border-border bg-popover">
          <AlertDialogHeader>
            <Heading size="md" className="text-foreground">
              Delete your account?
            </Heading>
          </AlertDialogHeader>
          <AlertDialogBody className="mt-2 mb-4">
            <VStack space="sm">
              <Text size="sm" className="text-muted-foreground">
                This removes every document in your account, every note you have written, every
                group you own and every share in both directions. It starts immediately and there
                is no way back.
              </Text>
              <Text size="sm" className="text-muted-foreground">
                Type DELETE to confirm.
              </Text>
              <Input className="mt-1 h-11">
                <InputField
                  value={typed}
                  onChangeText={setTyped}
                  placeholder="DELETE"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  className="text-foreground"
                />
              </Input>
            </VStack>
          </AlertDialogBody>
          <AlertDialogFooter>
            <Button
              variant="outline"
              size="sm"
              isDisabled={deleting}
              onPress={() => setConfirming(false)}>
              <ButtonText>Cancel</ButtonText>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              isDisabled={typed.trim().toUpperCase() !== 'DELETE' || deleting}
              onPress={() => void confirmDelete()}>
              <ButtonText>{deleting ? 'Deleting…' : 'Delete account'}</ButtonText>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Screen>
  );
}

const CONTENT = { paddingBottom: 32 } as const;
