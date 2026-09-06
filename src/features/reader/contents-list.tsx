import { FlashList } from '@shopify/flash-list';
import React from 'react';

import { HStack } from '@/components/ui/hstack';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';

import { lastStartingBefore, type OutlineEntry } from './outline';

/**
 * The document's own table of contents.
 *
 * Depth is rendered as indentation and capped at three by the probe, because a
 * fourth level in a phone-width row is four characters of title.
 *
 * `FlashList` because this list runs to `OUTLINE_ENTRY_MAX` — 355 rows in the
 * book this was found on — and building every one before the screen could show
 * is what made Contents take a visible pause to open.
 */
export function ContentsList({
  entries,
  currentPage,
  onJump,
}: {
  entries: readonly OutlineEntry[];
  currentPage: number;
  onJump: (page: number) => void;
}) {
  // The entry the reader is *inside*, which is the last one that starts at or
  // before the current page — not the one whose number happens to match. A
  // chapter starting on 142 is the current chapter on page 148 too.
  const here = lastStartingBefore(entries, currentPage);

  return (
    <FlashList
      data={entries as OutlineEntry[]}
      contentContainerStyle={CONTENT}
      keyExtractor={(item, index) =>
        // The index is part of the key because a PDF can, and does, declare the
        // same title on the same page twice.
        `${item.page}-${item.title}-${index}`
      }
      renderItem={({ item, index }) => (
        <Pressable
          onPress={() => onJump(item.page)}
          accessibilityRole="button"
          accessibilityState={{ selected: index === here }}
          accessibilityLabel={`${item.title}, page ${item.page}`}
          className={
            index === here
              ? 'w-full bg-hover py-3 pr-6'
              : 'w-full py-3 pr-6 data-[active=true]:bg-hover'
          }
          style={{ paddingLeft: 24 + item.depth * 18 }}>
          <HStack className="w-full items-center" space="md">
            <Text
              size={item.depth === 0 ? 'md' : 'sm'}
              numberOfLines={1}
              className={
                item.depth === 0 ? 'flex-1 font-semibold text-foreground' : 'flex-1 text-fg-muted'
              }>
              {item.title}
            </Text>
            <Text size="xs" className={index === here ? 'text-primary' : 'text-fg-subtle'}>
              {item.page}
            </Text>
          </HStack>
        </Pressable>
      )}
    />
  );
}

const CONTENT = { paddingBottom: 32 } as const;
