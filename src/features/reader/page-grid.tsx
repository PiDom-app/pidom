import { FlashList } from '@shopify/flash-list';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, useWindowDimensions } from 'react-native';
import Pdf from 'react-native-pdf';

import { Box } from '@/components/ui/box';
import { Image } from '@/components/ui/image';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { themeColors, type ThemeName } from '@/design/tokens';

import { THUMBNAIL_RENDER, usePageThumbnails } from './use-page-thumbnails';

/** The screen gutter, and the gap between columns. */
const GUTTER = 24;
const GAP = 12;
const COLUMNS = 3;
/** 1 : 1.417 is a page, the same ratio the library's covers use. */
const RATIO = 1.417;
/** The label under a cell, and the gap under that. */
const LABEL = 16;
const ROW_GAP = 14;

/**
 * Every page of the document, small enough to scan.
 *
 * **The cells are images, not renderers.** They used to be one live
 * `<Pdf singlePage>` each, which is nine native document handles over the same
 * file for one screen of a grid: on a 433-page book that took eight seconds to
 * paint, measured on a device, and every scroll paid it again. Now a page is
 * rendered once into `library/<profile>/pages/<document>/<n>.jpg` and the grid
 * is `expo-image` over files, which paints immediately and scrolls.
 *
 * The single renderer that makes them is the `<Pdf>` at the bottom of this
 * file, off-screen and showing one page at a time. `usePageThumbnails` owns the
 * queue; this component only says which cells are visible, so nothing is
 * rendered for a page nobody has looked at.
 *
 * `FlashList` rather than the sheet's `ActionsheetFlatList`, because this is a
 * screen now rather than a sheet, and v2 recycles by default with no size
 * estimate to guess at.
 */
export function PageGrid({
  uri,
  password,
  profileId,
  documentId,
  pageCount,
  currentPage,
  theme,
  onJump,
}: {
  uri: string;
  password?: string;
  profileId: string;
  documentId: string;
  pageCount: number;
  /** Ringed, and the page the grid opens scrolled to. */
  currentPage: number;
  theme: ThemeName;
  onJump: (page: number) => void;
}) {
  const { width } = useWindowDimensions();
  const host = useRef<View>(null);

  const cellWidth = Math.floor((width - GUTTER * 2 - GAP * (COLUMNS - 1)) / COLUMNS);
  const cellHeight = Math.round(cellWidth * RATIO);

  const thumbnails = usePageThumbnails({ profileId, documentId });
  const { uriFor, request, rendering, onRendered, onFailed } = thumbnails;

  const pages = useMemo(
    () => Array.from({ length: Math.max(0, pageCount) }, (_, i) => i + 1),
    [pageCount],
  );

  // Only what is on screen is ever asked for. This is the whole of the
  // difference between rendering six pages and rendering four hundred.
  const onViewable = useCallback(
    ({ viewableItems }: { viewableItems: { item: unknown }[] }) => {
      for (const entry of viewableItems) {
        request(entry.item as number);
      }
    },
    [request],
  );

  /**
   * The screen the grid opens on, asked for once rather than waited for.
   *
   * Viewability fires when the list *settles*, which on a list that opened
   * scrolled to page 300 is a moment later — and for pages already on disk that
   * moment was six seconds of empty cells for no work at all. This asks for the
   * opening window directly; `request` ignores anything already known, so the
   * two paths cannot duplicate work.
   */
  useEffect(() => {
    const first = Math.max(1, currentPage - WARM_BEFORE);
    const last = Math.min(pageCount, currentPage + WARM_AFTER);
    for (let page = first; page <= last; page++) {
      request(page);
    }
  }, [currentPage, pageCount, request]);

  return (
    <>
      <FlashList
        data={pages}
        numColumns={COLUMNS}
        keyExtractor={(item) => String(item)}
        contentContainerStyle={CONTENT}
        // The page somebody is 300 pages into is the one they came here from.
        initialScrollIndex={Math.max(0, currentPage - 1)}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={VIEWABILITY}
        renderItem={({ item }) => {
          const page = item;
          const here = page === currentPage;
          const file = uriFor(page);
          return (
            <Pressable
              onPress={() => onJump(page)}
              accessibilityRole="button"
              accessibilityState={{ selected: here }}
              accessibilityLabel={`Page ${page} of ${pageCount}`}
              style={{ width: cellWidth, marginBottom: ROW_GAP }}>
              <VStack className="items-center">
                <Box
                  style={{ width: cellWidth, height: cellHeight }}
                  className={
                    here
                      ? 'overflow-hidden rounded-md border-2 border-primary bg-sunken'
                      : 'overflow-hidden rounded-md border border-border bg-sunken'
                  }>
                  {file === null ? null : (
                    <Image
                      source={{ uri: file }}
                      // Covers live in a recycled list; without this a cell shows
                      // the previous page for a frame while the next decodes.
                      recyclingKey={`${documentId}-${page}`}
                      contentFit="contain"
                      alt={`Page ${page}`}
                      style={{ width: '100%', height: '100%' }}
                    />
                  )}
                </Box>
                <Text size="2xs" className={here ? 'mt-1 text-primary' : 'mt-1 text-fg-subtle'}>
                  {page}
                </Text>
              </VStack>
            </Pressable>
          );
        }}
      />

      {/*
        The one renderer, off-screen.

        Positioned past the edge rather than hidden: `display: none` and zero
        opacity both give Android nothing to snapshot, which is the same reason
        `DocumentProbe` sits where it does. Every safety prop the reader's canvas
        sets is set here too — a second `<Pdf>` quietly keeping `trustAllCerts`
        at its `true` default would undo the guarantee the first one makes.
      */}
      {rendering === null ? null : (
        <View style={OFFSCREEN} pointerEvents="none" collapsable={false}>
          <View ref={host} collapsable={false} style={THUMBNAIL_RENDER}>
            <Pdf
              // Remounted per page. Driving `page` as a prop on one mount looks
              // cheaper and is not: the capture has to happen after *that* page
              // paints, and a prop change gives no callback that says it has.
              key={rendering}
              source={{ uri }}
              page={rendering}
              password={password}
              singlePage
              fitPolicy={2}
              spacing={0}
              scrollEnabled={false}
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              trustAllCerts={false}
              enableAnnotationRendering={false}
              enableTextSelection={false}
              enableDoubleTapZoom={false}
              renderActivityIndicator={() => <View />}
              onLoadComplete={() => onRendered(host)}
              onError={onFailed}
              style={{
                ...THUMBNAIL_RENDER,
                backgroundColor: themeColors[theme].background,
              }}
            />
          </View>
        </View>
      )}
    </>
  );
}

const CONTENT = { paddingHorizontal: GUTTER, paddingTop: 14, paddingBottom: 32 } as const;

/**
 * What counts as on screen.
 *
 * A low threshold on purpose: a cell half in view is one the reader is about to
 * see, and rendering it a second early is the difference between a grid that
 * fills as you scroll and one that fills after you stop.
 */
const VIEWABILITY = { itemVisiblePercentThreshold: 10 } as const;

/** A little over one screen either side of where the grid opens. */
const WARM_BEFORE = 5;
const WARM_AFTER = 13;

const OFFSCREEN = {
  position: 'absolute',
  left: -THUMBNAIL_RENDER.width * 2,
  top: 0,
  ...THUMBNAIL_RENDER,
} as const;

/** Kept for the label height the row measurement used to need. */
export const PAGE_CELL_LABEL = LABEL;
