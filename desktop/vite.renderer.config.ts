import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

// PDF.js loads character maps (CID/CJK fonts) and the 14 standard fonts (used by
// documents that reference them without embedding) at runtime, by fetching from
// `cMapUrl`/`standardFontDataUrl`. Those directories ship inside the pdfjs-dist
// package but Vite does not bundle a directory referenced by a bare specifier,
// so they must be copied into the build root and served in dev. Engine.ts points
// PDF.js at same-origin `/cmaps/` and `/standard_fonts/` — the CSP forbids a CDN.
function pdfjsAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const pkgDir = resolve(require.resolve('pdfjs-dist/package.json'), '..');
  const dirs = ['cmaps', 'standard_fonts'] as const;
  return {
    name: 'pdfjs-assets',
    apply: () => true,
    configureServer(server) {
      // In dev the renderer is served by Vite, not the app:// scheme, so map the
      // two request paths straight onto the package directories.
      server.middlewares.use((req, res, next) => {
        const match = dirs.find((d) => req.url?.startsWith(`/${d}/`));
        if (!match) return next();
        const rel = req.url!.slice(match.length + 2).split('?')[0];
        res.setHeader('cache-control', 'no-store');
        import('node:fs').then(({ createReadStream, existsSync }) => {
          const file = resolve(pkgDir, match, decodeURIComponent(rel));
          if (!file.startsWith(resolve(pkgDir, match)) || !existsSync(file)) {
            res.statusCode = 404;
            return res.end();
          }
          createReadStream(file).pipe(res);
        });
      });
    },
    async writeBundle(options) {
      const outDir = options.dir ?? resolve(process.cwd(), 'dist');
      await Promise.all(
        dirs.map((d) => cp(resolve(pkgDir, d), resolve(outDir, d), { recursive: true })),
      );
    },
  };
}

// Paths resolve from process.cwd() (the desktop/ root Forge runs from) rather
// than __dirname, which Forge's temp-file config bundling would misdirect.

// Renderer. React + Radix + TanStack + pdfjs-dist run here in a sandboxed web
// context. No Node built-ins, no native modules — those reach the renderer only
// through `window.pidom` (see src/preload).
export default defineConfig({
  plugins: [
    // The router plugin must run before the React plugin so generated route code
    // is transformed by React's Fast Refresh.
    tanstackRouter({
      target: 'react',
      routesDirectory: './src/renderer/routes',
      generatedRouteTree: './src/renderer/routeTree.gen.ts',
      autoCodeSplitting: true,
    }),
    react(),
    // Tailwind v4 is CSS-first; there is no tailwind.config. All tokens live in
    // src/renderer/design/global.css.
    tailwindcss(),
    // Copy PDF.js cMaps and standard fonts to the build root / serve them in dev.
    pdfjsAssets(),
  ],
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'src/renderer'),
      '@convex': resolve(process.cwd(), '../convex/_generated'),
      '@convex-model': resolve(process.cwd(), '../convex/model'),
    },
  },
});
