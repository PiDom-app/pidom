import { defineConfig } from 'vite';

// Preload. The only bridge between the sandboxed renderer and the main process.
// It exposes a small, named `window.pidom` surface over contextBridge and leaks
// no raw `ipcRenderer`.
export default defineConfig({
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
