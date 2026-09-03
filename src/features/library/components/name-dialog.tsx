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
 * One text field behind a confirmation. Naming and renaming collections.
 *
 * `maxLength` is the server's own constant, so the keyboard stops a long name
 * rather than a round trip coming back as an error.
 */
export function NameDialog({
  isOpen,
  title,
  label,
  placeholder,
  initialValue = '',
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  title: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
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

  const canSave = value.trim() !== '' && !saving;

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
                maxLength={COLLECTION_NAME_MAX}
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
