import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import React, { useState } from 'react';

import { Screen } from '@/components/layout/screen';
import { Box } from '@/components/ui/box';
import { Button, ButtonText } from '@/components/ui/button';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Input, InputField } from '@/components/ui/input';
import { KeyboardAvoidingView } from '@/components/ui/keyboard-avoiding-view';
import { Pressable } from '@/components/ui/pressable';
import { ScrollView } from '@/components/ui/scroll-view';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import type { Id } from '@convex/_generated/dataModel';
import { ANNOTATION_NOTE_MAX, BOOKMARK_LABEL_MAX } from '@convex/model/limits';

import { useLibraryStatus } from '../library/data/use-library-status';
import { useAnnotations } from './use-annotations';
import { useBookmarks } from './use-bookmarks';

/**
 * One text field about one place in a document.
 *
 * Two things arrive here, because they are the same act: writing a note about a
 * page, and giving a marked page a name. Both take a line or two of the
 * reader's own words and hang them off a page number.
 *
 * **A screen rather than a dialog.** A dialog holding a keyboard on a phone is
 * a box with about four visible lines in it, and it moves when the keyboard
 * comes up; a note is prose and wants the room. It is also how the rest of this
 * feature works now — the navigator is a screen, and a dialog opened from a
 * screen is a third kind of surface for no reason.
 *
 * The passage is shown and is **not editable**. `text` is the document's own
 * words; a field that let a reader rewrite them would turn a quotation into a
 * paraphrase nothing downstream could tell apart from one.
 */
export function NoteScreen() {
  const router = useRouter();
  const { ready } = useLibraryStatus();
  const params = useLocalSearchParams<{
    id: string;
    kind?: string;
    page?: string;
    value?: string;
    passage?: string;
    annotationId?: string;
  }>();

  const documentId = params.id as Id<'documents'> | undefined;
  const kind = params.kind === 'bookmark' ? 'bookmark' : 'note';
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const passage = params.passage ?? null;
  const annotationId =
    params.annotationId === undefined
      ? null
      : (params.annotationId as Id<'documentAnnotations'>);

  // The initialiser, not an effect: re-seeding on every render would fight the
  // reader's next keystroke, and the route is remounted per composition anyway.
  const [value, setValue] = useState(() => params.value ?? '');
  const [saving, setSaving] = useState(false);

  const { keep, rewrite } = useAnnotations({ documentId, ready });
  const { rename } = useBookmarks({ documentId, ready });

  const limit = kind === 'bookmark' ? BOOKMARK_LABEL_MAX : ANNOTATION_NOTE_MAX;
  // A bookmark can lose its name — clearing the box is how you get back to a
  // plain "Page 152". A note cannot be empty; deleting it is the way out.
  const canSave = (kind === 'bookmark' || value.trim() !== '') && !saving;

  async function save() {
    if (!canSave || documentId === undefined) {
      return;
    }
    setSaving(true);
    try {
      if (kind === 'bookmark') {
        if (await rename(page, value.trim())) {
          router.back();
        }
        return;
      }
      if (annotationId !== null) {
        if (await rewrite(annotationId, value.trim())) {
          router.back();
        }
        return;
      }
      keep({
        page,
        // A note written over a passage is still a passage — the kind says
        // where it came from, and the passage is the part that cannot be
        // written again.
        kind: passage === null ? 'note' : 'passage',
        ...(passage === null ? {} : { text: passage }),
        note: value.trim(),
      });
      // `keep` is optimistic and does not wait: the row is in the list before
      // the round trip, and a failure arrives as a toast that takes it away
      // again. Sitting on this screen until the server answered would undo the
      // point of the optimistic update.
      router.back();
    } finally {
      setSaving(false);
    }
  }

  const heading =
    kind === 'bookmark'
      ? 'Name this bookmark'
      : annotationId !== null
        ? 'Edit this note'
        : 'Write a note';

  return (
    <Screen edges={['top', 'bottom']}>
      <HStack className="items-center px-4 pt-3 pb-3">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
          <Icon as={ArrowLeft} size="lg" className="text-foreground" />
        </Pressable>
        <VStack className="ml-2.5 flex-1">
          <Text size="md" className="font-semibold text-foreground">
            {heading}
          </Text>
          <Text size="xs" className="mt-0.5 text-fg-subtle">
            {`Page ${page}`}
          </Text>
        </VStack>
        <Button size="sm" isDisabled={!canSave} onPress={() => void save()}>
          <ButtonText>{kind === 'bookmark' ? 'Save' : 'Keep'}</ButtonText>
        </Button>
      </HStack>

      <KeyboardAvoidingView className="flex-1">
        <ScrollView contentContainerStyle={BODY} keyboardShouldPersistTaps="handled">
          <VStack space="md">
            {passage === null ? null : (
              <VStack space="xs">
                <Text size="xs" className="text-fg-subtle">
                  From the page
                </Text>
                {/* The rule down the left is the mark, and it is here rather
                    than in the list: a quotation wants to look like one, and a
                    list of rows does not want a stripe on every line. */}
                <HStack space="sm">
                  <Box className="w-0.5 rounded-md bg-border-strong" />
                  <Text size="sm" className="flex-1 text-fg-muted">
                    {`“${passage}”`}
                  </Text>
                </HStack>
              </VStack>
            )}

            <VStack space="xs">
              <Text size="xs" className="text-fg-subtle">
                {kind === 'bookmark' ? 'Name' : 'Note'}
              </Text>
              <Input className={kind === 'bookmark' ? 'h-11' : 'h-40 items-start py-2'}>
                <InputField
                  value={value}
                  onChangeText={setValue}
                  maxLength={limit}
                  multiline={kind === 'note'}
                  autoFocus
                  textAlignVertical={kind === 'note' ? 'top' : 'center'}
                  placeholder={
                    kind === 'bookmark'
                      ? 'Why you stopped here'
                      : 'What you want to remember about this'
                  }
                  onSubmitEditing={kind === 'bookmark' ? () => void save() : undefined}
                  className="text-foreground"
                />
              </Input>
              {kind === 'bookmark' ? (
                <Text size="xs" className="text-fg-subtle">
                  Clearing this takes the name off again.
                </Text>
              ) : null}
            </VStack>
          </VStack>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const BODY = { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 32 } as const;
