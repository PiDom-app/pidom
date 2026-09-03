import React from 'react';

import { HStack } from '@/components/ui/hstack';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';

import type { LibraryCollection } from '../data/types';
import { DocumentCover, coverHeight } from './document-cover';

/** Mosaic cover width. Four of them plus three 4px gaps make 148. */
const MOSAIC_COVER = 34;

/** mosaic · 8 gap · 20px name line · 2 gap · 13px count. See `tileHeight`. */
export const COLLECTION_TILE_HEIGHT = coverHeight(MOSAIC_COVER) + 8 + 20 + 2 + 13;

/**
 * A collection, as a small mosaic of the covers it holds.
 *
 * No surface behind it and no border. On this screen the cover is the only
 * filled shape, so a collection reads as a group of documents rather than as a
 * container that happens to sit near some — which is also what it is.
 */
export function CollectionTile({
  collection,
  onPress,
}: {
  collection: LibraryCollection;
  onPress: (collection: LibraryCollection) => void;
}) {
  const covers = collection.coverDocumentIds;
  const count = collection.documentCount;

  return (
    <Pressable
      onPress={() => onPress(collection)}
      accessibilityRole="button"
      accessibilityLabel={`${collection.name}, ${count} ${count === 1 ? 'document' : 'documents'}`}
      className="w-[148px]">
      <HStack space="xs">
        {covers.length === 0 ? (
          // An empty collection still needs a shape, or the name floats with
          // nothing under it and the rail's rhythm breaks.
          <HStack className="h-12 w-[148px] rounded-md bg-surface" />
        ) : (
          covers.map((documentId) => (
            <DocumentCover
              key={documentId}
              documentId={documentId}
              title=""
              width={MOSAIC_COVER}
            />
          ))
        )}
      </HStack>

      <Text size="sm" numberOfLines={1} className="mt-2 text-foreground">
        {collection.name}
      </Text>
      <Text size="2xs" className="mt-0.5 text-fg-subtle">
        {count === 1 ? '1 document' : `${count} documents`}
      </Text>
    </Pressable>
  );
}
