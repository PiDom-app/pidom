/*
 * Desktop-only appearance overrides.
 *
 * The shared tokens in design/global.css fix the accent to purple, one font
 * stack, and a 16px root — that is deliberate on mobile, where a screenshot
 * should read as Pidom regardless. The desktop app lets the reader override the
 * accent, interface font, and scaling for their own machine. These overrides are
 * LOCAL to this device (persisted in localStorage by use-desktop-settings) and
 * never touch the mobile app or the shared token file.
 *
 * The mechanism stays inside the token system rather than around it: accent
 * writes the same `--primary*` / `--focus` / `--link*` / `--ring` variables the
 * `.light` / `.dark` blocks define, so every `bg-primary` / `text-link` utility
 * keeps resolving and scripts/check-tokens.mjs stays green. Colours are the
 * space-separated `R G B` triples the tokens use, not hex.
 */

export type AccentName = 'purple' | 'blue' | 'teal' | 'green' | 'amber' | 'orange' | 'red' | 'pink';

/** One accent's `R G B` triples, per appearance. */
interface AccentRamp {
  primary: string;
  hover: string;
  tint: string;
}

export interface Accent {
  name: AccentName;
  label: string;
  /** The swatch colour to paint in the picker, per appearance. */
  swatch: { light: string; dark: string };
  light: AccentRamp;
  dark: AccentRamp;
}

/**
 * The curated accent set. `purple` is the shared default and matches the token
 * file exactly, so selecting it is indistinguishable from no override.
 */
export const ACCENTS: Accent[] = [
  {
    name: 'purple',
    label: 'Purple',
    swatch: { light: '106 89 232', dark: '122 106 240' },
    light: { primary: '106 89 232', hover: '92 76 214', tint: '240 238 253' },
    dark: { primary: '106 89 232', hover: '122 106 240', tint: '26 22 51' },
  },
  {
    name: 'blue',
    label: 'Blue',
    swatch: { light: '37 99 235', dark: '59 130 246' },
    light: { primary: '37 99 235', hover: '29 78 216', tint: '235 242 254' },
    dark: { primary: '59 130 246', hover: '96 165 250', tint: '15 27 51' },
  },
  {
    name: 'teal',
    label: 'Teal',
    swatch: { light: '13 148 136', dark: '45 212 191' },
    light: { primary: '13 148 136', hover: '15 118 110', tint: '232 250 248' },
    dark: { primary: '45 212 191', hover: '94 234 212', tint: '8 40 38' },
  },
  {
    name: 'green',
    label: 'Green',
    swatch: { light: '22 163 74', dark: '52 211 153' },
    light: { primary: '22 163 74', hover: '21 128 61', tint: '235 250 240' },
    dark: { primary: '52 211 153', hover: '110 231 183', tint: '10 40 28' },
  },
  {
    name: 'amber',
    label: 'Amber',
    swatch: { light: '202 138 4', dark: '251 191 36' },
    light: { primary: '202 138 4', hover: '161 98 7', tint: '254 249 231' },
    dark: { primary: '251 191 36', hover: '253 224 71', tint: '43 33 8' },
  },
  {
    name: 'orange',
    label: 'Orange',
    swatch: { light: '234 88 12', dark: '251 146 60' },
    light: { primary: '234 88 12', hover: '194 65 12', tint: '254 242 234' },
    dark: { primary: '251 146 60', hover: '253 186 116', tint: '46 26 12' },
  },
  {
    name: 'red',
    label: 'Red',
    swatch: { light: '220 38 38', dark: '248 113 113' },
    light: { primary: '220 38 38', hover: '185 28 28', tint: '254 240 240' },
    dark: { primary: '248 113 113', hover: '252 165 165', tint: '46 18 18' },
  },
  {
    name: 'pink',
    label: 'Pink',
    swatch: { light: '219 39 119', dark: '244 114 182' },
    light: { primary: '219 39 119', hover: '190 24 93', tint: '253 240 246' },
    dark: { primary: '244 114 182', hover: '249 168 212', tint: '46 16 32' },
  },
];

export function accentByName(name: AccentName): Accent {
  return ACCENTS.find((a) => a.name === name) ?? ACCENTS[0];
}

export type FontChoice = 'system' | 'geometric' | 'humanist' | 'serif' | 'mono';

export interface FontOption {
  name: FontChoice;
  label: string;
  /** null = fall back to the token file's system stack. */
  stack: string | null;
}

const SYSTEM_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'";

/**
 * Interface fonts, chosen from stacks already present on desktop operating
 * systems so nothing has to be bundled or downloaded.
 */
export const FONTS: FontOption[] = [
  { name: 'system', label: 'System', stack: null },
  {
    name: 'geometric',
    label: 'Geometric',
    stack: `'Avenir Next', 'Century Gothic', 'Segoe UI', ${SYSTEM_STACK}`,
  },
  {
    name: 'humanist',
    label: 'Humanist',
    stack: `'Optima', 'Gill Sans', 'Segoe UI', ${SYSTEM_STACK}`,
  },
  {
    name: 'serif',
    label: 'Serif',
    stack: `'Iowan Old Style', 'Palatino Linotype', 'Georgia', 'Times New Roman', serif`,
  },
  {
    name: 'mono',
    label: 'Monospace',
    stack: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
];

export function fontByName(name: FontChoice): FontOption {
  return FONTS.find((f) => f.name === name) ?? FONTS[0];
}

export type Scaling = 90 | 95 | 100 | 105 | 110;
export const SCALINGS: Scaling[] = [90, 95, 100, 105, 110];

export type Density = 'comfortable' | 'compact';

const ACCENT_STYLE_ID = 'pidom-accent';

/**
 * Turn the app's entrance/transition animations off for this device.
 *
 * The `animate-*` utilities in global.css are gated on `:root:not(.reduce-motion)`,
 * so adding the class is enough to suppress them; this also lets a reader who
 * prefers stillness override a system that does not report `prefers-reduced-motion`.
 */
export function applyReduceMotion(reduce: boolean): void {
  document.documentElement.classList.toggle('reduce-motion', reduce);
}

function accentBlock(selector: string, ramp: AccentRamp): string {
  return (
    `${selector}{` +
    `--primary:${ramp.primary};` +
    `--primary-hover:${ramp.hover};` +
    `--primary-tint:${ramp.tint};` +
    `--focus:${ramp.primary};` +
    `--ring:${ramp.primary};` +
    `--link:${ramp.primary};` +
    `--link-hover:${ramp.hover};` +
    `}`
  );
}

/**
 * Write the accent override into a single <style> element. `:root.light` /
 * `:root.dark` carry the two ramps at the same specificity as the token blocks
 * but later in document order, so the toggle keeps working and the accent
 * follows the theme without re-running on every toggle.
 */
export function applyAccent(name: AccentName): void {
  const accent = accentByName(name);
  let el = document.getElementById(ACCENT_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = ACCENT_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent =
    accentBlock(':root.light', accent.light) + accentBlock(':root.dark', accent.dark);
}

export function applyFont(name: FontChoice): void {
  const { stack } = fontByName(name);
  const root = document.documentElement;
  if (stack === null) {
    root.style.removeProperty('--font-sans');
    root.style.removeProperty('--font-display');
    root.style.removeProperty('--font-body');
    root.style.removeProperty('--font-heading');
    return;
  }
  root.style.setProperty('--font-sans', stack);
  root.style.setProperty('--font-display', stack);
  root.style.setProperty('--font-body', stack);
  root.style.setProperty('--font-heading', stack);
}

/** Scale the whole interface by driving the root font-size the rem scale reads. */
export function applyScaling(pct: Scaling): void {
  const root = document.documentElement;
  if (pct === 100) {
    root.style.removeProperty('font-size');
    return;
  }
  root.style.fontSize = `${(16 * pct) / 100}px`;
}
