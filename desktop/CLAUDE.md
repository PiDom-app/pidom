# Pidom Desktop — working rules

This is the Electron companion to the Pidom mobile reader. It shares the _same_
Convex backend and account, the _same_ theme tokens, and the _same_ security
model as the React Native app at the repo root. It is built on \*\*Electron Forge

- Vite + React + TypeScript\*\*. These rules override default habits and must be
  followed exactly.

Shared here means **dependencies and tooling first, not features.** Port the
foundations (theme, providers, security pattern, backend wiring); do not port or
invent product features unless asked.

## Layout law — flat, cardless, content-first

The interface is a **modern flat, cardless, content-first app layout with a
single page-level surface, minimal visual containers, a shallow component
hierarchy, consistent grid alignment, generous whitespace, and full-bleed
sections where appropriate.**

- The page itself is the primary surface. Components — headings, text, forms,
  tables, lists, toolbars, controls — sit **directly in the page flow**, not
  inside a card, panel, bordered box, or decorative wrapper.
- The visual model is `Page → Section → Component`, never
  `Page → Card → CardHeader → CardContent → InnerWrapper → Component`.
- Hierarchy is carried by **spacing, typography, alignment, dividers, background
  changes, and subtle tonal shifts** — not by floating rectangles.
- **Use a container because the layout needs it, not because every component
  needs a box.** A semantic `<section>` or a component wrapper for structure,
  accessibility, CSS layout, or responsive behaviour is fine — the DOM having
  wrappers does not make the design card-based. The test is whether a wrapper
  produces an _unnecessary visual surface_. If it does, remove it.
- A component earns a visible boundary only when that boundary communicates a
  meaningful relationship or interaction.
- Prefer full-bleed sections over one consistent content grid where it helps;
  flat does not mean everything must touch the viewport edges — keep sensible
  gutters and a shared alignment grid.

This mirrors the mobile app's own rule (`../docs/design.md`: "No cards").

## Tokens only

- Colours come **only** from the semantic tokens in
  `src/renderer/design/global.css` (`bg-background`, `text-foreground`,
  `text-fg-muted`, `border-border`, `bg-primary`, `bg-hover`, `bg-hairline`,
  `bg-popover`, `bg-overlay`, …). Never a hex, never a numbered Tailwind colour —
  the default palette is switched off, so `bg-red-500` does not exist and renders
  nothing. `npm run tokens` fails the build if a colour utility names an
  undefined token.
- **Every corner is 6px.** The whole radius scale is 6px on purpose;
  `rounded-full` is reserved for avatars and status dots.
- These token values are **ported verbatim from the mobile app** and must stay in
  sync with `../src/design/global.css`. Change one, change both.
- Tailwind v4 is CSS-first — there is **no `tailwind.config`**. Tokens live in the
  `@theme inline` block in `global.css`; keep `inline` (it makes the `.dark` /
  `.light` toggle work).
- Icons: `lucide-react`. Class merging: the `cn()` helper in `src/renderer/lib/utils.ts`.
- UI primitives: **Radix UI** (`radix-ui`). Match Radix `data-*` state attributes
  in styling (`data-[highlighted]`, `data-[state=open]`, …).

## Security parity with the mobile app

Same Convex Google-OIDC model (`../docs/security.md`). Do not weaken it.

- **Identity comes from the verified JWT, server-side.** No Convex function takes
  a user id; owner scoping is by `by_owner` index or `assertOwner`. A missing doc
  and someone else's doc both return `FORBIDDEN`.
- **The ID token lives in memory only** (main process), handed to the renderer on
  demand over IPC. It is never persisted.
- **The refresh token is the only credential at rest** and goes in the OS keychain
  via Electron `safeStorage` (`src/main/auth/token-store.ts`) — the desktop
  analogue of the mobile app's `expo-secure-store`. Never in the renderer, never
  logged (not even its length).
- **No confidential secret in the renderer.** Desktop OAuth is system-browser
  loopback + PKCE; the non-confidential Desktop-client secret is a `GOOGLE_*` env
  var seen only by the main process.
- **Process split is the sandbox boundary.** The renderer runs with
  `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and reaches
  the main process only through the small `window.pidom` bridge (`src/preload`).
  Node-only work — `node:sqlite`/`drizzle`, `fast-glob`, `file-type`,
  `mime-types`, `fs`, the OAuth loopback — runs in **main**. `pdfjs-dist` renders
  in the renderer.
- **Treat a document as untrusted input** (validate the `%PDF-` magic, bound page
  counts and extracted text) — the same posture as the mobile reader.
- **Fail closed** on secure storage: if `safeStorage` is unavailable, refuse to
  persist rather than writing a bearer credential in the clear.

## Backend wiring

- The shared Convex generated API is reached by the `@convex` alias →
  `../convex/_generated` (tsconfig `paths` + each `vite.*.config.ts`). One
  deployment, no duplication. Do not run a second `convex codegen` here.
- `VITE_CONVEX_URL` (renderer) and `GOOGLE_DESKTOP_CLIENT_ID` /
  `GOOGLE_DESKTOP_CLIENT_SECRET` (main only) are documented in `.env.example`.
- The desktop OAuth client id must be registered as an `applicationID` in the
  shared `../convex/auth.config.ts`, or Convex rejects its tokens as
  wrong-audience.
- Provider order is fixed: `QueryClient → Theme → Session → Convex`. Session sits
  above Convex because `ConvexProviderWithAuth` reads `useConvexGoogleAuth` from
  inside its own tree.

## Skills

Use the same skills the mobile app pins (`../skills-lock.json`):

- The **`convex-*`** family for anything backend — especially `convex`,
  `convex-auth`, `convex-authz`, `convex-reviewer`, `convex-test`,
  `convex-design`. Read `../convex/_generated/ai/guidelines.md` before touching
  Convex code.
- **`gluestack-ui-v5`** for reference on the component/token conventions the
  theme came from (the desktop UI itself uses Radix, not gluestack).
- **`no-ai-slop`** — keep prose and code lean; no filler.

## Verify before claiming done

- `npm run quality` (token guard + typecheck) passes.
- `npm start` launches the window; DevTools shows `nodeIntegration` off,
  `contextIsolation` on; the theme toggles with no flash on launch; the Convex
  status row reports; the SQLite `user_version` round-trip returns.
