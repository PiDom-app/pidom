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
import { BULK_MAX, COVER_BYTE_MAX } from '@convex-model/limits';
import {
  IPC,
  type EditAction,
  type LocalDocumentStatus,
  type ReaderOpenRequest,
  type ReaderSaveRequest,
  type UpdatePrefs,
  type ZoomAction,
} from '../shared/ipc';
import { SessionManager } from './auth/oauth';
import { deleteEditorDraft, getEditorDraft, putEditorDraft, userVersion } from './db';
import { closeDocument, fetchText, openDocument, saveDocument, saveDocumentAs } from './reader';
import type { CollectionsService } from './collections/service';
import type { StorageService } from './storage/service';
import type { ImportService } from './storage/import-service';
import type { UpdateService } from './updater/update-service';

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
// A collection id is either a synced Convex id (the same alnum shape as a
// document id) or a client-minted `col_<32hex>` placeholder awaiting reconcile.
const CollectionIdSchema = z.string().regex(/^(?:col_[a-f0-9]{32}|[A-Za-z0-9]{1,64})$/);
// A generous outer bound; the service's `cleanName` trims and slices to
// COLLECTION_NAME_MAX (80) and re-validates, so this only stops an unbounded
// string reaching main, not the real length rule.
const CollectionNameSchema = z.string().min(1).max(200);
// A bulk document-id set, length-capped at BULK_MAX so no single call hands main
// an unbounded array; the renderer chunks larger selections.
const DocIdsSchema = z.array(IdSchema).min(1).max(BULK_MAX);

const Schemas = {
  forceRefresh: z.object({ forceRefresh: z.boolean() }),
  editAction: z.enum(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']),
  zoomAction: z.enum(['in', 'out', 'reset']),
  externalUrl: UrlSchema,
  keepAwake: z.boolean(),
  readerOpen: z.object({
    documentId: IdSchema,
    signedUrl: UrlSchema,
    documentKind: z.string().max(16).optional(),
  }),
  handle: HandleSchema,
  editorDraftDocumentId: IdSchema,
  editorDraftPut: z.object({ documentId: IdSchema, content: z.string().max(2_000_000) }),
  readerSaveAs: z.object({
    handle: HandleSchema,
    bytes: z.instanceof(ArrayBuffer).refine((value) => value.byteLength > 0 && value.byteLength <= 32 * 1024 * 1024),
    suggestedName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,159}$/),
    format: z.enum(['txt', 'md', 'csv', 'docx', 'odt', 'xlsx', 'pptx', 'pdf', 'image']),
  }),
  readerSave: z.object({
    handle: HandleSchema,
    bytes: z.instanceof(ArrayBuffer).refine((value) => value.byteLength > 0 && value.byteLength <= 32 * 1024 * 1024),
    expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/i),
    format: z.enum(['txt', 'md', 'csv', 'docx', 'odt', 'xlsx', 'pptx', 'pdf', 'image']),
  }),
  signedUrl: UrlSchema,
  documentId: IdSchema,
  destination: PathSchema,
  // A rendered page-1 cover handed from the renderer (pdfjs is renderer-only) for
  // main to PUT to R2. Bounded by the same COVER_BYTE_MAX the server enforces, so
  // a hostile or buggy renderer cannot hand main an unbounded buffer; empty is
  // rejected too (a zero-byte cover is never a valid JPEG).
  attachCover: z
    .object({ documentId: IdSchema, jpeg: z.instanceof(ArrayBuffer) })
    .refine((v) => v.jpeg.byteLength > 0 && v.jpeg.byteLength <= COVER_BYTE_MAX),
  // Drag-drop hands main a batch of resolved absolute paths; a folder scan can be
  // large, so the cap is generous but finite. Each path is bounded too.
  paths: z.array(PathSchema).min(1).max(10_000),
  association: z.boolean(),
  updatePrefs: z.object({
    autoCheck: z.boolean(),
    autoDownload: z.boolean(),
    quiet: z.boolean(),
  }),
  // ─── Collections / favorites / finished (local-first organization) ─────────
  collectionName: CollectionNameSchema,
  collectionId: CollectionIdSchema,
  documentIds: DocIdsSchema,
  collectionRename: z.object({ collectionId: CollectionIdSchema, name: CollectionNameSchema }),
  collectionDocs: z.object({ collectionId: CollectionIdSchema, documentIds: DocIdsSchema }),
  setFavorite: z.object({ documentIds: DocIdsSchema, isFavorite: z.boolean() }),
  setFinished: z.object({ documentIds: DocIdsSchema, isFinished: z.boolean() }),
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
  updates: UpdateService,
  collections: CollectionsService,
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

  // Push update-state changes (a probe finishing, a download staging, an error)
  // so the title-bar indicator and Settings track main live. Coalesced on the
  // same 150 ms trailing timer as storage/imports; each push is a full snapshot,
  // so collapsing a burst to the latest loses nothing.
  let updateFlush: ReturnType<typeof setTimeout> | null = null;
  const flushUpdate = () => {
    updateFlush = null;
    broadcast(IPC.updateChanged, updates.getState());
  };
  updates.onChange(() => {
    if (!updateFlush) updateFlush = setTimeout(flushUpdate, 150);
  });

  // Push organization changes (a collection created/renamed, a membership or
  // favorite/finished toggle, an outbox row draining) so the library, collection
  // screens and the "Changes will sync" chip track the local mirror live. Each
  // send is a full snapshot (the list plus the pending-outbox count), so a burst
  // collapses to the latest on the same 150 ms trailing timer as the others.
  let collectionsFlush: ReturnType<typeof setTimeout> | null = null;
  const flushCollections = () => {
    collectionsFlush = null;
    broadcast(IPC.collectionsChanged, collections.snapshot());
  };
  collections.onChange(() => {
    if (!collectionsFlush) collectionsFlush = setTimeout(flushCollections, 150);
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
  ipcMain.handle(
    IPC.editorDraftGet,
    guard((_event, payload) => getEditorDraft(Schemas.editorDraftDocumentId.parse(payload))),
  );
  ipcMain.handle(
    IPC.editorDraftPut,
    guard((_event, payload) => {
      const value = Schemas.editorDraftPut.parse(payload);
      putEditorDraft(value.documentId, value.content);
    }),
  );
  ipcMain.handle(
    IPC.editorDraftDelete,
    guard((_event, payload) => deleteEditorDraft(Schemas.editorDraftDocumentId.parse(payload))),
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
  // DevTools toggle is intentionally available in the packaged app too: a blank
  // window is almost always an uncaught renderer error, and this is how a user
  // can open the console to see it. Triggered only by an explicit title-bar/menu
  // action, never automatically in production.
  ipcMain.handle(
    IPC.menuToggleDevTools,
    guard((event) => event.sender.toggleDevTools()),
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
  handleWith(
    IPC.readerSaveAs,
    Schemas.readerSaveAs,
    (_event, request) => saveDocumentAs(opts.getWindow(), request),
  );
  handleWith(
    IPC.readerSave,
    Schemas.readerSave,
    (_event, request: ReaderSaveRequest) => saveDocument(opts.getWindow(), request),
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
  // The renderer renders page 1 to a JPEG (pdfjs is renderer-only) and hands the
  // bytes here; main does the R2 PUT and attach, keeping R2 out of the renderer's
  // CSP. Best-effort in the service — a cover never fails an import.
  handleWith(IPC.storageAttachCover, Schemas.attachCover, (_event, { documentId, jpeg }) =>
    storage.attachCover(documentId, new Uint8Array(jpeg)),
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

  // ─── Auto-update ─────────────────────────────────────────────────────────────
  // The renderer never supplies a feed or URL; the service hardcodes owner/repo
  // and is inert off packaged-Windows. `setPrefs` is the one channel carrying a
  // payload, zod-validated like the rest.
  ipcMain.handle(
    IPC.updateGetState,
    guard(() => updates.getState()),
  );
  ipcMain.handle(
    IPC.updateCheck,
    guard(() => updates.check()),
  );
  ipcMain.handle(
    IPC.updateDownload,
    guard(() => updates.download()),
  );
  ipcMain.handle(
    IPC.updateRestart,
    guard(() => updates.restart()),
  );
  ipcMain.handle(
    IPC.updateOpenNotes,
    guard(() => updates.openNotes()),
  );
  handleWith(IPC.updateSetPrefs, Schemas.updatePrefs, (_event, prefs: UpdatePrefs) =>
    updates.setPrefs(prefs),
  );

  // ─── Collections / favorites / finished (local-first organization) ─────────
  // One controlled method per op — never a generic SQL passthrough. Every write
  // lands in the local mirror and an outbox row in one transaction and is
  // replayed to the same owner-checked Convex functions on reconnect; reads come
  // from the local mirror so organization works offline. Ids and names are
  // validated here (outer layer) and re-validated in the service; the service
  // scopes every row by the signed-in account.
  ipcMain.handle(
    IPC.collectionsList,
    guard(() => collections.list()),
  );
  ipcMain.handle(
    IPC.collectionsPending,
    guard(() => collections.pending()),
  );
  handleWith(IPC.collectionsForDocument, Schemas.documentId, (_event, documentId: string) =>
    collections.forDocument(documentId),
  );
  handleWith(IPC.collectionsCreate, Schemas.collectionName, (_event, name: string) =>
    collections.create(name),
  );
  handleWith(IPC.collectionsRename, Schemas.collectionRename, (_event, { collectionId, name }) =>
    collections.rename(collectionId, name),
  );
  handleWith(IPC.collectionsRemove, Schemas.collectionId, (_event, collectionId: string) =>
    collections.remove(collectionId),
  );
  handleWith(
    IPC.collectionsAddDocuments,
    Schemas.collectionDocs,
    (_event, { collectionId, documentIds }) => collections.addDocuments(collectionId, documentIds),
  );
  handleWith(
    IPC.collectionsRemoveDocuments,
    Schemas.collectionDocs,
    (_event, { collectionId, documentIds }) =>
      collections.removeDocuments(collectionId, documentIds),
  );
  handleWith(
    IPC.collectionsSetFavorite,
    Schemas.setFavorite,
    (_event, { documentIds, isFavorite }) => collections.setFavorite(documentIds, isFavorite),
  );
  handleWith(
    IPC.collectionsSetFinished,
    Schemas.setFinished,
    (_event, { documentIds, isFinished }) => collections.setFinished(documentIds, isFinished),
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
