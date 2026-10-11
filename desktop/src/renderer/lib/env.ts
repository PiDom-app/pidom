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
 * keeps configuration access in one place. Missing configuration is reported by
 * ConvexProvider inside the mounted renderer error boundary.
 */
function optional(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export const env = {
  /** Convex deployment URL, e.g. `https://acme-cat-123.convex.cloud`. */
  convexUrl: optional(import.meta.env.VITE_CONVEX_URL),
} as const;
