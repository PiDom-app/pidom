/**
 * Ambient declarations for non-code imports.
 *
 * Expo generates an `expo-env.d.ts` covering these, but it is gitignored and
 * only appears after the bundler has run once. Declaring them here means a
 * fresh clone typechecks before anyone starts the app.
 */

/** `import '@/design/global.css'` — Metro turns this into the compiled styles. */
declare module '*.css';

declare module '*.png' {
  const content: number;
  export default content;
}

declare module '*.svg' {
  import type React from 'react';
  import type { SvgProps } from 'react-native-svg';
  const content: React.FC<SvgProps>;
  export default content;
}
