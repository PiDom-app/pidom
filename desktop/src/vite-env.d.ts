/// <reference types="vite/client" />

// Typed access to the env vars this app reads. VITE_* reach the renderer;
// GOOGLE_* reach the main process only (see vite.main.config.ts envPrefix).
interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string;
  readonly VITE_CONVEX_SITE_URL?: string;
  readonly GOOGLE_DESKTOP_CLIENT_ID?: string;
  readonly GOOGLE_DESKTOP_CLIENT_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
