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
  platform: {
    os: NodeJS.Platform;
  };
}
