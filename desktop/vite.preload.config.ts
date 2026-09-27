import { defineConfig } from 'vite';

// Preload. The only bridge between the sandboxed renderer and the main process.
// It exposes a small, named `window.pidom` surface over contextBridge and leaks
// no raw `ipcRenderer`.
export default defineConfig({
<<<<<<< HEAD
  // The preload's shared imports reach `.ts` files under `../convex`, so esbuild
  // walks up and finds the *mobile* root `../tsconfig.json` (`extends:
  // "expo/tsconfig.base"`). The desktop-only CI install has no expo, so esbuild
  // warns it can't find that base config. Cosmetic — `extends` only affects
  // type-checking, done separately by `tsc` — so silence just that warning.
  esbuild: { logOverride: { 'tsconfig.json': 'silent' } },
=======
>>>>>>> origin/main
  build: {
    rollupOptions: {
      output: {
        // A sandboxed preload runs in CommonJS context; keep it out of ESM
        // interop, and pin a distinct output name (the entry is index.ts too).
        format: 'cjs',
        entryFileNames: 'preload.js',
        inlineDynamicImports: true,
      },
    },
  },
});
