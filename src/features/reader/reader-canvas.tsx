import React, { useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';
import Pdf, { type PdfRef, type TableContent } from 'react-native-pdf';

import type { ReadingMode } from '@convex/model/library';
import { READER_ZOOM_MAX } from '@convex/model/limits';
import { themeColors, type ThemeName } from '@/design/tokens';
import { log } from '@/lib/logger';
import { FIT_POLICY, type FitPolicy } from '@/stores/reader-store';

const SCOPE = 'reader-canvas';

/**
 * The document itself.
 *
 * This is the whole of the boundary between the two halves of the reader.
 * `react-native-pdf` owns page rendering, document loading, pinch, double tap
 * and panning; everything around it is React Native's. Nothing in here reaches
 * across, and in particular there is **no application-level zoom**: the
 * renderer's is native, and a second one layered over it is two gesture
 * recognisers competing for the same fingers.
 *
 * ## The hardened prop set
 *
 * Three of these are defaults the package chose and this application should
 * not inherit silently:
 *
 * - **`trustAllCerts={false}`.** It defaults to `true`, which turns off
 *   certificate validation. Pidom only ever opens a `file://` URI so nothing
 *   is fetched here at all — which is exactly why it must be set: the day
 *   somebody passes a URL, the safe behaviour should already be in place
 *   rather than needing to be remembered.
 * - **`enableAnnotationRendering={true}`, set explicitly.** Links and
 *   highlights are content, and a document with dead cross-references is a
 *   worse document. It is safe because `onPressLink` refuses everything that
 *   is not `https:` and shows the reader the host first — see
 *   `open-pdf-link.ts`. Written out so that turning it off is a decision
 *   rather than an accident.
 * - **`style.backgroundColor`.** The package hardcodes `#EEE` underneath the
 *   caller's style, so in dark mode the margin around a page rendered light
 *   grey. This is one of the few legal reads of `tokens.ts`: `<Pdf>` takes a
 *   style object, not a className, so it cannot see the CSS custom properties.
 *
 * ## Modes
 *
 * `continuous` and `single` are one renderer with different props.
 * `spread` is two, because `react-native-pdf` has no two-page layout —
 * `enablePaging` shows one page and `horizontal` picks an axis, and neither
 * composes into a spread. Two instances is the honest implementation and its
 * cost, a second copy of the document open, is why the mode is gated on width.
 *
 * A mode change **remounts** rather than re-rendering. The layout props reach
 * the native view directly, and trusting an Android `PdfView` to reflow from
 * scrolling to paged in place is trusting behaviour nobody designed. A reload
 * on an explicit menu tap is the cheaper thing to be wrong about.
 */

export type ReaderCanvasRef = {
  /** The one way anything moves the page. See `reader-commands.ts`. */
  setPage: (page: number) => void;
};

const ROW = { flex: 1, flexDirection: 'row' } as const;
const FILL = { flex: 1 } as const;

export function ReaderCanvas({
  ref,
  uri,
  page,
  pageCount,
  mode,
  fit,
  password,
  title,
  theme,
  onLoadComplete,
  onPageChanged,
  onError,
  onTap,
  onScaleChanged,
  onPressLink,
  onSelectionChange,
  onLoadProgress,
}: {
  ref?: React.Ref<ReaderCanvasRef>;
  /** The canonical local path. `documentFile(profileId, documentId).uri`. */
  uri: string;
  page: number;
  /** `null` until the renderer has counted. The spread will not pair without it. */
  pageCount: number | null;
  mode: ReadingMode;
  fit: FitPolicy;
  /** Only for an encrypted document; never logged, never sent anywhere. */
  password?: string;
  /** For assistive tech: the largest thing on screen should not be unlabelled. */
  title: string;
  theme: ThemeName;
  /**
   * The page count, and the document's own table of contents when it declares
   * one.
   *
   * `tableContents` used to be dropped here. The outline was read once, at
   * import, by the probe — so a document imported before outlines existed, or
   * one whose probe failed, never gained one however many times it was opened.
   * The renderer hands it back on every load; the screen decides whether it is
   * worth writing.
   */
  onLoadComplete: (pageCount: number, tableContents?: TableContent[]) => void;
  onPageChanged: (page: number) => void;
  onError: (error: Error) => void;
  onTap: () => void;
  onScaleChanged: (scale: number) => void;
  onPressLink: (url: string) => void;
  /** iOS only. `null` when the selection is cleared. */
  onSelectionChange: (text: string | null) => void;
  /** 0..1 while the renderer opens the file. Drives the bar on the opening state. */
  onLoadProgress: (progress: number) => void;
}) {
  const pdf = useRef<PdfRef>(null);

  useImperativeHandle(ref, () => ({
    setPage: (next: number) => pdf.current?.setPage(next),
  }));

  const background = themeColors[theme].background;
  const style = { flex: 1, backgroundColor: background } as const;

  /**
   * A failure on the right half of a spread.
   *
   * Swallowed on purpose. The left pane is the document as far as the rest of
   * the reader is concerned — it holds the ref, reports the page and reports
   * the count — so a right pane that will not render is a missing facing page,
   * not a document that will not open. Escalating it is exactly the bug this
   * split exists to fix.
   */
  const onRightPaneError = (error: Error) => {
    log.debug(SCOPE, 'the facing page did not render', error);
  };

  // Every mount shares these, including the right-hand page of a spread. A
  // prop that matters for safety belongs in one object, not typed out twice.
  const guarded = {
    trustAllCerts: false,
    enableAnnotationRendering: true,
    enableAntialiasing: true,
    // The renderer's zoom is the only zoom. There is no `scale` prop from this
    // side: it existed for a `resetZoom` command that never had a caller, so it
    // was pinned at 1 for the life of the feature and the renderer's own pinch
    // and double-tap did all the work anyway. `react-native-pdf` defaults it to
    // 1.0, which is what it always was.
    minScale: 1,
    maxScale: READER_ZOOM_MAX,
    enableDoubleTapZoom: true,
    // On by default, and until now on silently: an iOS reader could already
    // select text and reach the system share sheet with nothing here knowing.
    // Stated rather than inherited, so turning it off is a decision.
    enableTextSelection: true,
    // Without this the package renders an unstyled `<Text>0.00%</Text>` in
    // React Native's default colour every time a mount re-opens the file. It
    // must return an element, so it returns an empty one; the opening state is
    // drawn by the screen, over the top.
    renderActivityIndicator: () => <View />,
    onPressLink,
    onTextSelectionChange: (event: {
      nativeEvent: { type: 'selectionCleared' } | { type: 'selectionChanged'; text: string };
    }) => {
      onSelectionChange(
        event.nativeEvent.type === 'selectionChanged' ? event.nativeEvent.text : null,
      );
    },
  } as const;

  if (mode === 'spread') {
    // Pairs are (2,3), (4,5)… with page 1 alone, the way a printed book opens:
    // a cover faces nothing. Pairing from 0 instead put page 2 in two different
    // spreads — arriving at 1 gave (1,2) and arriving at 2 gave (2,3).
    const left = page <= 1 ? 1 : page % 2 === 0 ? page : page - 1;
    const right = left === 1 ? null : left + 1;

    // The right pane is dropped rather than asked for a page past the end. It
    // used to be `left + 1` unconditionally with no `pageCount` to check
    // against, so the last spread of an even-length document requested page 499
    // of 499 — and because both panes shared one `onError`, that failure
    // condemned the whole document to "This file will not open".
    const showRight = right !== null && (pageCount === null || right <= pageCount);

    return (
      <View style={ROW} accessibilityLabel={title}>
        <Pdf
          {...guarded}
          ref={pdf}
          source={{ uri }}
          page={left}
          password={password}
          // `singlePage` is the package's own primitive for "one page, no
          // scrolling". `scrollEnabled={false}` faked it and took the page-turn
          // gesture with it, so a spread could only be moved by the scrubber.
          singlePage
          fitPolicy={FIT_POLICY.height}
          spacing={0}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          onPageSingleTap={onTap}
          onScaleChanged={onScaleChanged}
          onError={onError}
          // Only the left pane reports position. Two renderers answering the
          // same question is two answers to reconcile for no extra information.
          onLoadComplete={(count, _p, _sz, toc) => onLoadComplete(count, toc)}
          onPageChanged={(current) => onPageChanged(current)}
          onLoadProgress={onLoadProgress}
          style={style}
        />
        {showRight ? (
          <Pdf
            {...guarded}
            source={{ uri }}
            page={right}
            password={password}
            singlePage
            fitPolicy={FIT_POLICY.height}
            spacing={0}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            onPageSingleTap={onTap}
            // Same gesture, same intent, same outcome. Without this, pinching
            // the right page left the controls up and pinching the left page
            // took them down.
            onScaleChanged={onScaleChanged}
            // Its own handler. A right-pane failure is a half-spread, not a
            // broken document, so it is reported and not escalated.
            onError={onRightPaneError}
            style={style}
          />
        ) : null}
      </View>
    );
  }

  const horizontal = mode === 'single';
  return (
    // The wrapper carries the label because `PdfProps` does not extend
    // `ViewProps` — without it the largest thing on screen is unnamed to a
    // screen reader.
    <View style={FILL} accessibilityLabel={title}>
    <Pdf
      {...guarded}
      ref={pdf}
      source={{ uri }}
      page={page}
      password={password}
      onError={onError}
      horizontal={horizontal}
      enablePaging={horizontal}
      // Fit-to-width in continuous, so the measure is the same on every page
      // however the pages themselves are proportioned. One page at a time gets
      // the whole page on screen instead.
      fitPolicy={horizontal ? FIT_POLICY.both : FIT_POLICY[fit]}
      spacing={horizontal ? 0 : 8}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      onPageSingleTap={onTap}
      onScaleChanged={onScaleChanged}
      onLoadComplete={(count, _p, _sz, toc) => onLoadComplete(count, toc)}
      onPageChanged={(current) => onPageChanged(current)}
      onLoadProgress={onLoadProgress}
      style={style}
    />
    </View>
  );
}
