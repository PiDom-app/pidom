import React, { useEffect, useState } from 'react';

import { ActionSheetPanel } from '@/components/layout/action-sheet-panel';
import { Button, ButtonText } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { Input, InputField } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { AUTHOR_MAX, TITLE_MAX } from '@convex/model/limits';

/**
 * Retitling a document.
 *
 * The title Pidom shows comes from the picked file's name, which is often a
 * download slug rather than anything a person would call the book. This is how
 * that gets fixed.
 *
 * `maxLength` on both fields is the same constant the server checks against, so
 * a long title is stopped by the keyboard rather than by a round trip that
 * comes back as an error.
 */
export function RenameDialog({
  isOpen,
  initialTitle,
  initialAuthor,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  initialTitle: string;
  initialAuthor: string | null;
  onClose: () => void;
  onSubmit: (title: string, author: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [author, setAuthor] = useState(initialAuthor ?? '');
  const [saving, setSaving] = useState(false);

  // Reset when a different document opens the same dialog, which is every time
  // after the first — the component stays mounted with the screen.
  useEffect(() => {
    if (isOpen) {
      setTitle(initialTitle);
      setAuthor(initialAuthor ?? '');
    }
  }, [isOpen, initialTitle, initialAuthor]);

  const canSave = title.trim() !== '' && !saving;

  async function save() {
    if (!canSave) {
      return;
    }
    setSaving(true);
    try {
      if (await onSubmit(title.trim(), author.trim())) {
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <ActionSheetPanel isOpen={isOpen} onClose={onClose} isDismissable={!saving}>
      <VStack space="md">
        <VStack space="sm">
          <Heading size="md" className="text-foreground">
            Rename
          </Heading>
          <VStack space="xs">
            <Text size="xs" className="text-fg-subtle">
              Title
            </Text>
            <Input className="h-11">
              <InputField
                value={title}
                onChangeText={setTitle}
                maxLength={TITLE_MAX}
                autoFocus
                selectTextOnFocus
                placeholder="Title"
                className="text-foreground"
              />
            </Input>
          </VStack>
          <VStack space="xs">
            <Text size="xs" className="text-fg-subtle">
              Author
            </Text>
            <Input className="h-11">
              <InputField
                value={author}
                onChangeText={setAuthor}
                maxLength={AUTHOR_MAX}
                placeholder="Optional"
                onSubmitEditing={() => void save()}
                className="text-foreground"
              />
            </Input>
          </VStack>
        </VStack>
        <HStack className="justify-end" space="sm">
          <Button variant="outline" size="sm" onPress={onClose}>
            <ButtonText>Cancel</ButtonText>
          </Button>
          <Button size="sm" isDisabled={!canSave} onPress={() => void save()}>
            <ButtonText>Save</ButtonText>
          </Button>
        </HStack>
      </VStack>
    </ActionSheetPanel>
  );
}
