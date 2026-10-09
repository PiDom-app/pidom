# Pidom Desktop

The Electron companion to the Pidom mobile reader. It talks to the **same Convex
deployment and account**, reuses the **same theme tokens**, and follows the
**same security model** as the React Native app at the repo root.

Built with **Electron Forge + Vite + React + TypeScript**, Radix UI, TanStack
(Router / Query / Table / Virtual), Convex, and a main-process SQLite cache
(Node's built-in `node:sqlite` + Drizzle — no native addon to compile).

> Read [`CLAUDE.md`](./CLAUDE.md) before contributing.

## Setup

```bash
cd desktop
npm install
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

| Script                | Does                                                                |
| --------------------- | ------------------------------------------------------------------- |
| `npm start`           | Launch the app in dev (Vite + Electron, HMR).                       |
| `npm run make`        | Build electron-builder distributables for the current platform.      |
| `npm run routes`      | Regenerate the TanStack Router tree.                                |
| `npm run db:generate` | Generate Drizzle migrations from `src/main/db/schema.ts`.           |
| `npm run icons`       | Regenerate `icons/icon.ico` + `icons/icon.png` from the brand mark. |
| `npm run tokens`      | Fail if a colour utility names an undefined theme token.            |
| `npm run typecheck`   | `tsc --noEmit`.                                                     |
| `npm run quality`     | `tokens` + `typecheck`.                                             |

## Icons

The OS-level icons (packaged `.exe`, installer, Start-menu/desktop shortcut,
Add/Remove Programs, the dev window/taskbar, and the `.pdf` file association) come
from `icons/icon.ico` and `icons/icon.png`. Both are **committed** so CI needs no
image tooling. They render the **shared brand mark** — the same glyph the mobile
launcher icon uses (`../assets/images/icon.png`, from `../assets/pidom-mark.svg`).
Regenerate them after the brand mark changes:

```bash
npm run icons
```

`scripts/generate-icons.mjs` is pure Node (jimp + png-to-ico), so it runs the same
on Windows and Linux. `forge.config.ts` wires the `.ico`/`.png` into the application bundle and
electron-builder uses them for release artifacts; `src/main/index.ts` sets the
`BrowserWindow` icon; and
`index.html` carries the mark as an inline-SVG favicon.

## Release

CI uses `.github/workflows/desktop-release.yml` for desktop releases:

- A `vX.Y.Z` tag must match `package.json`; the workflow builds Windows NSIS,
  macOS DMG/ZIP, and Linux AppImage/DEB/RPM artifacts.
- Stable Windows publication is blocked until the approved SignPath signer is
  enabled. macOS artifacts are validation-only until notarization is configured.
- `.github/workflows/desktop-rollout.yml` changes release-side
  `stagingPercentage` metadata from 0 to 100. The client never exposes that
  control.

See [`SIGNING.md`](./SIGNING.md) for the Windows SignPath and macOS
notarization gates. No signing certificate, password, Apple ID, Team ID, or API
key is stored in the repository.

## Process split

- **Main** (`src/main`) — Node + built-ins: `node:sqlite`/Drizzle cache, the
  Google OAuth loopback + token store, `fast-glob`/`file-type`/`mime-types`, fs.
- **Preload** (`src/preload`) — the only bridge; exposes a small `window.pidom`
  surface over `contextBridge`.
- **Renderer** (`src/renderer`) — sandboxed web app: React, Radix, TanStack,
  Convex client, `pdfjs-dist`. Reaches Node only through `window.pidom`.

Layout, token, and security rules live in [`CLAUDE.md`](./CLAUDE.md).
