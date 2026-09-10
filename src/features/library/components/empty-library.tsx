import { BookOpenText, FilePlus2 } from 'lucide-react-native';
import React from 'react';

import { Button, ButtonIcon, ButtonText } from '@/components/ui/button';
import { Center } from '@/components/ui/center';
import { Heading } from '@/components/ui/heading';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

/**
 * A new account, before anything is in it.
 *
 * One centred block with one action. The alternative — six section headings
 * with nothing under them — tells the reader the app is broken rather than new.
 */
export function EmptyLibrary({ onImport }: { onImport: () => void }) {
  return (
    <Center className="flex-1 px-10">
      <VStack className="items-center" space="lg">
        <Icon as={BookOpenText} size="xl" className="h-10 w-10 text-fg-subtle" />

        <VStack className="items-center" space="sm">
          <Heading size="lg" className="text-center text-foreground">
            Nothing here yet
          </Heading>
          <Text size="sm" className="max-w-[286px] text-center text-muted-foreground">
            Import a PDF and it stays on this device — readable with no connection, and your place
            is kept on every device you sign in to.
          </Text>
        </VStack>

        <Button size="lg" onPress={onImport} className="mt-2 h-11">
          <ButtonIcon as={FilePlus2} />
          <ButtonText>Import PDF</ButtonText>
        </Button>
      </VStack>
    </Center>
  );
}
