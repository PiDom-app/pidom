import { Link, Stack } from 'expo-router';
import React from 'react';

import { Box } from '@/components/ui/box';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Box className="flex-1 bg-background">
        <VStack className="flex-1 items-center justify-center px-10" space="sm">
          <Heading size="lg" className="text-foreground">
            Nothing here
          </Heading>
          <Text size="sm" className="text-center text-muted-foreground">
            That link doesn’t lead anywhere in Pidom.
          </Text>
          <Link href="/" className="mt-2 text-link">
            Back to your library
          </Link>
        </VStack>
      </Box>
    </>
  );
}
