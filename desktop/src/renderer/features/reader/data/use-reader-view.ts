import { useCallback, useMemo, useState } from 'react';
import { READER_ZOOM_MAX } from '@convex-model/limits';
import type { PageSize } from '../pdf/engine';
import type { ReaderPreferences } from './use-reader-preferences';

/**
 * The reader's own view state — the choices that are this machine's, not the
 * account's.
 *
 * View mode, fit, and zoom sync nowhere: a fit chosen for a 27-inch display is
 * not one anybody wants restored on a laptop, so the account stores the *default*
 * (see `use-reader-preferences.ts`) and this holds what the reader has done to it
 * since. The account default seeds the initial state; changing it here does not
 * write back.
 */

export type ViewMode = 'continuous' | 'single' | 'spread';
export type Fit = 'fit-width' | 'fit-page' | 'auto' | 'manual';

/** Below and above this, zoom is not reading, it is inspecting or losing text. */
const ZOOM_MIN = 0.25;

export interface ReaderView {
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  fit: Fit;
  /** The applied scale at fit-* is derived from the container; manual owns its own. */
  manualScale: number;
  setFit: (fit: Fit) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** The scale a page should render at, given the space it has. */
  scaleFor: (page: PageSize, containerWidth: number, containerHeight: number) => number;
}

/** The account default maps onto the initial fit; `last-used` falls back to width. */
function initialFit(scaling: ReaderPreferences['pageScaling']): Fit {
  switch (scaling) {
    case 'fit-page':
      return 'fit-page';
    case 'auto':
      return 'auto';
    case 'fit-width':
    case 'last-used':
    default:
      return 'fit-width';
  }
}

export function useReaderView(prefs: ReaderPreferences): ReaderView {
  const [mode, setMode] = useState<ViewMode>(prefs.defaultViewMode);
  const [fit, setFitState] = useState<Fit>(() => initialFit(prefs.pageScaling));
  const [manualScale, setManualScale] = useState(1);

  const setFit = useCallback((next: Fit) => setFitState(next), []);

  const clamp = useCallback(
    (scale: number) => Math.min(READER_ZOOM_MAX, Math.max(ZOOM_MIN, scale)),
    [],
  );

  // A manual zoom takes over from a fit: the reader asked for an exact size, so
  // the container no longer decides it.
  const zoomIn = useCallback(() => {
    setManualScale((s) => clamp((fit === 'manual' ? s : 1) * 1.25));
    setFitState('manual');
  }, [clamp, fit]);

  const zoomOut = useCallback(() => {
    setManualScale((s) => clamp((fit === 'manual' ? s : 1) / 1.25));
    setFitState('manual');
  }, [clamp, fit]);

  const scaleFor = useCallback(
    (page: PageSize, containerWidth: number, containerHeight: number) => {
      if (fit === 'manual') return manualScale;
      // A spread lays two pages side by side, so each gets half the width.
      const usableWidth = mode === 'spread' ? containerWidth / 2 : containerWidth;
      const widthScale = usableWidth / page.width;
      if (fit === 'fit-width') return clamp(widthScale);
      const heightScale = containerHeight / page.height;
      if (fit === 'fit-page') return clamp(Math.min(widthScale, heightScale));
      // auto: fill the width, but never blow a small page up past its own size.
      return clamp(Math.min(widthScale, 1.5));
    },
    [fit, manualScale, mode, clamp],
  );

  return useMemo(
    () => ({ mode, setMode, fit, manualScale, setFit, zoomIn, zoomOut, scaleFor }),
    [mode, fit, manualScale, setFit, zoomIn, zoomOut, scaleFor],
  );
}
