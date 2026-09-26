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
| `npm run make`        | Build distributables via Electron Forge.                            |
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
on Windows and Linux. `forge.config.ts` wires the `.ico`/`.png` into the packager
and Squirrel maker; `src/main/index.ts` sets the `BrowserWindow` icon; and
`index.html` carries the mark as an inline-SVG favicon.

## Release

CI (`.github/workflows/ci.yml`) mirrors the mobile app:

- **`desktop-quality`** runs on every push and PR to `main` — installs, generates
  the route tree, then runs the token guard and typecheck.
- **`desktop-release`** runs on merge to `main`: builds the Windows installer on
  `windows-latest` with the shared Convex deployment baked in, checksums the
  `Setup.exe`, and publishes a GitHub Release tagged
  `v<version>-desktop.<run_number>` with generated notes, install/verify steps,
  and a SHA-256 checksum. It does **not** deploy Convex — the mobile release job
  already does that on the same push.

Builds ship **unsigned** by default (SmartScreen shows "unknown publisher"; the
SHA-256 checksum is the integrity guarantee). Two signing paths are prepared and
gated **off** in CI — enable one when you have a certificate:

- **SignPath Foundation** — free Authenticode signing for OSS (`SIGNPATH_ENABLED`).
- **signtool + PFX** — any certificate (Certum Open Source, a commercial CA, or a
  self-signed PFX for internal fleets) supplied as a base64 secret
  (`WINDOWS_SIGN_ENABLED`).

Signing establishes publisher identity and lets SmartScreen reputation build; it
is not an instant "no warning" switch (EV no longer bypasses SmartScreen as of
2026). See [`SIGNING.md`](./SIGNING.md) for the ranked options, exact `signtool`
commands, and the Certum application steps. Cut a new version by bumping
`version` in `package.json`; the next merge releases under it.

## Process split

- **Main** (`src/main`) — Node + built-ins: `node:sqlite`/Drizzle cache, the
  Google OAuth loopback + token store, `fast-glob`/`file-type`/`mime-types`, fs.
- **Preload** (`src/preload`) — the only bridge; exposes a small `window.pidom`
  surface over `contextBridge`.
- **Renderer** (`src/renderer`) — sandboxed web app: React, Radix, TanStack,
  Convex client, `pdfjs-dist`. Reaches Node only through `window.pidom`.

Layout, token, and security rules live in [`CLAUDE.md`](./CLAUDE.md).
