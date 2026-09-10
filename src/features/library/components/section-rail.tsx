import { FlashList } from '@shopify/flash-list';
import React from 'react';

import { Heading } from '@/components/ui/heading';
import { VStack } from '@/components/ui/vstack';

/**
 * A titled row of things that scrolls sideways.
 *
 * `FlashList` rather than `ScrollView`: React Native's own docs put ScrollView
 * at "a limited number of items", and a rail is however many documents the
 * reader has. v2 dropped `estimatedItemSize`, so there is nothing to guess.
 *
 * The section is separated by whitespace and nothing else — no border, no
 * surface, no card. That is the whole visual system of this screen.
 *
 * `minHeight` rather than `height`: a horizontal list inside a vertical one is
 * the classic place a layout collapses to nothing, and a floor rules that out
 * without capping the rail at a size that would clip a reader running large
 * accessibility text.
 */
export function SectionRail<T>({
  title,
  data,
  minHeight,
  keyExtractor,
  renderItem,
}: {
  title: string;
  data: readonly T[];
  /** The tallest item in the rail — see `tileHeight`. */
  minHeight: number;
  keyExtractor: (item: T) => string;
  renderItem: (item: T) => React.ReactElement;
}) {
  return (
    <VStack className="mt-7">
      <Heading size="sm" className="px-4 text-foreground">
        {title}
      </Heading>

      <FlashList
        horizontal
        data={data as T[]}
        keyExtractor={keyExtractor}
        renderItem={({ item }) => renderItem(item)}
        showsHorizontalScrollIndicator={false}
        // Padding belongs on the content, not the list: FlashList measures
        // itself against its parent, and padding on `style` makes the two
        // disagree.
        contentContainerStyle={RAIL_PADDING}
        ItemSeparatorComponent={RailGap}
        style={{ minHeight }}
        className="mt-3"
      />
    </VStack>
  );
}

// Plain style objects rather than classNames, because FlashList's own props
// take styles and are not className-interop'd. Hoisted so they are not rebuilt
// for every rail on every render.
const RAIL_PADDING = { paddingHorizontal: 16 } as const;
const GAP = { width: 14 } as const;

function RailGap() {
  return <VStack style={GAP} />;
}
