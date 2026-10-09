import { app, BrowserWindow, net, protocol, session as electronSession } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, normalize, sep } from 'node:path';
import { registerIpc } from './ipc';
import { buildAppMenu } from './menu';
import { SessionManager } from './auth/oauth';
import {
  clearReaderCache,
  READER_SCHEME,
  READER_SCHEME_PRIVILEGES,
  registerReaderProtocol,
  setLocalResolver,
} from './reader';
import { StorageService } from './storage/service';
import { ImportService } from './storage/import-service';
import { UpdateService } from './updater/update-service';
import { CollectionsService } from './collections/service';
import { registerAssociation } from './squirrel-events';

// Electron Forge's Vite plugin injects these for the renderer entry.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// This module is bundled and loaded as CommonJS (main.cjs — see the
// `entryFileNames: 'main.cjs'` note in vite.main.config.ts), where Node provides
// `__dirname` natively. The Vite/esbuild pipeline does not reliably rewrite
// `import.meta.url` for that CommonJS output: in the packaged app it evaluates to
// `undefined`, so `fileURLToPath(undefined)` threw ERR_INVALID_ARG_TYPE and crashed
// the main process on launch/install. Prefer the CommonJS global, and fall back to
// `import.meta.url` only if a future build ever emits real ESM.
const moduleDir =
  typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url));

// The custom app scheme that serves the renderer in production, replacing
// `file://` (which grants a page access to the whole filesystem). Registered as
// a standard, secure origin so relative URLs, fetch, and web storage all work.
const APP_SCHEME = 'app';
const APP_ORIGIN = `${APP_SCHEME}://bundle`;

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: READER_SCHEME, privileges: READER_SCHEME_PRIVILEGES },
]);

// One instance only. The local SQLite cache is opened synchronously on the main
// thread; a second instance holding the WAL lock would make the first process's
// `new Database()` block the whole event loop — the app appears to freeze. Refuse
// the second launch and focus the window that already owns the cache instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

const shouldBoot = gotSingleInstanceLock;

let mainWindow: BrowserWindow | null = null;
const authSession = new SessionManager();
const storage = new StorageService(authSession);
const importService = new ImportService(authSession, storage);
const updateService = new UpdateService();
const collectionsService = new CollectionsService(authSession);

/**
 * The first `.pdf` path in a launch argv, or null. Windows hands a
 * double-clicked / "Open With" / Open Recent file to the app this way; Squirrel's
 * own `--squirrel-*` flags and other switches never match. Only the extension is
 * checked here — the import pipeline canonicalizes and verifies the bytes.
 */
function pdfPathFromArgv(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue;
    if (arg.toLowerCase().endsWith('.pdf')) return arg;
  }
  return null;
}

/**
 * Stages a file the OS launched us with through the full import pipeline (so it
 * is validated, deduped, and made available offline), then lets the renderer
 * open it by id. Records it in the OS "Recent" list on the attempt.
 */
function openExternalPdf(sourcePath: string): void {
  app.addRecentDocument(sourcePath);
  void importService.openExternalFile(sourcePath).catch((error) => {
    console.error('[main] failed to open external file', error);
  });
}

/** The renderer build directory Forge's Vite plugin emits next to main.js. */
const rendererDir = join(moduleDir, `../renderer/${MAIN_WINDOW_VITE_NAME}`);

/**
 * Serves the packaged renderer over `app://bundle/...`. Every resolved path is
 * confined to the renderer directory (path-traversal guard), and requests for
 * client-routed paths (no file extension) fall back to index.html so the SPA
 * router owns navigation.
 */
function handleAppProtocol(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  const hasExtension = /\.[a-z0-9]+$/i.test(relative);
  const target = normalize(join(rendererDir, hasExtension ? relative : 'index.html'));

  // Reject anything that escapes the bundle.
  if (target !== rendererDir && !target.startsWith(rendererDir + sep)) {
    return Promise.resolve(new Response('Forbidden', { status: 403 }));
  }
  return net.fetch(pathToFileURL(target).toString());
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#000000',
    show: false,
    // The Pidom mark, copied next to the main bundle by vite.main.config.ts's
    // app-icon plugin. Drives the dev window and the Linux/Windows taskbar icon;
    // the packaged Windows .exe carries its own icon from packagerConfig.
    icon: join(moduleDir, 'icon.png'),
    // A single custom title bar across platforms: on macOS the traffic lights
    // stay (inset into our bar); on Windows/Linux the frame is gone and the
    // renderer draws its own controls.
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      // main.js and preload.js are emitted side by side in .vite/build.
      preload: join(moduleDir, 'preload.js'),
      // The security posture documented in CLAUDE.md — the renderer is an
      // untrusted web context and reaches Node only through the preload bridge.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
    // In development, open DevTools automatically so renderer errors (a blank
    // window is almost always an uncaught error during module load) are visible
    // without a manual toggle. Never in a packaged build.
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) win.webContents.openDevTools({ mode: 'right' });
  });

  // Surface renderer crashes and hangs in the terminal. These are event-driven
  // and near-free, unlike forwarding every console message (which crossed the
  // process boundary on every log and amplified any render churn).
  win.on('unresponsive', () =>
    console.error('[main] ⚠ window UNRESPONSIVE — the renderer main thread is blocked'),
  );
  win.on('responsive', () => console.log('[main] window responsive again'));
  win.webContents.on('render-process-gone', (_event, details) =>
    console.error('[main] ⚠ render-process-gone', details),
  );

  // A failed renderer load is a common blank-window cause in packaged builds
  // (bad asset path, protocol handler rejection). Surface it instead of showing
  // an empty window with no explanation. `-3` is ERR_ABORTED, which fires
  // harmlessly on normal in-app navigations, so it is ignored.
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return;
    console.error('[main] ⚠ did-fail-load', { errorCode, errorDescription, validatedURL });
  });

  // Keep the renderer's window-control state in sync with the real window.
  const pushMaximized = () => win.webContents.send('window:maximizeChanged', win.isMaximized());
  win.on('maximize', pushMaximized);
  win.on('unmaximize', pushMaximized);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    // Load the origin root, not `/index.html`, so the SPA router's initial
    // pathname is `/` (which matches the index route). Loading `/index.html`
    // gives the router a pathname no route matches, leaving a blank window with
    // only the title bar painted. The app-protocol handler serves index.html
    // for this extensionless path.
    void win.loadURL(`${APP_ORIGIN}/`);
  }

  return win;
}

if (shouldBoot)
  app.whenReady().then(() => {
    if (process.platform === 'win32' && app.isPackaged) void registerAssociation();
    protocol.handle(APP_SCHEME, handleAppProtocol);
    // The reader serves verified PDF bytes back to the renderer, so its CORS
    // header is scoped to the one origin that renderer runs at — `app://bundle`
    // packaged, the Vite dev server in development (the same origins the IPC guard
    // and will-navigate allowlist) — never a wildcard.
    const rendererOrigin = MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin
      : APP_ORIGIN;
    registerReaderProtocol(rendererOrigin);
    // A previous run that crashed left its verified copies behind. They are
    // reproducible from the server, so start every run with an empty cache.
    void clearReaderCache();

    // The reader opens a persistent local copy with no network when the storage
    // service holds one. Only the `documents/` library persists; its in-flight
    // `tmp/` is cleared here the same way the reader cache is.
    setLocalResolver((documentId) => storage.availablePath(documentId));
    void storage.clearTmp();

    // Deny every renderer permission request by default — a reader app needs none.
    electronSession.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    // Match that on the synchronous permission *check* path (some device/media
    // APIs consult this instead of the async request). Deny by default, with the
    // one exception the app actually uses: clipboard writes, which back the
    // reader's "copy selection" and the error screen's copy button — both driven
    // by an explicit user click. Scoping to `clipboard*` preserves that today and
    // still closes every other permission.
    electronSession.defaultSession.setPermissionCheckHandler((_wc, permission) =>
      permission.startsWith('clipboard'),
    );

    // Serve the Content-Security-Policy as an HTTP response header, which Electron
    // treats as authoritative over the <meta> fallback in index.html. Only in the
    // packaged app: the dev server needs eval + a websocket for HMR that this
    // policy forbids, and there the <meta> tag applies instead.
    if (!MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      const CSP =
        "default-src 'self'; " +
        // `pidom-doc:` is main serving a verified local PDF back to the engine.
        // R2 is absent on purpose: main fetches the signed URL, so the renderer
        // never connects to it and the policy has no reason to allow it.
        `connect-src 'self' ${READER_SCHEME}: https://*.convex.cloud wss://*.convex.cloud https://*.convex.site; ` +
        // blob: covers the images PDF.js decodes out of a page before painting.
        "img-src 'self' data: blob: https:; " +
        // `style-src` keeps 'unsafe-inline' deliberately: the TanStack virtualizer
        // and Radix write inline `style=` attributes (transform/positioning) at
        // runtime. Locking those down needs `style-src-attr`, which in practice
        // still requires 'unsafe-inline' — a nonce/hash cannot cover attribute
        // styles. Documented as an intentional residual in desktop/CLAUDE.md.
        "style-src 'self' 'unsafe-inline'; " +
        // 'self' with no 'unsafe-inline': the only script the page runs are
        // same-origin bundle files — the app bundle and the pre-paint theme
        // setter, which is served from app://bundle/theme-init.js (public/) for
        // exactly this reason rather than being inlined in index.html.
        "script-src 'self'; " +
        // The PDF.js worker is a bundled same-origin asset, never a CDN; blob: is
        // the fallback path the library takes when it cannot load that URL.
        "worker-src 'self' blob:; " +
        // Fonts embedded in a PDF are installed from a blob by the engine.
        "font-src 'self' data: blob:; " +
        "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';";
      electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [CSP],
          },
        });
      });
    }

    // A role-based application menu, set only so its accelerators (copy/paste,
    // quit, zoom, reload in dev) fire. On Windows/Linux the frameless window
    // never draws it; on macOS it appears in the system menu bar as expected.
    buildAppMenu({
      isDev: Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL),
      createWindow,
      checkForUpdates: () => void updateService.check(),
      getUpdateState: () => updateService.getState(),
      restartUpdate: () => updateService.restart(),
    });

    registerIpc(authSession, storage, importService, updateService, collectionsService, {
      getWindow: () => mainWindow,
      createWindow: () => {
        mainWindow = createWindow();
      },
      trustedOrigins: [APP_ORIGIN],
      devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
      isDev: Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL),
    });

    mainWindow = createWindow();

    // Begin auto-update: wire the periodic auto-check and run the first probe.
    // Inert unless this is a packaged Windows build; never blocks the window.
    updateService.start();

    // Silently restore a remembered session from the stored refresh token. This is
    // what lets a signed-in reader close and reopen the app without signing in
    // again; it emits signed-in/signed-out over `session.onChange` (wired above in
    // registerIpc) once the refresh completes. Non-blocking — the window loads
    // meanwhile and shows its `loading` state until this resolves.
    void authSession.restore();

    // Resume any import left mid-flight by a previous run (staged-but-not-uploaded).
    // No-op until auth returns; `ImportService` also drains on the next sign-in.
    void importService.drain();

    // Replay any organization edits queued offline and pull the account's truth
    // into the local mirror. No-op until auth returns; `CollectionsService` also
    // syncs on the next sign-in (via its own `session.onChange` subscription).
    void collectionsService.sync();

    // Launched with a file (Windows double-click / "Open With" / Open Recent):
    // stage it and open it once the window is ready. On macOS the same intent
    // arrives through `open-file` instead (wired below).
    const launchPdf = pdfPathFromArgv(process.argv);
    if (launchPdf) openExternalPdf(launchPdf);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

// Block navigation away from the app and new-window popups: OAuth opens in the
// system browser, never in-app. Only the dev server and our own app origin may
// ever be navigated to.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    const devUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL;
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith(`${APP_ORIGIN}/`)) return;
    event.preventDefault();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// A second launch was refused by the single-instance lock; bring the running
// window forward so the click that tried to open a new instance still lands. If
// that launch carried a `.pdf` (double-click / "Open With" on the running app),
// stage and open it here — the second process's argv is handed to us.
app.on('second-instance', (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  const pdf = pdfPathFromArgv(argv);
  if (pdf) openExternalPdf(pdf);
});

// macOS delivers "Open With" / double-click as an event rather than an argv
// entry, before and after the app is ready. Stage and open the same way.
app.on('open-file', (event, path) => {
  event.preventDefault();
  if (path.toLowerCase().endsWith('.pdf')) openExternalPdf(path);
});

// Temporary streamed copies do not outlive the run that fetched them; nor do
// in-flight `.part` downloads. The persistent `documents/` library stays.
app.on('will-quit', () => {
  void clearReaderCache();
  void storage.clearTmp();
  updateService.dispose();
});
