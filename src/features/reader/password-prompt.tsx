import { Lock } from 'lucide-react-native';
import React, { useState } from 'react';

import { ActionSheetPanel } from '@/components/layout/action-sheet-panel';
import { Button, ButtonText } from '@/components/ui/button';
import { HStack } from '@/components/ui/hstack';
import { Heading } from '@/components/ui/heading';
import { Icon } from '@/components/ui/icon';
import { Input, InputField } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

/**
 * An encrypted PDF.
 *
 * The import refuses these outright, so a document only arrives here if it was
 * encrypted after it was added or came from another device. `react-native-pdf`
 * takes a `password` prop and hands it to the platform renderer, which is why
 * this is a prompt rather than the failure state next door.
 *
 * **The password does not leave the phone.** Not to Convex, not to the document
 * row, not to the log — see `document-password.ts`. The sentence in the body
 * says so, because a reader typing a password into an app they did not write
 * deserves to be told where it goes.
 *
 * `wrong` rather than an error string: there is one thing that can be wrong
 * here and the renderer does not say anything worth repeating about it.
 */
type PasswordPromptProps = {
  isOpen: boolean;
  onClose: () => void;
  /** True after a password was tried and the document still would not open. */
  wrong: boolean;
  onSubmit: (password: string, remember: boolean) => void;
};

export function PasswordPrompt(props: PasswordPromptProps) {
  return <PasswordPromptSheet key={props.isOpen ? 'open' : 'closed'} {...props} />;
}

function PasswordPromptSheet({ isOpen, onClose, wrong, onSubmit }: PasswordPromptProps) {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);

  return (
    <ActionSheetPanel isOpen={isOpen} onClose={onClose}>
      <VStack space="md">
        <VStack space="sm">
          <Icon as={Lock} size="lg" className="text-fg-muted" />
          <Heading size="md" className="text-foreground">
            {wrong ? 'That password did not work' : 'This PDF has a password'}
          </Heading>
          <Text size="sm" className="text-muted-foreground">
            {wrong
              ? 'Check it and try again. Nothing was sent anywhere.'
              : 'Enter it to read the document. Pidom never sends it anywhere — it goes straight to the viewer on this phone.'}
          </Text>

          <Input className="mt-4 h-11 border-primary">
            <InputField
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Document password"
              className="text-foreground"
            />
          </Input>

          <HStack className="mt-4 items-center" space="lg">
            <Text size="sm" className="flex-1 text-muted-foreground">
              Remember on this device
            </Text>
            <Switch
              value={remember}
              onValueChange={setRemember}
              accessibilityLabel="Remember this password on this device"
            />
          </HStack>
        </VStack>
        <VStack space="sm">
          <Button variant="outline" size="sm" onPress={onClose}>
            <ButtonText>Cancel</ButtonText>
          </Button>
          <Button
            size="sm"
            isDisabled={password.length === 0}
            onPress={() => onSubmit(password, remember)}
          >
            <ButtonText>Open</ButtonText>
          </Button>
        </VStack>
      </VStack>
    </ActionSheetPanel>
  );
}
