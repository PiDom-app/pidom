import React, { useEffect, useState } from 'react';

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
import { Input, InputField } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { COLLECTION_NAME_MAX } from '@convex/model/limits';

/**
 * One text field behind a confirmation. Naming collections, and bookmarks.
 *
 * `maxLength` is always the server's own constant, so the keyboard stops a long
 * name rather than a round trip coming back as an error. It is a prop because
 * the two callers have different ceilings, not because it is a style choice.
 *
 * `allowEmpty` is the difference between naming a thing and renaming one. A
 * collection has to be called something. A bookmark does not — clearing the box
 * and saving is how a reader takes a name back off one, and the server reads an
 * empty string as exactly that.
 */
export function NameDialog({
  isOpen,
  title,
  label,
  placeholder,
  initialValue = '',
  maxLength = COLLECTION_NAME_MAX,
  allowEmpty = false,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  title: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  /** The server's bound for this field, so the keyboard enforces it. */
  maxLength?: number;
  /** Whether an empty value is a save rather than a disabled button. */
  allowEmpty?: boolean;
  onClose: () => void;
  onSubmit: (value: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
    }
  }, [isOpen, initialValue]);

  const canSave = (allowEmpty || value.trim() !== '') && !saving;

  async function save() {
    if (!canSave) {
      return;
    }
    setSaving(true);
    try {
      if (await onSubmit(value.trim())) {
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <AlertDialog isOpen={isOpen} onClose={onClose} size="md">
      <AlertDialogBackdrop />
      <AlertDialogContent className="rounded-md border border-border bg-popover">
        <AlertDialogHeader>
          <Heading size="md" className="text-foreground">
            {title}
          </Heading>
        </AlertDialogHeader>

        <AlertDialogBody className="mt-3 mb-4">
          <VStack space="xs">
            <Text size="xs" className="text-fg-subtle">
              {label}
            </Text>
            <Input className="h-11">
              <InputField
                value={value}
                onChangeText={setValue}
                maxLength={maxLength}
                autoFocus
                placeholder={placeholder}
                onSubmitEditing={() => void save()}
                className="text-foreground"
              />
            </Input>
          </VStack>
        </AlertDialogBody>

        <AlertDialogFooter>
          <Button variant="outline" size="sm" onPress={onClose}>
            <ButtonText>Cancel</ButtonText>
          </Button>
          <Button size="sm" isDisabled={!canSave} onPress={() => void save()}>
            <ButtonText>Save</ButtonText>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
