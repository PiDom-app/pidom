/**
 * The handful of token values that native APIs need as literal strings.
 *
 * `StatusBar`, `SplashScreen`, `expo-system-ui` and the SVG `stroke`/`fill`
 * props take colours as props, not classNames, so they cannot read the CSS
 * custom properties in `global.css`. Those call sites read from here instead.
 *
 * These values are a mirror, not a second source of truth. Anything changed in
 * `global.css` has to be changed here too — which is exactly why the list is
 * kept this short. If a component can express a colour as a className, it must.
 */

/** Raw palette, matching the literals in the `@theme inline` block. */
export const palette = {
  purple: '#6a59e8',
  canvas: '#000000',
  charcoal: '#e8e6e3',
  steel: '#8f8d88',
  white: '#ffffff',
} as const;

/**
 * The subset of the semantic layer that native APIs reach for, resolved per
 * theme. Mirrors `--background` / `--foreground` / `--primary` in `global.css`.
 */
export const themeColors = {
  light: {
    background: '#ffffff',
    foreground: '#171615',
    fgMuted: '#6e6c68',
    primary: '#6a59e8',
    border: '#e2e0dc',
  },
  dark: {
    background: '#000000',
    foreground: '#e8e6e3',
    fgMuted: '#8f8d88',
    primary: '#6a59e8',
    border: '#262523',
  },
} as const;

export type ThemeName = keyof typeof themeColors;
export type ThemeColorName = keyof (typeof themeColors)['light'];
