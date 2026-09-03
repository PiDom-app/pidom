import React, { useMemo } from 'react';

import { Box } from '@/components/ui/box';
import { Image } from '@/components/ui/image';
import { Text } from '@/components/ui/text';
import { useResolvedTheme } from '@/providers/theme-provider';
import { useLocalLibraryStore } from '@/stores/local-library-store';

import { localCoverUri } from '../local/paths';
import { coverTint } from './cover-tints';

/**
 * A document's cover.
 *
 * The rendered first page when this device has one, and otherwise a page-shaped
 * surface with the title set in type, tinted from the document id.
 *
 * Import renders the real page now — see `cover-renderer.tsx` — so the tint is
 * the fallback rather than the only answer: a document imported before that
 * existed, one whose render failed, or one that arrived from another device
 * whose cover has not been fetched yet.
 *
 * The cover is read off the filesystem rather than from a URL. Every download
 * here is authenticated, so rendering from the server would mean a rail of
 * twelve images each carrying a bearer token that rotates hourly — a bad trade
 * against one 40 KB fetch that lands on disk and stays.
 */

/** 1 : 1.417, which is a page. */
export const COVER_RATIO = 170 / 120;
/** The rail's cover width. The grid passes its own. */
export const COVER_WIDTH = 120;

export function coverHeight(width: number): number {
  return Math.round(width * COVER_RATIO);
}

export function DocumentCover({
  documentId,
  title,
  width = COVER_WIDTH,
  dimmed = false,
}: {
  documentId: string;
  title: string;
  width?: number;
  /** For a document this device does not hold. */
  dimmed?: boolean;
}) {
  const theme = useResolvedTheme();
  const profileId = useLocalLibraryStore((state) => state.profileId);
  const coverEpoch = useLocalLibraryStore((state) => state.coverEpoch);
  // Recomputed when the document changes, or when covers land — not on every
  // render: `File.exists` is a filesystem stat, and a rail is twelve of these.
  const thumbnailUri = useMemo(
    () => (profileId === null ? null : localCoverUri(profileId, documentId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `coverEpoch` is
    // the subscription to a filesystem React cannot watch.
    [profileId, documentId, coverEpoch],
  );
  const tint = coverTint(documentId, theme);
  const height = coverHeight(width);

  // The one place in the feature that sets a colour outside the token system,
  // and it has to: the tint is chosen per document out of twenty-four values,
  // which is not something a className can express. Everything else on the
  // screen goes through `global.css`.
  const surface = {
    width,
    height,
    backgroundColor: tint.bg,
    opacity: dimmed ? 0.4 : 1,
  };
  const ink = { color: tint.fg };

  const scale = width / COVER_WIDTH;

  return (
    <Box className="overflow-hidden rounded-md" style={surface}>
      {thumbnailUri === null ? (
        <Box className="flex-1 p-2.5">
          <Text
            numberOfLines={5}
            className="font-semibold"
            // Scaled with the cover so a 44px list thumbnail and a 120px rail
            // cover read as the same object rather than two designs.
            style={{ ...ink, fontSize: Math.max(7, 12.5 * scale), lineHeight: Math.max(9, 16 * scale) }}>
            {title}
          </Text>
          {width >= 70 ? (
            <Text
              className="absolute right-2 bottom-1.5 font-semibold tracking-widest opacity-50"
              style={{ ...ink, fontSize: 8 * scale }}>
              PDF
            </Text>
          ) : null}
        </Box>
      ) : (
        <Image
          source={{ uri: thumbnailUri }}
          // Without this a recycled cell shows the previous document's cover
          // for a frame, which on a fast scroll reads as the library
          // reshuffling itself.
          recyclingKey={documentId}
          alt=""
          size="full"
          contentFit="cover"
        />
      )}

      {/* A hairline inside the edge, so a pale cover on a white background
          still has a shape. Absolute rather than a border so it does not
          change the cover's size. */}
      <Box className="absolute inset-0 rounded-md border border-foreground/5" pointerEvents="none" />
    </Box>
  );
}
