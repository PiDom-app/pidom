/**
 * Reading an outline, in the three places that want to.
 *
 * The Contents sheet marks the entry the reader is inside, the scrubber names
 * the chapter under the thumb, and the track draws a tick at each chapter start.
 * All three need the same question answered, so it is answered once.
 */

export type OutlineEntry = { title: string; page: number; depth: number };

/**
 * The index of the last entry starting at or before `page`, or `-1`.
 *
 * A linear scan. An outline is capped at `OUTLINE_ENTRY_MAX` and is not sorted
 * by page — a PDF can, and does, declare bookmarks out of order — so a binary
 * search would be wrong before it was fast.
 */
export function lastStartingBefore(entries: readonly { page: number }[], page: number): number {
  let best = -1;
  let bestPage = 0;
  for (let i = 0; i < entries.length; i++) {
    const start = entries[i].page;
    if (start <= page && start >= bestPage) {
      best = i;
      bestPage = start;
    }
  }
  return best;
}

/** The title of the chapter containing `page`, or `null`. */
export function chapterAt(
  entries: readonly OutlineEntry[] | undefined,
  page: number,
): string | null {
  if (entries === undefined || entries.length === 0) {
    return null;
  }
  const index = lastStartingBefore(entries, page);
  return index === -1 ? null : entries[index].title;
}
