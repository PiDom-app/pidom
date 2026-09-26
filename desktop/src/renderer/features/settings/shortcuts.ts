/**
 * The desktop keyboard commands and their default chords.
 *
 * A chord is stored as a normalised string: modifiers in a fixed order
 * (`Mod` = ⌘ on macOS / Ctrl elsewhere, then Shift, Alt) joined to one key with
 * `+`, e.g. `Mod+K`, `Mod+Shift+N`. Storing `Mod` rather than a literal ⌘/Ctrl
 * keeps one binding correct on every platform; the display layer resolves it.
 *
 * Rebinding is renderer-local this pass: the store drives the in-app palette and
 * documents what the app answers. Wiring custom chords into the main-process
 * menu accelerators is a later addition and deliberately not done here.
 */

export type ShortcutId = 'openSearch' | 'newWindow' | 'zoomIn' | 'zoomOut' | 'zoomReset';

export interface ShortcutDef {
  id: ShortcutId;
  command: string;
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'openSearch', command: 'Open search / command palette' },
  { id: 'newWindow', command: 'New window' },
  { id: 'zoomIn', command: 'Zoom in' },
  { id: 'zoomOut', command: 'Zoom out' },
  { id: 'zoomReset', command: 'Reset zoom' },
];

export type ShortcutMap = Record<ShortcutId, string>;

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  openSearch: 'Mod+K',
  newWindow: 'Mod+Shift+N',
  zoomIn: 'Mod++',
  zoomOut: 'Mod+-',
  zoomReset: 'Mod+0',
};

/** Render a stored chord for the current platform: Mod → ⌘ on macOS, Ctrl else. */
export function formatChord(chord: string, isMac: boolean): string {
  return chord
    .split('+')
    .map((part) => {
      if (part === 'Mod') return isMac ? '⌘' : 'Ctrl';
      if (part === 'Shift') return isMac ? '⇧' : 'Shift';
      if (part === 'Alt') return isMac ? '⌥' : 'Alt';
      return part;
    })
    .join(isMac ? ' ' : ' + ');
}

/**
 * Read a normalised chord string from a keydown event, or null if the event is
 * only a modifier (so the capture keeps waiting for a real key).
 */
export function chordFromEvent(e: KeyboardEvent): string | null {
  const key = e.key;
  if (key === 'Control' || key === 'Meta' || key === 'Shift' || key === 'Alt') {
    return null;
  }
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('Mod');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  // Normalise the key: single letters upper-cased, space spelled out.
  const normalised = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key;
  parts.push(normalised);
  return parts.join('+');
}
