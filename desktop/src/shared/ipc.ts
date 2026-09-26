/**
 * The IPC contract shared by the main process, the preload bridge, and the
 * renderer. One source of truth for channel names and payload shapes so the
 * three processes cannot drift.
 */

export const IPC = {
  authSignIn: 'auth:signIn',
  authSignOut: 'auth:signOut',
  authGetIdToken: 'auth:getIdToken',
  authStatus: 'auth:status',
  authChanged: 'auth:changed', // main → renderer push
  dbUserVersion: 'db:userVersion',

  // Window chrome — the custom, frameless title bar drives these.
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggleMaximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:isMaximized',
  windowMaximizeChanged: 'window:maximizeChanged', // main → renderer push

  // Title-bar menu commands.
  menuEditAction: 'menu:editAction',
  menuReload: 'menu:reload',
  menuZoom: 'menu:zoom',
  menuNewWindow: 'menu:newWindow',
  menuAbout: 'menu:about',

  // Open a vetted external URL in the system browser.
  shellOpenExternal: 'shell:openExternal',

  // Keep the display awake while reading (a per-device reader setting).
  powerSetKeepAwake: 'power:setKeepAwake',

  // Reader: fetch a signed URL to a verified local copy and hand back a handle
  // the renderer can render from; release it when the document closes.
  readerOpenDocument: 'reader:openDocument',
  readerCloseDocument: 'reader:closeDocument',
  // Fetch a document's extracted-text object (find in document). R2 is not in
  // the renderer CSP, so main fetches the signed URL and returns the JSON text.
  readerFetchText: 'reader:fetchText',

  // Local document storage: download a cloud document to a verified, persistent
  // local copy and manage what is held on this computer. Node-only work (fetch,
  // hash, filesystem) runs in main; the renderer addresses documents by id.
  storageDownload: 'storage:download',
  storageRemove: 'storage:remove',
  storageStatus: 'storage:status',
  storageList: 'storage:list',
  storageUsage: 'storage:usage',
  storageClearCache: 'storage:clearCache',
  storageVerify: 'storage:verify',
  storageReveal: 'storage:reveal',
  storageCopyPath: 'storage:copyPath',
  // Library location: pick a folder with the OS dialog, then migrate the whole
  // document tree to it (validate → copy → verify → switch → clean up).
  storageChooseFolder: 'storage:chooseFolder',
  storageMoveLibrary: 'storage:moveLibrary',
  storageChanged: 'storage:changed', // main → renderer push
  storageMigrationChanged: 'storage:migrationChanged', // main → renderer push

  // Desktop-initiated import: add PDFs from THIS computer (file picker, folder
  // scan, drag-drop, "Open With"). Main does every fs/network step; the renderer
  // never sends or receives a filesystem path — drop paths are resolved in
  // preload via `webUtils` and invoked straight to main.
  importPickFiles: 'import:pickFiles',
  importPickFolder: 'import:pickFolder',
  importAddPaths: 'import:addPaths', // preload → main (resolved drop paths)
  importList: 'import:list',
  importCancel: 'import:cancel',
  importRetry: 'import:retry',
  importRetryAll: 'import:retryAll',
  importOpenExternalFile: 'import:openExternalFile', // main → renderer (launch/assoc)
  importGetAssociation: 'import:getAssociation',
  importSetAssociation: 'import:setAssociation',
  importChanged: 'import:changed', // main → renderer push
} as const;

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out';

/** A signed-in reader's public profile claims, derived from the verified token. */
export interface AuthProfile {
  subject: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

export interface AuthState {
  status: AuthStatus;
  profile: AuthProfile | null;
}

/** The clipboard/history editing commands the Edit menu can issue. */
export type EditAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';

/** The zoom commands the View menu can issue. */
export type ZoomAction = 'in' | 'out' | 'reset';

/** What the renderer hands main to open a document. */
export interface ReaderOpenRequest {
  /** The Convex document id, used to key the cached copy. Never a path. */
  documentId: string;
  /** A short-lived signed R2 URL the renderer just minted through Convex. */
  signedUrl: string;
}

/**
 * A verified local copy, addressed rather than transferred.
 *
 * `url` is served by main over a dedicated scheme, so a 100 MB PDF streams to
 * the engine instead of being cloned through an IPC message. The handle is the
 * only name for the file the renderer ever learns; the real path stays in main.
 */
export interface ReaderDocumentHandle {
  handle: string;
  url: string;
  bytes: number;
}

/** The availability of a document's physical copy on this computer. Mirrors the
 *  mobile app's file states so both clients describe the library the same way. */
export type LocalFileState =
  | 'queued'
  | 'downloading'
  | 'verifying'
  | 'available'
  | 'paused'
  | 'failed'
  | 'outdated'
  | 'missing'
  | 'none'; // no local copy and none wanted

/** One document's local status, as the renderer sees it — never a path. */
export interface LocalDocumentStatus {
  documentId: string;
  state: LocalFileState;
  /** Bytes on disk when present. */
  bytes: number | null;
  /** In-flight download progress, when downloading. */
  receivedBytes: number | null;
  totalBytes: number | null;
  /** A short reason code when `state` is `failed`. */
  error: string | null;
}

/** The phases of a library-location migration, reported as it runs. `copying`
 *  and `verifying` carry progress; the rest are transitions. */
export type MigrationPhase =
  | 'idle'
  | 'validating'
  | 'copying'
  | 'verifying'
  | 'switching'
  | 'cleaning'
  | 'done'
  | 'failed';

/** Live migration progress pushed to the renderer while a move runs. */
export interface MigrationStatus {
  phase: MigrationPhase;
  /** Documents copied/verified so far and in total, when the phase carries them. */
  done: number;
  total: number;
  /** Bytes copied so far, for a byte-level readout. */
  copiedBytes: number;
  totalBytes: number;
  /** The destination root being moved to, for display. */
  destination: string | null;
  /** A short non-sensitive reason code when `phase` is `failed`. */
  error: string | null;
}

/** The outcome of a completed (or rejected) migration request. */
export interface MigrationResult {
  ok: boolean;
  /** The active library root after the request — new on success, unchanged on failure. */
  libraryPath: string | null;
  /** A short reason code when `ok` is false. */
  error: string | null;
}

/** What this computer is holding locally, for the Storage settings surface. */
export interface StorageUsage {
  /** Documents with an `available` local copy. */
  documentCount: number;
  /** Bytes under the managed `documents/` directory. */
  documentBytes: number;
  /** Bytes under the regenerable `cache/` directory. */
  cacheBytes: number;
  /** Free space on the volume holding the library, or null if unknown. */
  freeBytes: number | null;
  /** The active managed library root on this computer. */
  libraryPath: string | null;
  /** True when the library sits at a custom, user-chosen root (not the default). */
  isCustomLocation: boolean;
}

/**
 * The lifecycle of a desktop-initiated import, mirrored from the main-process DB
 * enum. `staged` and later states all mean the document is on disk and readable
 * offline; the network states (`registering`→`uploaded`) run when auth returns.
 */
export type ImportJobState =
  | 'staging'
  | 'staged'
  | 'registering'
  | 'registered'
  | 'uploading'
  | 'uploaded'
  | 'done'
  | 'failed'
  | 'duplicate';

/**
 * One import job as the renderer sees it — never a filesystem path. Local-only
 * jobs (no `documentId` yet) surface in the library grid as pseudo-documents
 * keyed by `localId`; once reconciled they carry a `documentId` and the real
 * document arrives through `snapshot`.
 */
export interface ImportJobStatus {
  localId: string;
  title: string;
  state: ImportJobState;
  byteSize: number;
  /** R2 upload progress in bytes while `uploading`, else null. */
  receivedBytes: number | null;
  /** The Convex id once registered; null before. */
  documentId: string | null;
  /** A short non-sensitive reason code when `state` is `failed`. */
  error: string | null;
}

/** The surface exposed on `window.pidom` by the preload bridge. */
export interface PidomBridge {
  auth: {
    signIn(): Promise<AuthState>;
    signOut(): Promise<AuthState>;
    /** The current Google ID token, refreshed if needed, or null when signed out. */
    getIdToken(opts: { forceRefresh: boolean }): Promise<string | null>;
    status(): Promise<AuthState>;
    /** Subscribe to auth changes; returns an unsubscribe function. */
    onChange(listener: (state: AuthState) => void): () => void;
  };
  db: {
    /** Trivial round-trip proving the main-process SQLite connection is live. */
    userVersion(): Promise<number>;
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    /** Subscribe to maximize/unmaximize; returns an unsubscribe function. */
    onMaximizeChange(listener: (isMaximized: boolean) => void): () => void;
  };
  menu: {
    editAction(action: EditAction): Promise<void>;
    reload(): Promise<void>;
    zoom(action: ZoomAction): Promise<void>;
    newWindow(): Promise<void>;
    about(): Promise<void>;
  };
  shell: {
    /** Opens an https URL in the system browser; anything else is rejected. */
    openExternal(url: string): Promise<void>;
  };
  power: {
    /** Prevents (or releases) display sleep while a document is open. */
    setKeepAwake(on: boolean): Promise<void>;
  };
  reader: {
    /**
     * Fetches the signed URL to a temp file, checks the `%PDF-` magic and the
     * size ceiling, and returns a handle to read it back through. Rejects if
     * the bytes are not a PDF.
     */
    openDocument(request: ReaderOpenRequest): Promise<ReaderDocumentHandle>;
    /** Drops the cached copy. Safe to call twice, or on an unknown handle. */
    closeDocument(handle: string): Promise<void>;
    /**
     * Fetches the signed URL to a document's extracted-text object and returns
     * its JSON text. The renderer parses it; main only moves the bytes, since
     * the R2 host is outside the renderer's connect-src.
     */
    fetchText(signedUrl: string): Promise<string>;
  };
  storage: {
    /** Fetches, verifies, and persists a cloud document's PDF on this computer. */
    download(documentId: string): Promise<LocalDocumentStatus>;
    /** Deletes the local copy. The account keeps the document. */
    remove(documentId: string): Promise<LocalDocumentStatus>;
    /** One document's local status. */
    status(documentId: string): Promise<LocalDocumentStatus>;
    /** Every document with a local record on this computer. */
    list(): Promise<LocalDocumentStatus[]>;
    /** Local usage totals for the Storage settings surface. */
    usage(): Promise<StorageUsage>;
    /** Deletes only the regenerable cache; documents are untouched. */
    clearCache(): Promise<StorageUsage>;
    /** Re-hashes a local copy, marking it outdated/missing if it no longer matches. */
    verify(documentId: string): Promise<LocalDocumentStatus>;
    /** Reveals the library directory in the OS file manager. */
    reveal(): Promise<void>;
    /** Copies the library path to the clipboard (done in main; the renderer has none). */
    copyPath(): Promise<void>;
    /** Opens the OS folder picker; returns the chosen absolute path, or null if cancelled. */
    chooseFolder(): Promise<string | null>;
    /**
     * Migrates the whole document library to `destination`: validates it, copies
     * and verifies every file there, switches the active root, then removes the
     * old copies. Reading stays available throughout. Progress arrives on
     * `onMigration`; this resolves with the final outcome.
     */
    moveLibrary(destination: string): Promise<MigrationResult>;
    /** Subscribe to local-status changes; returns an unsubscribe function. */
    onChange(listener: (status: LocalDocumentStatus) => void): () => void;
    /** Subscribe to migration progress; returns an unsubscribe function. */
    onMigration(listener: (status: MigrationStatus) => void): () => void;
  };
  import: {
    /** Opens the OS file picker (PDF filter, multi-select), stages the chosen
     *  files, and returns how many were queued. No path crosses back. */
    pickFiles(): Promise<number>;
    /** Opens the OS folder picker, scans it for PDFs (bounded), stages them, and
     *  returns how many were queued. */
    pickFolder(): Promise<number>;
    /** Stages files dropped from the OS. The renderer passes the dropped `File`
     *  objects; preload resolves each to a path via `webUtils` and forwards only
     *  the paths to main — the renderer never receives them. Returns the count. */
    addDropped(files: File[]): Promise<number>;
    /** Every import job on this computer, for the grid merge and activity readout. */
    list(): Promise<ImportJobStatus[]>;
    /** Cancels an import: removes its job, staged file, and local record. */
    cancel(localId: string): Promise<void>;
    /** Retries a failed import from where it stopped. */
    retry(localId: string): Promise<void>;
    /** Retries every failed import. Returns how many were re-queued. */
    retryAll(): Promise<number>;
    /** Whether the Pidom "Open With" handler is registered for `.pdf` (Windows). */
    getAssociation(): Promise<boolean>;
    /** Registers or removes the Pidom "Open With" handler for `.pdf` (Windows).
     *  Cannot seize the default handler — that stays the user's choice. */
    setAssociation(on: boolean): Promise<boolean>;
    /** Subscribe to import-job changes; returns an unsubscribe function. */
    onChange(listener: (jobs: ImportJobStatus[]) => void): () => void;
    /** Fired when the app is launched or focused with a file to open (double-click
     *  / "Open With" / Open Recent). Carries the just-imported document id so the
     *  renderer can navigate to the reader; returns an unsubscribe function. */
    onOpenExternalDocument(listener: (documentId: string) => void): () => void;
  };
  platform: {
    os: NodeJS.Platform;
  };
}
