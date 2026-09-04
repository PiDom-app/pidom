import * as Clipboard from 'expo-clipboard';
import { Copy, Search } from 'lucide-react-native';
import React from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { PAGE_TEXT_MAX } from '@convex/model/limits';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { log } from '@/lib/logger';

const SCOPE = 'reader-selection';

/**
 * What to do with text the reader has selected.
 *
 * `enableTextSelection` defaults to `true` in `react-native-pdf` and this app
 * inherited that without noticing: an iOS reader could already select text and
 * reach the system menu, and nothing here knew. `onTextSelectionChange` was
 * firing into a default no-op the whole time. This is that callback given
 * somewhere to go.
 *
 * **iOS only**, because the renderer's selection is. The type declaration says
 * so and the Android native side has no equivalent, so on Android this renders
 * nothing rather than offering a button that cannot work.
 *
 * The selected text is document content. It is bounded by `PAGE_TEXT_MAX` — the
 * same number the server uses for a page of extracted text — before it goes
 * anywhere, and it is never logged, not even its length.
 */
export function SelectionBar({
  text,
  onSearch,
  onDismiss,
}: {
  /** `null` when nothing is selected. */
  text: string | null;
  /** Hands the selection to the find bar. */
  onSearch: (term: string) => void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const showToast = useAppToast();

  if (Platform.OS !== 'ios' || text === null || text.trim().length === 0) {
    return null;
  }

  const selected = text.slice(0, PAGE_TEXT_MAX);

  return (
    <Box
      className="absolute inset-x-0 items-center"
      style={{ bottom: Math.max(insets.bottom, 12) + 108 }}
      pointerEvents="box-none">
      <HStack
        className="rounded-md border border-border bg-elevated px-1.5 py-1"
        space="xs">
        <Pressable
          onPress={() => {
            Clipboard.setStringAsync(selected)
              .then(() => {
                showToast({ id: 'copied', tone: 'success', title: 'Copied' });
                onDismiss();
              })
              .catch((error: unknown) => {
                // The payload is document content, so only the fact of the
                // failure is recorded.
                log.debug(SCOPE, 'could not copy the selection', error);
                showToast({ id: 'copied', tone: 'error', title: "Couldn't copy" });
              });
          }}
          accessibilityRole="button"
          accessibilityLabel="Copy the selected text"
          className="flex-row items-center gap-1.5 rounded-md px-3 py-2 data-[active=true]:bg-hover">
          <Icon as={Copy} size="sm" className="text-foreground" />
          <Text size="sm" className="text-foreground">
            Copy
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            // A phrase is a search; a paragraph is not. Whatever a reader
            // highlighted, the first few words are what they would have typed.
            onSearch(selected.trim().split(/\s+/).slice(0, 6).join(' '));
            onDismiss();
          }}
          accessibilityRole="button"
          accessibilityLabel="Find the selected text in this document"
          className="flex-row items-center gap-1.5 rounded-md px-3 py-2 data-[active=true]:bg-hover">
          <Icon as={Search} size="sm" className="text-foreground" />
          <Text size="sm" className="text-foreground">
            Find
          </Text>
        </Pressable>
      </HStack>
    </Box>
  );
}
