import { FlashList } from '@shopify/flash-list';
import { Highlighter, NotebookPen, Trash2 } from 'lucide-react-native';
import React from 'react';

import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

import type { Annotation } from './use-annotations';

/**
 * The passages and notes kept in this document.
 *
 * **Nothing is drawn on the page**, because the renderer gives no page
 * coordinates to draw at: `onTextSelectionChange` reports the words and
 * `onPageSingleTap` reports where a finger touched the view. A highlight put at
 * a guessed position is worse than none, since the reader then goes looking for
 * it.
 *
 * There is no rule down the left of a row either. It was there as a stand-in
 * for the mark that cannot exist on the page, and a stripe on every line of a
 * list is a decoration each row pays for and none of them earns — the quotation
 * marks already say which words are the document's. The rule is kept in one
 * place, on the note screen, where a single quoted passage is the subject
 * rather than one of twenty rows.
 *
 * A passage reads in the document's voice and a note in the reader's, which is
 * what the type sizes carry: the passage in reading type, the note under it
 * smaller and muted.
 */
export function AnnotationsList({
  annotations,
  currentPage,
  onJump,
  onEdit,
  onRemove,
  onWriteNote,
}: {
  annotations: readonly Annotation[];
  /** Where the reader is, so the rows on this page are the ones marked. */
  currentPage: number;
  onJump: (page: number) => void;
  onEdit: (annotation: Annotation) => void;
  onRemove: (id: string) => void;
  /** The empty state's only exit, and the whole Android path. */
  onWriteNote: () => void;
}) {
  if (annotations.length === 0) {
    return (
      <VStack className="flex-1 items-center justify-center px-10 py-12">
        <Icon as={Highlighter} size="xl" className="text-fg-subtle" />
        <Text size="md" className="mt-4 text-center font-semibold text-foreground">
          Nothing kept yet
        </Text>
        {/* Both halves, because selecting text is iOS-only — the renderer's
            Android side has no selection code at all — and an empty state that
            offered only that would be a dead end on every Android install. */}
        <Text size="sm" className="mt-1.5 text-center text-fg-muted">
          Select a passage in the document to keep it, or write a note about the page you are on.
        </Text>
        <Pressable
          onPress={onWriteNote}
          accessibilityRole="button"
          accessibilityLabel="Write a note about this page"
          className="mt-5 flex-row items-center gap-2 rounded-md border border-border px-3.5 py-2 data-[active=true]:bg-hover"
        >
          <Icon as={NotebookPen} size="sm" className="text-foreground" />
          <Text size="sm" className="font-medium text-foreground">
            Write a note
          </Text>
        </Pressable>
      </VStack>
    );
  }

  return (
    <FlashList
      data={annotations as Annotation[]}
      contentContainerStyle={CONTENT}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => {
        const here = item.page === currentPage;
        const quoted = item.text !== null;
        return (
          // The row is one surface. The highlight used to sit on the tappable
          // half only, so the page you were on drew a block with a notch cut
          // out of it where the delete button was.
          <Box className={here ? 'w-full flex-row bg-hover' : 'w-full flex-row'}>
            <Pressable
              onPress={() => onJump(item.page)}
              // A long press edits, the way a long press on a document tile
              // opens its actions. The tap is navigation, which is what a row
              // in this screen is for.
              onLongPress={() => onEdit(item)}
              accessibilityRole="button"
              accessibilityLabel={`${quoted ? 'Kept passage' : 'Note'}, page ${item.page}. ${
                item.text ?? item.note ?? ''
              }`}
              accessibilityHint="Double tap and hold to edit the note"
              className="flex-1 py-3.5 pl-6 data-[active=true]:bg-hover"
            >
              <HStack className="w-full items-start" space="md">
                <VStack className="flex-1">
                  <Text
                    size="sm"
                    numberOfLines={3}
                    className={quoted ? 'text-foreground' : 'text-fg-muted'}
                  >
                    {quoted ? `“${item.text}”` : item.note}
                  </Text>
                  {quoted && item.note !== null ? (
                    <Text size="xs" numberOfLines={2} className="mt-1 text-fg-subtle">
                      {item.note}
                    </Text>
                  ) : null}
                </VStack>
                <Text size="xs" className={here ? 'text-primary' : 'text-fg-subtle'}>
                  {item.page}
                </Text>
              </HStack>
            </Pressable>
            <Pressable
              onPress={() => onRemove(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`Remove this ${quoted ? 'passage' : 'note'} from page ${item.page}`}
              className="w-12 items-center justify-center rounded-md data-[active=true]:bg-hover"
            >
              <Icon as={Trash2} size="sm" className="text-fg-subtle" />
            </Pressable>
          </Box>
        );
      }}
    />
  );
}

const CONTENT = { paddingBottom: 32 } as const;
