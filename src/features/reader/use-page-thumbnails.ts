import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useCallback, useEffect, useRef, useState } from 'react';
import { captureRef } from 'react-native-view-shot';
import type { View } from 'react-native';

import { keepPageThumbnail, pageThumbnailUri } from '../library/local/paths';

/**
 * Turning pages of the open document into files, one at a time.
 *
 * **Why this exists**: a thumbnail is a live `<Pdf singlePage>` otherwise, and a
 * screen of nine of them is nine native document handles over the same file.
 * Measured on a device, that took eight seconds to paint one screen of a
 * 433-page book and every scroll paid it again. Rendered once and kept, the grid
 * is `expo-image` over files on disk.
 *
 * **One at a time, and only what is on screen.** `request` is called by the
 * grid for the cells it can actually see; the queue keeps a single renderer
 * mounted and steps it through them. Four hundred pages are never rendered
 * because four hundred pages are never looked at.
 *
 * The renderer is the same one `DocumentProbe` uses for a cover — off-screen,
 * `captureRef`, downscale, save — because there is no library that turns a PDF
 * page into an image on React Native 0.86 and this app already answered that
 * question once.
 *
 * The split between what is state and what is a ref is the React rule and not a
 * preference. `known` is read while rendering a cell, so it is state. The queue
 * and the in-flight flag are only ever touched from a handler or a callback, so
 * they are refs — and nothing here reads a ref during render.
 */

/** Small enough to be cheap, twice the cell on a 3x screen so it is not soft. */
const RENDER_WIDTH = 210;
const RENDER_HEIGHT = 297;
const OUTPUT_WIDTH = 320;

/**
 * A frame for the page to paint before the snapshot.
 *
 * The same 350ms the import probe waits. Capturing inside `onLoadComplete`
 * yields a blank canvas — that is not a guess, it is why the probe waits.
 */
const PAINT_MS = 350;

/** Past this the queue drops its oldest: the reader has scrolled away from it. */
const QUEUE_MAX = 64;

export type PageThumbnails = {
  /** The file for a page, or `null` if there is not one yet. A pure map read. */
  uriFor: (page: number) => string | null;
  /** Ask for a page. Cheap and idempotent; already-rendered pages are ignored. */
  request: (page: number) => void;
  /** The page the off-screen renderer should be showing, or `null` when idle. */
  rendering: number | null;
  /** Called once that renderer reports the page is loaded. */
  onRendered: (host: React.RefObject<View | null>) => void;
  /** Called when it fails. The page is skipped rather than retried. */
  onFailed: () => void;
};

/**
 * `profileId` and `documentId` are fixed for the life of this hook: it is used
 * by one screen, and that screen is a route keyed by the document. There is no
 * reset path because there is no way to reach one.
 */
export function usePageThumbnails({
  profileId,
  documentId,
}: {
  profileId: string;
  documentId: string;
}): PageThumbnails {
  const [known, setKnown] = useState<ReadonlyMap<number, string | null>>(() => new Map());
  const [rendering, setRendering] = useState<number | null>(null);

  const queue = useRef<number[]>([]);
  const busy = useRef(false);
  /**
   * What `known` holds, readable from a handler.
   *
   * `request` must be **stable**, and it cannot be if it closes over `known`.
   * `onViewableItemsChanged` is captured once — React Native is explicit that
   * changing it on the fly is not supported — so a `request` that changed
   * identity left the list holding the version from the first render. The
   * symptom was a grid that had every page cached on disk and still showed a
   * blank row for six seconds, because the only thing that asked for them was a
   * closure from before they existed.
   */
  const seen = useRef<ReadonlyMap<number, string | null>>(known);

  const uriFor = useCallback((page: number) => known.get(page) ?? null, [known]);

  const remember = useCallback((page: number, uri: string | null) => {
    setKnown((current) => {
      const next = new Map(current);
      next.set(page, uri);
      seen.current = next;
      return next;
    });
  }, []);

  const next = useCallback(() => {
    if (busy.current) {
      return;
    }
    const page = queue.current.shift();
    if (page === undefined) {
      setRendering(null);
      return;
    }
    busy.current = true;
    setRendering(page);
  }, []);

  const request = useCallback(
    (page: number) => {
      if (seen.current.has(page) || queue.current.includes(page)) {
        return;
      }
      // The disk is asked here rather than while rendering a cell, so a
      // thumbnail made in a previous session is used without re-rendering
      // anything and without a filesystem call on the render path.
      const existing = pageThumbnailUri(profileId, documentId, page);
      if (existing !== null) {
        remember(page, existing);
        return;
      }
      if (queue.current.length >= QUEUE_MAX) {
        // The reader has scrolled far past what is queued, so what is queued is
        // no longer what they are looking at. Newest wins.
        queue.current.shift();
      }
      queue.current.push(page);
      next();
    },
    [profileId, documentId, remember, next],
  );

  const finish = useCallback(
    (page: number, uri: string | null) => {
      busy.current = false;
      remember(page, uri);
      next();
    },
    [remember, next],
  );

  const onRendered = useCallback(
    (host: React.RefObject<View | null>) => {
      const page = rendering;
      if (page === null) {
        return;
      }
      setTimeout(() => {
        void (async () => {
          try {
            const shot = await captureRef(host, {
              format: 'jpg',
              quality: 0.8,
              result: 'tmpfile',
            });
            const context = ImageManipulator.manipulate(shot);
            context.resize({ width: OUTPUT_WIDTH });
            const rendered = await context.renderAsync();
            const saved = await rendered.saveAsync({
              format: SaveFormat.JPEG,
              compress: 0.6,
            });
            const kept = keepPageThumbnail(profileId, documentId, page, saved.uri);
            finish(page, kept ? pageThumbnailUri(profileId, documentId, page) : null);
          } catch {
            // A page that will not snapshot is a blank cell with its number
            // under it. Nothing here is worth a message.
            finish(page, null);
          }
        })();
      }, PAINT_MS);
    },
    [rendering, profileId, documentId, finish],
  );

  const onFailed = useCallback(() => {
    if (rendering !== null) {
      finish(rendering, null);
    }
  }, [rendering, finish]);

  // The queue stops when this screen unmounts, which is when the reader goes
  // back to the document. Nothing keeps rendering behind them.
  useEffect(
    () => () => {
      queue.current.length = 0;
      busy.current = false;
    },
    [],
  );

  return { uriFor, request, rendering, onRendered, onFailed };
}

export const THUMBNAIL_RENDER = { width: RENDER_WIDTH, height: RENDER_HEIGHT } as const;
