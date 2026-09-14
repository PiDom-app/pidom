import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import React, { useState } from 'react';

import { Screen } from '@/components/layout/screen';
import { Button, ButtonText } from '@/components/ui/button';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Input, InputField } from '@/components/ui/input';
import { KeyboardAvoidingView } from '@/components/ui/keyboard-avoiding-view';
import { Pressable } from '@/components/ui/pressable';
import { ScrollView } from '@/components/ui/scroll-view';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { BOOKMARK_LABEL_MAX } from '@convex/model/limits';

import { useBookmarks } from './use-bookmarks';

/**
 * Giving a marked page a name.
 *
 * This was `note-screen.tsx`, which did two jobs on one route: writing a note
 * about a page, and naming a bookmark. Notes are gone, and the half that is
 * left is a single line of text hung off a page number — so the screen is that
 * and nothing else, with the `kind` parameter, the passage block, the
 * multiline field and the two sets of copy all removed rather than left behind
 * as branches nothing takes.
 *
 * **Still a screen rather than a dialog**, for the reason the old one gave and
 * which has not changed: it is opened from the navigator, which is a screen,
 * and a dialog opened from a screen is a third kind of surface for no reason.
 */
export function BookmarkNameScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; page?: string; value?: string }>();

  const documentId = params.id === undefined || params.id === '' ? undefined : params.id;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  // The initialiser, not an effect: re-seeding on every render would fight the
  // reader's next keystroke, and the route is remounted per edit anyway.
  const [value, setValue] = useState(() => params.value ?? '');
  const [saving, setSaving] = useState(false);

  const { rename } = useBookmarks({ documentId });

  // A bookmark can lose its name — clearing the box is how you get back to a
  // plain "Page 152" — so an empty field is a valid save rather than a refusal.
  const canSave = !saving;

  async function save() {
    if (!canSave || documentId === undefined) {
      return;
    }
    setSaving(true);
    try {
      if (await rename(page, value.trim())) {
        router.back();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <HStack className="items-center px-4 pt-3 pb-3">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover"
        >
          <Icon as={ArrowLeft} size="lg" className="text-foreground" />
        </Pressable>
        <VStack className="ml-2.5 flex-1">
          <Text size="md" className="font-semibold text-foreground">
            Name this bookmark
          </Text>
          <Text size="xs" className="mt-0.5 text-fg-subtle">
            {`Page ${page}`}
          </Text>
        </VStack>
        <Button
          size="sm"
          className="w-auto self-auto"
          isDisabled={!canSave}
          onPress={() => void save()}
        >
          <ButtonText>Save</ButtonText>
        </Button>
      </HStack>

      <KeyboardAvoidingView className="flex-1">
        <ScrollView contentContainerStyle={BODY} keyboardShouldPersistTaps="handled">
          <VStack space="xs">
            <Text size="xs" className="text-fg-subtle">
              Name
            </Text>
            <Input className="h-11">
              <InputField
                value={value}
                onChangeText={setValue}
                maxLength={BOOKMARK_LABEL_MAX}
                autoFocus
                placeholder="Why you stopped here"
                onSubmitEditing={() => void save()}
                className="text-foreground"
              />
            </Input>
            <Text size="xs" className="text-fg-subtle">
              Clearing this takes the name off again.
            </Text>
          </VStack>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const BODY = { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 } as const;
