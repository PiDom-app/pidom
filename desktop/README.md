# Pidom Desktop

The Electron companion to the Pidom mobile reader. It talks to the **same Convex
deployment and account**, reuses the **same theme tokens**, and follows the
**same security model** as the React Native app at the repo root.

Built with **Electron Forge + Vite + React + TypeScript**, Radix UI, TanStack
(Router / Query / Table / Virtual), Convex, and a main-process SQLite cache
(better-sqlite3 + Drizzle).

> Scaffold status: this is the foundation — dependencies, theme, providers,
> security skeleton, and real desktop Google OAuth. No product features yet.
> Read [`CLAUDE.md`](./CLAUDE.md) before contributing.

## Setup

```bash
cd desktop
npm install
npm run rebuild        # rebuild better-sqlite3 against Electron's ABI
cp .env.example .env.local   # then fill it in
npm start
```

### Environment (`.env.local`)

| Variable                       | Process   | What it is                                                                      |
| ------------------------------ | --------- | ------------------------------------------------------------------------------- |
| `VITE_CONVEX_URL`              | renderer  | The shared Convex deployment URL (same as the mobile `EXPO_PUBLIC_CONVEX_URL`). |
| `VITE_CONVEX_SITE_URL`         | renderer  | The Convex HTTP-actions origin.                                                 |
| `GOOGLE_DESKTOP_CLIENT_ID`     | main only | A Google **Desktop app** OAuth client id.                                       |
| `GOOGLE_DESKTOP_CLIENT_SECRET` | main only | The non-confidential secret Google issues for that client.                      |

None are confidential secrets in the renderer sense (see `.env.example`). The
`GOOGLE_*` values are loaded into the **main process only** and never reach the
web context.

### Backend one-time step

Register the desktop OAuth client id with the shared Convex deployment so its ID
tokens verify (they carry a different `aud` than the mobile web client):

```bash
npx convex env set GOOGLE_DESKTOP_CLIENT_ID <id>.apps.googleusercontent.com
```

`../convex/auth.config.ts` already accepts it as an additional audience when set.

## Scripts

| Script                | Does                                                      |
| --------------------- | --------------------------------------------------------- |
| `npm start`           | Launch the app in dev (Vite + Electron, HMR).             |
| `npm run make`        | Build distributables via Electron Forge.                  |
| `npm run rebuild`     | Rebuild native modules (better-sqlite3) for Electron.     |
| `npm run routes`      | Regenerate the TanStack Router tree.                      |
| `npm run db:generate` | Generate Drizzle migrations from `src/main/db/schema.ts`. |
| `npm run tokens`      | Fail if a colour utility names an undefined theme token.  |
| `npm run typecheck`   | `tsc --noEmit`.                                           |
| `npm run quality`     | `tokens` + `typecheck`.                                   |

## Process split

- **Main** (`src/main`) — Node + native: `better-sqlite3`/Drizzle cache, the
  Google OAuth loopback + token store, `fast-glob`/`file-type`/`mime-types`, fs.
- **Preload** (`src/preload`) — the only bridge; exposes a small `window.pidom`
  surface over `contextBridge`.
- **Renderer** (`src/renderer`) — sandboxed web app: React, Radix, TanStack,
  Convex client, `pdfjs-dist`. Reaches Node only through `window.pidom`.

Layout, token, and security rules live in [`CLAUDE.md`](./CLAUDE.md).
