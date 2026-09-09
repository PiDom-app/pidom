import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import React, { useCallback, useRef, useState } from 'react';
import Pdf, { type TableContent } from 'react-native-pdf';
import { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { OUTLINE_DEPTH_MAX, OUTLINE_ENTRY_MAX } from '@convex/model/limits';
import { log } from '@/lib/logger';

const SCOPE = 'probe';

/**
 * Reading a PDF once, for everything the library needs to know about it.
 *
 * One `<Pdf>` mount answers three questions that used to be answered nowhere,
 * once, and never: how many pages the document has, what its table of contents
 * says, and what its first page looks like. `onLoadComplete` hands back the page
 * count *and* `tableContents` on the same load that the snapshot is taken from,
 * so the outline is free — it was being thrown away by a callback that ignored
 * its fourth argument.
 *
 * There is no library that turns a PDF page into an image on React Native 0.86.
 * The two purpose-built ones were last published in November 2023 and September
 * 2024, neither declaring New Architecture support, and 0.86 is bridgeless-only.
 * So the page is rendered by the viewer that is already here and already
 * maintained — `react-native-pdf` 7.0.5, which ships `codegenConfig` — and
 * snapshotted out of the view tree.
 *
 * It is mounted, not called, because that is what rendering a native view
 * requires: this is a component with a callback, and whatever screen wants an
 * answer keeps it on screen (off to the side) for the second or two it takes.
 *
 * **A password-protected PDF ends here**, which is the other thing this
 * replaced. `onError` used to be logged at debug and reported as "no cover", so
 * an encrypted document imported cleanly, got a tinted cover, and opened to a
 * blank reader with nothing to explain it.
 */

/** Rendered at cover proportions, then downscaled. 1 : 1.417 is a page. */
const RENDER_WIDTH = 320;
const RENDER_HEIGHT = 453;
/** What ends up on disk. Twice the 120pt rail cover on a 3x screen is plenty. */
const OUTPUT_WIDTH = 600;

/** One line of a Contents sheet, flattened. Matches the Convex wire shape. */
export type OutlineEntry = { title: string; page: number; depth: number };

export type ProbeResult =
  | {
      ok: true;
      /**
       * A JPEG in the cache directory, or `null` if the snapshot failed.
       *
       * Deliberately not in the library: the probe can run before the document
       * row exists, so there is no id yet to name it after. The import flow
       * moves it into place once Convex has minted one.
       */
      cover: string | null;
      pageCount: number;
      /** Empty for the many PDFs that carry no bookmarks at all. */
      outline: OutlineEntry[];
    }
  | {
      ok: false;
      /** The document has a password. It cannot be read, and will not be added. */
      reason: 'encrypted' | 'unreadable';
    };

export function DocumentProbe({
  pdfUri,
  onDone,
}: {
  /** The PDF, wherever it currently is. */
  pdfUri: string;
  /** Called exactly once. */
  onDone: (result: ProbeResult) => void;
}) {
  const hostRef = useRef<View>(null);
  const pagesRef = useRef(1);
  const outlineRef = useRef<OutlineEntry[]>([]);
  // A ref, not state: the guard has to hold within a single tick, and
  // `onLoadComplete` can fire more than once on Android.
  const doneRef = useRef(false);
  const [failed, setFailed] = useState(false);

  const capture = useCallback(async () => {
    if (doneRef.current) {
      return;
    }
    doneRef.current = true;

    // The page count and the outline are already in hand, so they are reported
    // whether or not the snapshot works. A cover is decoration; losing one must
    // not cost the reader a page count and a table of contents as well.
    const known = { pageCount: pagesRef.current, outline: outlineRef.current };

    try {
      // **The view, not the ref object.** `captureRef` used to accept either;
      // it now inspects what it is given and refuses a plain `{ current }`
      // with "Argument appears to not be a ReactComponent" — which is exactly
      // what the log said, on every import, and it cost every document its
      // cover while the page count and outline still came through.
      const host = hostRef.current;
      if (host === null) {
        throw new Error('the probe canvas was gone before it could be captured');
      }
      const shot = await captureRef(host, {
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

      onDone({ ok: true, cover: saved.uri, ...known });
    } catch (error) {
      log.error(SCOPE, 'could not render a cover');
      log.debug(SCOPE, 'render failed', error);
      // `partial`, in the row's terms: the document is real and its length is
      // known, and the tinted fallback stands in for the page.
      onDone({ ok: true, cover: null, ...known });
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
          // **Not `singlePage`.** It reads well — one page is all this needs to
          // draw — but on Android it calls `configurator.pages(0)`, and the
          // viewer then reports the length of *that* list as the document's
          // page count. So `onLoadComplete` handed back `1` for every PDF ever
          // imported: a 433-page book probed as one page long, and `flatten`
          // clamped all 355 of its contents entries to page 1, because it
          // clamps against the count it is given. The cloud text pass corrected
          // `pageCount` afterwards, which is why the count looked right while
          // every Contents row still said page 1.
          //
          // `scrollEnabled={false}` holds the view on page 1 for the snapshot,
          // which is the part `singlePage` was actually wanted for. The host
          // View is `pointerEvents="none"`, so nothing can scroll it anyway.
          scrollEnabled={false}
          scale={1}
          style={CANVAS}
          trustAllCerts={false}
          onLoadComplete={(numberOfPages, _path, _size, tableContents) => {
            pagesRef.current = numberOfPages;
            outlineRef.current = flatten(tableContents ?? [], numberOfPages);
            // A frame for the page to actually paint before the snapshot.
            // Capturing inside the load callback yields a blank canvas.
            setTimeout(() => void capture(), 350);
          }}
          onError={(error) => {
            log.debug(SCOPE, 'pdf failed to load', error);
            if (!doneRef.current) {
              doneRef.current = true;
              setFailed(true);
              onDone({ ok: false, reason: reasonOf(error) });
            }
          }}
        />
      </View>
    </View>
  );
}

/**
 * Why the viewer refused the file.
 *
 * The library reports a password the only way it can — a message, documented as
 * "Password required or incorrect password." Matching on it is fragile, and the
 * alternative is worse: an encrypted PDF that imports and then never renders,
 * which is what happened before. Anything unrecognised is `unreadable`, which
 * is the honest answer for a truncated download or a corrupt file.
 */
function reasonOf(error: unknown): 'encrypted' | 'unreadable' {
  const message = error instanceof Error ? error.message : String(error);
  return /password/i.test(message) ? 'encrypted' : 'unreadable';
}

/**
 * `react-native-pdf`'s nested table of contents, as a flat list with a depth.
 *
 * Flattened here rather than server-side because the tree is what the viewer
 * hands back and the sheet renders indentation, so nothing downstream ever
 * wants the nesting. It also keeps a recursive validator out of the schema,
 * which `v` cannot express anyway.
 *
 * `pageIdx` is 0-based in the library and 1-based everywhere a reader sees a
 * page number, which is the one conversion in this file that matters.
 *
 * Bounded on both axes. The count is checked again server-side — this runs on a
 * device and the server trusts none of it — but stopping here keeps a PDF with
 * a bookmark per paragraph from putting a megabyte on the wire.
 */
function flatten(
  entries: TableContent[],
  pageCount: number,
  depth = 0,
  out: OutlineEntry[] = [],
): OutlineEntry[] {
  for (const entry of entries) {
    if (out.length >= OUTLINE_ENTRY_MAX) {
      return out;
    }
    const title = (entry.title ?? '').trim();
    if (title !== '') {
      out.push({
        title,
        page: Math.min(Math.max(1, (entry.pageIdx ?? 0) + 1), Math.max(1, pageCount)),
        depth: Math.min(depth, OUTLINE_DEPTH_MAX - 1),
      });
    }
    if (entry.children !== undefined && entry.children.length > 0) {
      flatten(entry.children, pageCount, depth + 1, out);
    }
  }
  return out;
}

const HOST = {
  position: 'absolute',
  left: -RENDER_WIDTH * 2,
  top: 0,
  width: RENDER_WIDTH,
  height: RENDER_HEIGHT,
} as const;

const CANVAS = { width: RENDER_WIDTH, height: RENDER_HEIGHT } as const;
