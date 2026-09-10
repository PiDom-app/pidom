import { useCallback, useRef } from 'react';
import type { TableContent } from 'react-native-pdf';

import { OUTLINE_DEPTH_MAX, OUTLINE_ENTRY_MAX } from '@convex/model/limits';
import { log } from '@/lib/logger';

import { useLibraryStatus } from '../library/data/use-library-status';
import { database } from '../library/local/db';
import * as Documents from '../library/local/repository/documents';
import * as Queue from '../library/local/repository/queue';

const SCOPE = 'reader-outline';

/** One line of the Contents list, flattened. The same shape everywhere. */
type OutlineEntry = { title: string; page: number; depth: number };

/**
 * Keeping the table of contents the reader's own load turned up.
 *
 * The outline is normally read once, at import, by `DocumentProbe` — but the
 * renderer hands `tableContents` back on *every* load and the reader used to
 * throw it away. So a document imported before outlines existed, or one whose
 * probe failed or was killed mid-import, had a Contents list sitting in its file
 * that this app would never see however many times somebody opened it.
 *
 * Deliberately narrow. It writes in exactly two cases:
 *
 *   - **The document has no outline.** A document that already has a good one
 *     keeps it: re-writing on every open would be a mutation per reading
 *     session for no change, and would let a load that reported nothing wipe a
 *     list the probe read correctly.
 *   - **The outline it has is the one the old probe produced.** Before the
 *     `singlePage` bug in `document-probe.tsx` was found, the viewer reported
 *     every document as one page long and `flatten` clamped every entry to page
 *     1 — so a 433-page book stored 355 contents rows all pointing at its
 *     cover. Those documents are still in libraries and their Contents list is
 *     355 ways of going to page 1. `isDegenerate` is what recognises one, and
 *     it cannot false-positive on a real outline: a document with more than one
 *     page and more than one entry does not legitimately declare all of them on
 *     page 1.
 *   - **Once per session**, guarded by a ref rather than state, because
 *     `onLoadComplete` fires more than once on Android and a mode change
 *     remounts the canvas.
 *   - **Silent on failure.** Nobody opened a book to record its outline.
 */
export function useRecoveredOutline({
  documentId,
  hasOutline,
  stored,
}: {
  documentId: string | undefined;
  /** What the row says today. `undefined` on a document that has never said. */
  hasOutline: boolean | undefined;
  /** The stored entries, or `undefined` while they are still being read. */
  stored: readonly OutlineEntry[] | undefined;
}) {
  const { profileId } = useLibraryStatus();
  const sent = useRef(false);

  return useCallback(
    (pageCount: number, tableContents?: TableContent[]) => {
      if (sent.current || documentId === undefined) {
        return;
      }
      if (hasOutline === true) {
        // Still loading, or a good outline. Either way, leave it alone.
        if (stored === undefined || !isDegenerate(stored, pageCount)) {
          return;
        }
      }
      if (tableContents === undefined || tableContents.length === 0) {
        return;
      }
      const entries = flatten(tableContents, pageCount);
      if (entries.length === 0) {
        return;
      }
      sent.current = true;
      void (async () => {
        try {
          if (profileId === null) {
            return;
          }
          const db = await database(profileId);
          if (db === null) {
            return;
          }
          await Documents.saveOutline(db, documentId, entries);
          await Documents.patchLocal(db, documentId, { hasOutline: true });
          await Queue.enqueue(db, 'document', documentId, 'update', ['hasOutline']);
        } catch (error) {
          log.debug(SCOPE, 'could not record the outline this load found', error);
        }
      })();
    },
    [documentId, profileId, hasOutline, stored],
  );
}

/**
 * An outline that says every entry is on page 1 of a document that is not.
 *
 * The signature of the old probe's page count, and not something a real PDF
 * produces: a file that declares 355 bookmarks declares them across its pages.
 * Two entries is the floor because a one-entry outline pointing at page 1 is
 * perfectly ordinary.
 */
function isDegenerate(stored: readonly OutlineEntry[], pageCount: number): boolean {
  return pageCount > 1 && stored.length > 1 && stored.every((entry) => entry.page === 1);
}

/**
 * `react-native-pdf`'s nested table of contents, as a flat list with a depth.
 *
 * The same transform `document-probe.tsx` does, and for the same reasons: the
 * sheet renders indentation rather than nesting, `v` cannot express a recursive
 * validator, and `pageIdx` is 0-based in the library and 1-based everywhere a
 * reader sees a page number.
 *
 * Bounded on both axes here as well as server-side. The server trusts none of
 * it either way; stopping here keeps a PDF with a bookmark per paragraph from
 * putting a megabyte on the wire.
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
