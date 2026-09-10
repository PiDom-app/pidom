import { ExternalLink } from 'lucide-react-native';
import React from 'react';

import { ActionSheetPanel } from '@/components/layout/action-sheet-panel';
import { Box } from '@/components/ui/box';
import { Button, ButtonText } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

import type { PdfLink } from './open-pdf-link';

/**
 * Leaving the app, on a document's say-so.
 *
 * The host leads, because the host is the part that decides whether this is
 * safe; the whole URL is underneath it in one line for anybody who wants to
 * check the rest. Both come from a `URL` this code parsed rather than from the
 * string the document supplied — `open-pdf-link.ts` has the reasoning, and the
 * short version is that a link is only shown here if it is `https:` at all.
 *
 * The last sentence is the one that matters: a reader should know that what
 * they are about to open was written by whoever made the PDF and not by Pidom.
 */
export function LinkPrompt({ link, onClose }: { link: PdfLink | null; onClose: (open: boolean) => void }) {
  return (
    <ActionSheetPanel isOpen={link !== null} onClose={() => onClose(false)}>
      <VStack space="md">
        <VStack space="sm">
            <Icon as={ExternalLink} size="lg" className="text-fg-muted" />
          <Heading size="md" className="text-foreground">
            Leave Pidom?
          </Heading>
          {/* Both lines ellipsise from the HEAD. A host too long for the
              dialog would otherwise clip on the right — `paypal.com.a…` — and
              the rightmost labels are the ones that decide where this goes.
              `readPdfLink` already bounds the host to 253 characters; this is
              what makes the bound legible.

              The full value rides on `accessibilityLabel`, because a screen
              reader given the visually-truncated string is a screen reader
              given the spoof. */}
          <Box className="rounded-md border border-hairline bg-sunken px-3 py-2.5">
            <Text
              size="sm"
              numberOfLines={1}
              ellipsizeMode="head"
              accessibilityLabel={link === null ? undefined : `Host ${link.host}`}
              className="font-semibold text-foreground">
              {link?.host ?? ''}
            </Text>
            <Text
              size="xs"
              numberOfLines={1}
              ellipsizeMode="head"
              accessibilityLabel={link?.url}
              className="mt-0.5 text-fg-subtle">
              {link?.url ?? ''}
            </Text>
          </Box>
          <Text size="sm" className="mt-3 text-muted-foreground">
            This link is written into the document, not into Pidom. It opens in your browser.
          </Text>
        </VStack>
        <VStack space="sm">
          <Button variant="outline" size="sm" onPress={() => onClose(false)}>
            <ButtonText>Stay here</ButtonText>
          </Button>
          <Button size="sm" onPress={() => onClose(true)}>
            <ButtonText>Open</ButtonText>
          </Button>
        </VStack>
      </VStack>
    </ActionSheetPanel>
  );
}
