import { app, BrowserWindow, net, protocol, session as electronSession } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, normalize, sep } from 'node:path';
import started from 'electron-squirrel-startup';
import { registerIpc } from './ipc';
import { buildAppMenu } from './menu';
import { SessionManager } from './auth/oauth';
import {
  clearReaderCache,
  READER_SCHEME,
  READER_SCHEME_PRIVILEGES,
  registerReaderProtocol,
} from './reader';

// Electron Forge's Vite plugin injects these for the renderer entry.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const __dirname = dirname(fileURLToPath(import.meta.url));

// The custom app scheme that serves the renderer in production, replacing
// `file://` (which grants a page access to the whole filesystem). Registered as
// a standard, secure origin so relative URLs, fetch, and web storage all work.
const APP_SCHEME = 'app';
const APP_ORIGIN = `${APP_SCHEME}://bundle`;

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: READER_SCHEME, privileges: READER_SCHEME_PRIVILEGES },
]);

// Squirrel (Windows) shortcut lifecycle; quits early during install/uninstall.
if (started) app.quit();

let mainWindow: BrowserWindow | null = null;
const authSession = new SessionManager();

/** The renderer build directory Forge's Vite plugin emits next to main.js. */
const rendererDir = join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);

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
    // A single custom title bar across platforms: on macOS the traffic lights
    // stay (inset into our bar); on Windows/Linux the frame is gone and the
    // renderer draws its own controls.
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      // main.js and preload.js are emitted side by side in .vite/build.
      preload: join(__dirname, 'preload.js'),
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

  // Keep the renderer's window-control state in sync with the real window.
  const pushMaximized = () => win.webContents.send('window:maximizeChanged', win.isMaximized());
  win.on('maximize', pushMaximized);
  win.on('unmaximize', pushMaximized);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void win.loadURL(`${APP_ORIGIN}/index.html`);
  }

  return win;
}

app.whenReady().then(() => {
  protocol.handle(APP_SCHEME, handleAppProtocol);
  registerReaderProtocol();
  // A previous run that crashed left its verified copies behind. They are
  // reproducible from the server, so start every run with an empty cache.
  void clearReaderCache();

  // Deny every renderer permission request by default — a reader app needs none.
  electronSession.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

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
      "style-src 'self' 'unsafe-inline'; " +
      // 'unsafe-inline' covers the pre-paint theme script in index.html, which
      // is same-origin app code injected at build, not remote content.
      "script-src 'self' 'unsafe-inline'; " +
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
  buildAppMenu({ isDev: Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL), createWindow });

  registerIpc(authSession, {
    getWindow: () => mainWindow,
    createWindow: () => {
      mainWindow = createWindow();
    },
    trustedOrigins: [APP_ORIGIN],
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
    isDev: Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL),
  });

  mainWindow = createWindow();

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

// Verified copies do not outlive the run that fetched them.
app.on('will-quit', () => {
  void clearReaderCache();
});
