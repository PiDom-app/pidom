/**
 * Whether there is room, asked before anything is written.
 *
 * Until this existed the only acknowledgement that a phone can be full was a
 * guessed sentence in an import's error handler — the write was attempted, it
 * failed somewhere inside a copy, and the reader was told there "may not be"
 * enough space. A 400 MB textbook that fills the last of a device does worse
 * than fail: it can take the database and the rest of the library down with it,
 * because everything else on the phone is also mid-write.
 *
 * `Paths.availableDiskSpace` is a synchronous property in the current
 * `expo-file-system`, so this costs nothing to ask.
 */
import { Paths } from 'expo-file-system';

import { formatBytes } from '../data/types';

/**
 * What is left over after a document is copied in.
 *
 * 64 MB rather than zero. A copy is not the only thing writing to the disk —
 * the database has a write-ahead log, the renderer caches page thumbnails, and
 * the operating system wants room to breathe before it starts refusing things
 * the app never asked about. Filling a device exactly to the top is a way to
 * fail at everything at once a minute later.
 */
export const HEADROOM_BYTES = 64 * 1024 * 1024;

export type SpaceCheck =
  { ok: true } | { ok: false; needed: number; available: number; message: string };

/**
 * Whether `bytes` can be written.
 *
 * The message is built here rather than at each call site so that the two
 * numbers a reader needs — how much this takes, how much they have — are said
 * the same way wherever it is refused.
 */
export function roomFor(bytes: number): SpaceCheck {
  const available = Paths.availableDiskSpace;

  // A device that will not report its free space is not a device to refuse an
  // import on. The copy either works or fails on its own terms, which is where
  // this started.
  if (!Number.isFinite(available) || available <= 0) {
    return { ok: true };
  }

  const needed = bytes + HEADROOM_BYTES;
  if (available >= needed) {
    return { ok: true };
  }

  return {
    ok: false,
    needed: bytes,
    available,
    message: `This document needs ${formatBytes(bytes)} and there is ${formatBytes(
      available,
    )} free on this device. Remove a download or two and try again.`,
  };
}
