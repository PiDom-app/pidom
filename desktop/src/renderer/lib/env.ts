/**
 * Validated access to the renderer's `VITE_*` variables.
 *
 * Vite inlines these into the bundle at build time, so they are readable by
 * anyone who unpacks the app. That is fine for what lives here — a Convex
 * deployment URL is a public identifier, not a secret. The OAuth client secret
 * is deliberately NOT here: it is a `GOOGLE_*` variable that only the main
 * process sees (see vite.main.config.ts), and the ID-token flow keeps it out of
 * the renderer entirely.
 *
 * Reading through this module rather than touching `import.meta.env` inline
 * turns a missing variable into one clear error at startup instead of an opaque
 * websocket failure several screens later. Mirrors the mobile app's src/lib/env.ts.
 */
function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `${name} is missing. Copy .env.example to .env.local and fill it in, then ` +
        'restart `npm start` — Vite inlines VITE_* at build time, so a running dev ' +
        'server will not pick up the change.',
    );
  }
  return value;
}

export const env = {
  /** Convex deployment URL, e.g. `https://acme-cat-123.convex.cloud`. */
  convexUrl: required('VITE_CONVEX_URL', import.meta.env.VITE_CONVEX_URL),
} as const;
