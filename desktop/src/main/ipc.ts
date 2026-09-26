import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerSaveBlocker,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { z } from 'zod';
import {
  IPC,
  type EditAction,
  type LocalDocumentStatus,
  type ReaderOpenRequest,
  type ZoomAction,
} from '../shared/ipc';
import { SessionManager } from './auth/oauth';
import { userVersion } from './db';
import { closeDocument, fetchText, openDocument } from './reader';
import type { StorageService } from './storage/service';
import type { ImportService } from './storage/import-service';

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
 * Payload schemas for every IPC channel that carries one. This is the central
 * validation layer: a handler's argument is parsed here — after the origin
 * `guard()`, before the service — so a message that clears the origin check but
 * carries a malformed, over-long, or wrong-typed payload is dropped at the door
 * rather than reaching the filesystem/network code (which re-validates anyway;
 * this is the outer, uniform layer). Every bound is deliberate: ids and handles
 * match the shapes main mints, strings and arrays are length-capped so a hostile
 * or buggy renderer cannot hand main an unbounded payload.
 */
const IdSchema = z.string().regex(/^[A-Za-z0-9]{1,64}$/);
const HandleSchema = z.string().regex(/^[a-f0-9]{32}$/);
const UrlSchema = z.string().min(1).max(4096);
const PathSchema = z.string().min(1).max(4096);

const Schemas = {
  forceRefresh: z.object({ forceRefresh: z.boolean() }),
  editAction: z.enum(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']),
  zoomAction: z.enum(['in', 'out', 'reset']),
  externalUrl: UrlSchema,
  keepAwake: z.boolean(),
  readerOpen: z.object({ documentId: IdSchema, signedUrl: UrlSchema }),
  handle: HandleSchema,
  signedUrl: UrlSchema,
  documentId: IdSchema,
  destination: PathSchema,
  // Drag-drop hands main a batch of resolved absolute paths; a folder scan can be
  // large, so the cap is generous but finite. Each path is bounded too.
  paths: z.array(PathSchema).min(1).max(10_000),
  association: z.boolean(),
} as const;

/**
 * Registers every IPC handler the preload bridge invokes. One place, so the
 * renderer's reachable surface is auditable at a glance. Every handler first
 * verifies the sender frame's origin — defence in depth, per Electron's
 * security guidance: a message from any other frame is dropped.
 */
export function registerIpc(
  session: SessionManager,
  storage: StorageService,
  imports: ImportService,
  opts: IpcOptions,
): void {
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

  /**
   * Register a handler whose single payload arg is validated by `schema` before
   * the service runs. Origin is checked first (via `guard`), then shape: an
   * untrusted sender never reaches the parser. A payload that fails the schema
   * throws a generic rejection — the bad value is never echoed back.
   */
  const handleWith = <T>(
    channel: string,
    schema: z.ZodType<T>,
    fn: (event: IpcMainInvokeEvent, payload: T) => unknown,
  ): void => {
    ipcMain.handle(
      channel,
      guard((event, raw: unknown) => {
        const result = schema.safeParse(raw);
        if (!result.success) throw new Error(`IPC rejected: invalid payload for ${channel}`);
        return fn(event, result.data);
      }),
    );
  };

  // Push a message to every open window. Auth, storage, migration and import
  // state are process-wide facts, not per-window: before this, a second window
  // (File → New Window) left the first one's pushes going only to whichever
  // window `getWindow()` happened to return, so the other silently stopped
  // updating. Sending to every live window keeps them all in sync. The
  // reader-open navigation below stays targeted — only one window should jump to
  // a file — and each window's own maximize state is pushed per-window in
  // `createWindow`, so neither is broadcast here.
  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  };

  // Push auth changes to the renderer so React state tracks the main process.
  session.onChange((state) => {
    broadcast(IPC.authChanged, state);
  });

  // Push local-storage changes (a download advancing, a file removed) so the
  // Downloads screen and Storage settings track the main process live. Coalesced
  // on a short trailing timer, keyed by document, so a burst of rapid updates
  // (or any future high-frequency emitter) collapses to one send per document
  // instead of flooding the renderer. Each status is a full snapshot, so keeping
  // only the latest per document loses nothing.
  const pendingStorage = new Map<string, LocalDocumentStatus>();
  let storageFlush: ReturnType<typeof setTimeout> | null = null;
  const flushStorage = () => {
    storageFlush = null;
    const batch = [...pendingStorage.values()];
    pendingStorage.clear();
    for (const status of batch) broadcast(IPC.storageChanged, status);
  };
  storage.onChange((status) => {
    pendingStorage.set(status.documentId, status);
    if (!storageFlush) storageFlush = setTimeout(flushStorage, 150);
  });

  // Push library-migration progress so the Move dialog can show live steps.
  storage.onMigration((status) => {
    broadcast(IPC.storageMigrationChanged, status);
  });

  // Push import-job changes (a stage landing, a job advancing to uploaded, a
  // failure) so the library grid and Import settings track main live. Each
  // emission is a full snapshot of every job, so a burst collapses to one send
  // of the latest snapshot — mirrors the storage coalescing above.
  let importFlush: ReturnType<typeof setTimeout> | null = null;
  const flushImports = () => {
    importFlush = null;
    broadcast(IPC.importChanged, imports.list());
  };
  imports.onChange(() => {
    if (!importFlush) importFlush = setTimeout(flushImports, 150);
  });

  // Push the document id to open when the app is launched/focused with a file
  // (double-click, "Open With", Open Recent). The renderer navigates to the
  // reader; the file has already been staged locally by then. Targeted, not
  // broadcast: only the focused window (or the last active one) should jump.
  imports.onOpen((documentId) => {
    const target = BrowserWindow.getFocusedWindow() ?? opts.getWindow();
    target?.webContents.send(IPC.importOpenExternalFile, documentId);
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
  handleWith(IPC.authGetIdToken, Schemas.forceRefresh, (_e, { forceRefresh }) =>
    session.getIdToken(forceRefresh),
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
  handleWith(IPC.menuEditAction, Schemas.editAction, (event, action: EditAction) => {
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
  });
  ipcMain.handle(
    IPC.menuReload,
    guard((event) => {
      // Reload is a development affordance; ignore it in the packaged app.
      if (opts.isDev) event.sender.reload();
    }),
  );
  handleWith(IPC.menuZoom, Schemas.zoomAction, (event, action: ZoomAction) => {
    const wc = event.sender;
    if (action === 'reset') wc.setZoomLevel(0);
    else
      wc.setZoomLevel(
        Math.max(-5, Math.min(5, wc.getZoomLevel() + (action === 'in' ? 0.5 : -0.5))),
      );
  });
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
  handleWith(IPC.shellOpenExternal, Schemas.externalUrl, (_event, url: string) => {
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
  });

  // ─── Reader ────────────────────────────────────────────────────────────────
  // The renderer mints the signed URL through Convex (which checks ownership)
  // and hands it here; main does the parts a sandboxed web context cannot —
  // fetch to disk, verify the bytes are a PDF, bound the size. See ./reader.ts.
  handleWith(IPC.readerOpenDocument, Schemas.readerOpen, (_event, request: ReaderOpenRequest) =>
    openDocument(request),
  );
  handleWith(IPC.readerCloseDocument, Schemas.handle, (_event, handle: string) =>
    closeDocument(handle),
  );
  handleWith(IPC.readerFetchText, Schemas.signedUrl, (_event, signedUrl: string) =>
    fetchText(signedUrl),
  );

  // ─── Local document storage ──────────────────────────────────────────────────
  // Domain-level operations only; the renderer names a document by its Convex id
  // and never a path. Node-only work (fetch, hash, filesystem) runs in the
  // service. Each handler is behind `guard()` like every other.
  handleWith(IPC.storageDownload, Schemas.documentId, (_event, documentId: string) =>
    storage.download(documentId),
  );
  handleWith(IPC.storageRemove, Schemas.documentId, (_event, documentId: string) =>
    storage.remove(documentId),
  );
  handleWith(IPC.storageStatus, Schemas.documentId, (_event, documentId: string) =>
    storage.status(documentId),
  );
  ipcMain.handle(
    IPC.storageList,
    guard(() => storage.list()),
  );
  ipcMain.handle(
    IPC.storageUsage,
    guard(() => storage.usage()),
  );
  ipcMain.handle(
    IPC.storageClearCache,
    guard(() => storage.clearCache()),
  );
  handleWith(IPC.storageVerify, Schemas.documentId, (_event, documentId: string) =>
    storage.verify(documentId),
  );
  ipcMain.handle(
    IPC.storageReveal,
    guard(async () => {
      const root = await storage.libraryRoot();
      shell.showItemInFolder(root);
    }),
  );
  ipcMain.handle(
    IPC.storageCopyPath,
    guard(() => storage.copyPath()),
  );
  ipcMain.handle(
    IPC.storageChooseFolder,
    guard(() => storage.chooseFolder()),
  );
  handleWith(IPC.storageMoveLibrary, Schemas.destination, (_event, destination: string) =>
    storage.moveLibrary(destination),
  );

  // ─── Desktop-initiated import ────────────────────────────────────────────────
  // Add PDFs from THIS computer. Main does every fs/network step; the renderer
  // names a job by its device-minted id and never sends or receives a path. Drop
  // paths are resolved in preload via `webUtils` and invoked to `importAddPaths`;
  // that channel is still behind `guard()`, and main re-validates every path.
  ipcMain.handle(
    IPC.importPickFiles,
    guard(() => imports.pickFiles()),
  );
  ipcMain.handle(
    IPC.importPickFolder,
    guard(() => imports.pickFolder()),
  );
  handleWith(IPC.importAddPaths, Schemas.paths, (_event, paths: string[]) =>
    imports.addPaths(paths),
  );
  ipcMain.handle(
    IPC.importList,
    guard(() => imports.list()),
  );
  handleWith(IPC.importCancel, Schemas.documentId, (_event, localId: string) =>
    imports.cancel(localId),
  );
  handleWith(IPC.importRetry, Schemas.documentId, (_event, localId: string) =>
    imports.retry(localId),
  );
  ipcMain.handle(
    IPC.importRetryAll,
    guard(() => imports.retryAll()),
  );
  ipcMain.handle(
    IPC.importGetAssociation,
    guard(() => imports.getAssociation()),
  );
  handleWith(IPC.importSetAssociation, Schemas.association, (_event, on: boolean) =>
    imports.setAssociation(on),
  );

  // ─── Keep the display awake while reading ────────────────────────────────────
  // One blocker id, started when a reader turns the setting on and stopped when
  // it turns off or the reader closes. Kept here rather than in the renderer
  // because only the main process can hold a power assertion.
  let keepAwakeId: number | null = null;
  handleWith(IPC.powerSetKeepAwake, Schemas.keepAwake, (_event, on: boolean) => {
    if (on) {
      if (keepAwakeId === null || !powerSaveBlocker.isStarted(keepAwakeId)) {
        keepAwakeId = powerSaveBlocker.start('prevent-display-sleep');
      }
    } else if (keepAwakeId !== null) {
      if (powerSaveBlocker.isStarted(keepAwakeId)) powerSaveBlocker.stop(keepAwakeId);
      keepAwakeId = null;
    }
  });
}
