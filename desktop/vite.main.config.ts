import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { cp } from 'node:fs/promises';

// Copy the app icon next to the built main bundle so the main process can set it
// as the BrowserWindow icon at runtime (`join(__dirname, 'icon.png')`). On
// packaged Windows the window/taskbar icon comes from the .exe itself, but this
// covers the dev run and the Linux makers. Regenerate the source with
// `npm run icons`.
function appIcon(): Plugin {
  return {
    name: 'app-icon',
    apply: () => true,
    async writeBundle(options) {
      const outDir = options.dir ?? resolve(process.cwd(), '.vite/build');
      await cp(resolve(process.cwd(), 'icons/icon.png'), resolve(outDir, 'icon.png'));
    },
  };
}

// Main process. Node built-ins (node:sqlite, fast-glob, file-type, the OAuth
// loopback) run here — never in the renderer.
//
// `envPrefix` widens what Vite loads from `.env*` into `import.meta.env` for the
// main bundle only: `GOOGLE_*` desktop OAuth values live here, out of the
// renderer's reach. They are never exposed to a web context.
//
// Paths resolve from process.cwd() (the desktop/ project root Forge runs from),
// not __dirname — Electron Forge bundles this config to a temp file, so
// __dirname would point at the wrong place.
export default defineConfig({
  envPrefix: ['VITE_', 'GOOGLE_'],
  plugins: [appIcon()],
  resolve: {
    // Reach the shared Convex deployment's generated API without duplicating it.
    alias: {
      '@convex': resolve(process.cwd(), '../convex/_generated'),
      '@convex-model': resolve(process.cwd(), '../convex/model'),
    },
  },
  build: {
    rollupOptions: {
      // Keep `node:sqlite` external so the built-in is required from Electron's
      // own Node at runtime rather than pulled into the bundle.
      external: ['node:sqlite'],
      // Both process entries are named index.ts; pin a distinct output so they
      // do not collide in .vite/build. The `.cjs` extension is load-bearing:
      // this bundle is CommonJS (Node built-ins, including node:sqlite, are
      // `require`d), but package.json sets "type": "module", so a `.js` file
      // would be loaded as ESM and `require` would be undefined. `.cjs` forces
      // Node/Electron to load it as CommonJS.
      output: { entryFileNames: 'main.cjs' },
    },
  },
});
