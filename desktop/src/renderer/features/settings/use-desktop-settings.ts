import { useSyncExternalStore } from 'react';
import {
  applyAccent,
  applyFont,
  applyReduceMotion,
  applyScaling,
  type AccentName,
  type Density,
  type FontChoice,
  type Scaling,
} from '@/design/appearance';
import { DEFAULT_SHORTCUTS, type ShortcutId, type ShortcutMap } from './shortcuts';

/**
 * Local desktop preferences — appearance, library view, keyboard shortcuts, and
 * a cache of the account's reader defaults.
 *
 * These belong to this machine, so they live in localStorage rather than the
 * shared Convex account: the accent and font are desktop-only overrides (mobile
 * keeps the fixed purple), reduce-motion and shortcuts are per-device, and the
 * library view is a per-window choice. A module-level store with
 * useSyncExternalStore keeps this out of the provider tree, so appearance can be
 * applied at first paint before React mounts (see initAppearance / main.tsx).
 *
 * The reader defaults are the exception: they belong to the account and sync
 * through Convex (`api.reader.*`). We cache the last-known values here only so
 * the Reader settings section paints instantly on launch instead of flashing
 * defaults while `reader.mine` loads; use-reader-sync reconciles the cache with
 * the server and owns every write.
 */

/** Reader preferences — mirrors convex/model/reader.ts READER_DEFAULTS exactly. */
export type ReaderViewMode = 'continuous' | 'single' | 'spread';
export type PageScaling = 'auto' | 'fit-width' | 'fit-page' | 'last-used';
export type PageSpacing = 'compact' | 'normal' | 'relaxed';
export type DocumentBackground = 'neutral' | 'dark';
export type PageDirection = 'ltr' | 'rtl';
export type ToolbarBehavior = 'always' | 'auto-hide' | 'manual';
export type SidebarBehavior = 'open' | 'collapsed' | 'last-used';
export type PageNavigation = 'continuous' | 'snap';
/** A comfort wash laid over the page, independent of the document background. */
export type ReaderTint = 'none' | 'warm' | 'dim';

export interface ReaderPreferences {
  defaultViewMode: ReaderViewMode;
  pageScaling: PageScaling;
  pageSpacing: PageSpacing;
  documentBackground: DocumentBackground;
  pageDirection: PageDirection;
  toolbarBehavior: ToolbarBehavior;
  sidebarBehavior: SidebarBehavior;
  restorePosition: boolean;
  pageNavigation: PageNavigation;
}

/** The reader defaults, matching the server's READER_DEFAULTS. */
export const READER_DEFAULTS: ReaderPreferences = {
  defaultViewMode: 'continuous',
  pageScaling: 'fit-width',
  pageSpacing: 'normal',
  documentBackground: 'neutral',
  pageDirection: 'ltr',
  toolbarBehavior: 'auto-hide',
  sidebarBehavior: 'last-used',
  restorePosition: true,
  pageNavigation: 'continuous',
};

export interface DesktopSettings {
  accent: AccentName;
  font: FontChoice;
  density: Density;
  scaling: Scaling;
  reduceMotion: boolean;
  libraryView: 'grid' | 'list';
  shortcuts: ShortcutMap;
  /** A local cache of the account's reader defaults; the source of truth is Convex. */
  reader: ReaderPreferences;
  /**
   * Per-device reader options, deliberately not synced — the same split the
   * mobile app makes ("everything else stays on this phone"). A comfort wash over
   * the page and whether the display is kept awake are about this screen, not the
   * document, so they never leave the machine.
   */
  readerTint: ReaderTint;
  keepAwake: boolean;
}

const STORAGE_KEY = 'pidom.desktop.settings';

const DEFAULTS: DesktopSettings = {
  accent: 'purple',
  font: 'system',
  density: 'comfortable',
  scaling: 100,
  reduceMotion: false,
  libraryView: 'grid',
  shortcuts: DEFAULT_SHORTCUTS,
  reader: READER_DEFAULTS,
  readerTint: 'none',
  keepAwake: false,
};

function load(): DesktopSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<DesktopSettings>;
    // Merge over defaults so a stored file written by an older build that lacks
    // a field reads as the default rather than undefined.
    return {
      ...DEFAULTS,
      ...parsed,
      shortcuts: { ...DEFAULTS.shortcuts, ...(parsed.shortcuts ?? {}) },
      reader: { ...DEFAULTS.reader, ...(parsed.reader ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

let state: DesktopSettings = load();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* a full or blocked store is not worth crashing a preference change over */
  }
}

/** Replace one or more fields, persist, and apply any appearance side effects. */
function patch(next: Partial<DesktopSettings>): void {
  state = { ...state, ...next };
  persist();
  if (next.accent !== undefined) applyAccent(next.accent);
  if (next.font !== undefined) applyFont(next.font);
  if (next.scaling !== undefined) applyScaling(next.scaling);
  if (next.reduceMotion !== undefined) applyReduceMotion(next.reduceMotion);
  emit();
}

export const desktopSettings = {
  get: (): DesktopSettings => state,
  setAccent: (accent: AccentName) => patch({ accent }),
  setFont: (font: FontChoice) => patch({ font }),
  setDensity: (density: Density) => patch({ density }),
  setScaling: (scaling: Scaling) => patch({ scaling }),
  setReduceMotion: (reduceMotion: boolean) => patch({ reduceMotion }),
  setLibraryView: (libraryView: 'grid' | 'list') => patch({ libraryView }),
  setReaderTint: (readerTint: ReaderTint) => patch({ readerTint }),
  setKeepAwake: (keepAwake: boolean) => patch({ keepAwake }),
  setShortcut: (id: ShortcutId, chord: string) =>
    patch({ shortcuts: { ...state.shortcuts, [id]: chord } }),
  resetShortcuts: () => patch({ shortcuts: DEFAULT_SHORTCUTS }),
  /**
   * Overwrite the local reader cache. Called by use-reader-sync when the server
   * value arrives or a control changes — never persisted as the source of truth.
   */
  setReaderCache: (reader: ReaderPreferences) => patch({ reader }),
};

/**
 * Apply the persisted appearance to the DOM. Call once at startup, after the
 * pre-paint theme script has set the light/dark class, so the accent's
 * theme-scoped rules resolve immediately.
 */
export function initAppearance(): void {
  applyAccent(state.accent);
  applyFont(state.font);
  applyScaling(state.scaling);
  applyReduceMotion(state.reduceMotion);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDesktopSettings(): DesktopSettings {
  return useSyncExternalStore(subscribe, desktopSettings.get, desktopSettings.get);
}
