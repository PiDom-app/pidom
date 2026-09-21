import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { IPC, type EditAction, type ReaderOpenRequest, type ZoomAction } from '../shared/ipc';
import { SessionManager } from './auth/oauth';
import { userVersion } from './db';
import { closeDocument, fetchText, openDocument } from './reader';

interface IpcOptions {
  getWindow: () => BrowserWindow | null;
  createWindow: () => void;
  /** Origins allowed to invoke IPC (the packaged app origin). */
  trustedOrigins: string[];
  /** The Vite dev server URL, when running in development. */
  devServerUrl: string | undefined;
  isDev: boolean;
}

/**
 * Registers every IPC handler the preload bridge invokes. One place, so the
 * renderer's reachable surface is auditable at a glance. Every handler first
 * verifies the sender frame's origin — defence in depth, per Electron's
 * security guidance: a message from any other frame is dropped.
 */
export function registerIpc(session: SessionManager, opts: IpcOptions): void {
  // Compare the sender's ORIGIN, not a URL prefix. Electron's guidance is
  // explicit that a `startsWith` check is defeated by lookalikes such as
  // `app://bundle.attacker.example`; parsing to an origin and matching exactly
  // closes that. `about:blank`, `blob:`, and other opaque URLs parse to an
  // origin that is not in the allowlist, so they are rejected.
  const allowedOrigins = new Set<string>();
  for (const origin of opts.trustedOrigins) {
    try {
      allowedOrigins.add(new URL(origin).origin);
    } catch {
      /* a malformed configured origin simply never matches */
    }
  }
  if (opts.devServerUrl) {
    try {
      allowedOrigins.add(new URL(opts.devServerUrl).origin);
    } catch {
      /* ignore */
    }
  }

  const isTrusted = (event: IpcMainInvokeEvent): boolean => {
    const url = event.senderFrame?.url;
    if (!url) return false;
    try {
      return allowedOrigins.has(new URL(url).origin);
    } catch {
      return false;
    }
  };

  /** Wrap a handler so it only runs for a trusted sender. */
  const guard = <A extends unknown[], R>(fn: (event: IpcMainInvokeEvent, ...args: A) => R) => {
    return (event: IpcMainInvokeEvent, ...args: A): R => {
      if (!isTrusted(event)) throw new Error('IPC rejected: untrusted sender');
      return fn(event, ...args);
    };
  };

  // Push auth changes to the renderer so React state tracks the main process.
  session.onChange((state) => {
    opts.getWindow()?.webContents.send(IPC.authChanged, state);
  });

  ipcMain.handle(
    IPC.authSignIn,
    guard(() => session.signIn()),
  );
  ipcMain.handle(
    IPC.authSignOut,
    guard(() => session.signOut()),
  );
  ipcMain.handle(
    IPC.authStatus,
    guard(() => session.getState()),
  );
  ipcMain.handle(
    IPC.authGetIdToken,
    guard((_e, opts: { forceRefresh: boolean }) => session.getIdToken(opts?.forceRefresh ?? false)),
  );

  ipcMain.handle(
    IPC.dbUserVersion,
    guard(() => userVersion()),
  );

  // ─── Window chrome ───────────────────────────────────────────────────────
  ipcMain.handle(
    IPC.windowMinimize,
    guard((event) => BrowserWindow.fromWebContents(event.sender)?.minimize()),
  );
  ipcMain.handle(
    IPC.windowToggleMaximize,
    guard((event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }),
  );
  ipcMain.handle(
    IPC.windowClose,
    guard((event) => BrowserWindow.fromWebContents(event.sender)?.close()),
  );
  ipcMain.handle(
    IPC.windowIsMaximized,
    guard((event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false),
  );

  // ─── Title-bar menu commands ───────────────────────────────────────────────
  ipcMain.handle(
    IPC.menuEditAction,
    guard((event, action: EditAction) => {
      const wc = event.sender;
      switch (action) {
        case 'undo':
          return wc.undo();
        case 'redo':
          return wc.redo();
        case 'cut':
          return wc.cut();
        case 'copy':
          return wc.copy();
        case 'paste':
          return wc.paste();
        case 'selectAll':
          return wc.selectAll();
      }
    }),
  );
  ipcMain.handle(
    IPC.menuReload,
    guard((event) => {
      // Reload is a development affordance; ignore it in the packaged app.
      if (opts.isDev) event.sender.reload();
    }),
  );
  ipcMain.handle(
    IPC.menuZoom,
    guard((event, action: ZoomAction) => {
      const wc = event.sender;
      if (action === 'reset') wc.setZoomLevel(0);
      else
        wc.setZoomLevel(
          Math.max(-5, Math.min(5, wc.getZoomLevel() + (action === 'in' ? 0.5 : -0.5))),
        );
    }),
  );
  ipcMain.handle(
    IPC.menuNewWindow,
    guard(() => opts.createWindow()),
  );
  ipcMain.handle(
    IPC.menuAbout,
    guard(() => {
      void dialog.showMessageBox({
        type: 'info',
        title: 'About Pidom',
        message: 'Pidom for Desktop',
        detail: `Version ${app.getVersion()}\nThe desktop companion to your Pidom reading library.`,
        buttons: ['OK'],
      });
    }),
  );

  // ─── External links ────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC.shellOpenExternal,
    guard((_event, url: string) => {
      // Only ever hand the OS an https URL — never a file, custom scheme, or
      // anything a compromised renderer might use to reach a local handler.
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error('openExternal rejected: malformed URL');
      }
      if (parsed.protocol !== 'https:') throw new Error('openExternal rejected: non-https URL');
      return shell.openExternal(parsed.toString());
    }),
  );

  // ─── Reader ────────────────────────────────────────────────────────────────
  // The renderer mints the signed URL through Convex (which checks ownership)
  // and hands it here; main does the parts a sandboxed web context cannot —
  // fetch to disk, verify the bytes are a PDF, bound the size. See ./reader.ts.
  ipcMain.handle(
    IPC.readerOpenDocument,
    guard((_event, request: ReaderOpenRequest) => openDocument(request)),
  );
  ipcMain.handle(
    IPC.readerCloseDocument,
    guard((_event, handle: string) => closeDocument(handle)),
  );
  ipcMain.handle(
    IPC.readerFetchText,
    guard((_event, signedUrl: string) => fetchText(signedUrl)),
  );
}
