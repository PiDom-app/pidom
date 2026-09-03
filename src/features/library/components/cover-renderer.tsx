import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import React, { useCallback, useRef, useState } from 'react';
import Pdf from 'react-native-pdf';
import { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { log } from '@/lib/logger';

const SCOPE = 'cover';

/**
 * Rendering a PDF's first page to a JPEG.
 *
 * There is no library that turns a PDF page into an image on React Native 0.86.
 * The two purpose-built ones were last published in November 2023 and September
 * 2024, neither declaring New Architecture support, and 0.86 is bridgeless-only.
 * So the page is rendered by the viewer that is already here and already
 * maintained — `react-native-pdf` 7.0.5, which ships `codegenConfig` — and
 * snapshotted out of the view tree.
 *
 * It is mounted, not called, because that is what rendering a native view
 * requires: this is a component with a callback, and the import screen keeps it
 * on screen (at zero opacity) for the second or two the render takes.
 *
 * The page count falls out of the same load. `onLoadComplete` hands back
 * `numberOfPages`, which is the first point in the app's life where that number
 * is knowable — until now a freshly imported document showed its file size
 * because nothing could count its pages.
 */

/** Rendered at cover proportions, then downscaled. 1 : 1.417 is a page. */
const RENDER_WIDTH = 320;
const RENDER_HEIGHT = 453;
/** What ends up on disk. Twice the 120pt rail cover on a 3x screen is plenty. */
const OUTPUT_WIDTH = 600;

export type CoverResult = {
  /**
   * A JPEG in the cache directory.
   *
   * Deliberately not in the library: the cover is rendered before the document
   * row exists, so there is no id yet to name it after. The import flow moves
   * it into place once Convex has minted one — see `use-import-flow.ts`.
   */
  uri: string;
  pageCount: number;
};

export function CoverRenderer({
  pdfUri,
  onDone,
}: {
  /** The picked PDF, wherever it currently is. */
  pdfUri: string;
  /** Called once, with the cover or with `null` if it could not be made. */
  onDone: (result: CoverResult | null) => void;
}) {
  const hostRef = useRef<View>(null);
  const pagesRef = useRef(1);
  // A ref, not state: the guard has to hold within a single tick, and
  // `onLoadComplete` can fire more than once on Android.
  const doneRef = useRef(false);
  const [failed, setFailed] = useState(false);

  const capture = useCallback(async () => {
    if (doneRef.current) {
      return;
    }
    doneRef.current = true;

    try {
      const shot = await captureRef(hostRef, {
        format: 'jpg',
        quality: 0.9,
        result: 'tmpfile',
      });

      // The chained context API. `manipulateAsync` and `useImageManipulator`
      // are both deprecated.
      const context = ImageManipulator.manipulate(shot);
      context.resize({ width: OUTPUT_WIDTH });
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: 0.7,
      });

      onDone({ uri: saved.uri, pageCount: pagesRef.current });
    } catch (error) {
      // A cover is decoration. Failing to make one must not fail an import —
      // the tinted fallback already covers its absence, and always will for
      // documents that arrive from another device before their cover does.
      log.error(SCOPE, 'could not render a cover');
      log.debug(SCOPE, 'render failed', error);
      onDone(null);
    }
  }, [onDone]);

  if (failed) {
    return null;
  }

  return (
    // Off-screen rather than hidden: `display: none` and zero opacity both give
    // Android nothing to snapshot. Positioning it past the edge keeps it laid
    // out and drawn while never appearing.
    <View
      style={HOST}
      pointerEvents="none"
      // Android collapses single-child views out of the hierarchy, and a view
      // that is not in the hierarchy cannot be captured.
      collapsable={false}>
      <View ref={hostRef} collapsable={false} style={CANVAS}>
        <Pdf
          source={{ uri: pdfUri }}
          page={1}
          singlePage
          scale={1}
          style={CANVAS}
          trustAllCerts={false}
          onLoadComplete={(numberOfPages) => {
            pagesRef.current = numberOfPages;
            // A frame for the page to actually paint before the snapshot.
            // Capturing inside the load callback yields a blank canvas.
            setTimeout(() => void capture(), 350);
          }}
          onError={(error) => {
            log.debug(SCOPE, 'pdf failed to load', error);
            if (!doneRef.current) {
              doneRef.current = true;
              setFailed(true);
              onDone(null);
            }
          }}
        />
      </View>
    </View>
  );
}

const HOST = {
  position: 'absolute',
  left: -RENDER_WIDTH * 2,
  top: 0,
  width: RENDER_WIDTH,
  height: RENDER_HEIGHT,
} as const;

const CANVAS = { width: RENDER_WIDTH, height: RENDER_HEIGHT } as const;
