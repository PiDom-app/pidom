import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type AuthState,
  type EditAction,
  type LocalDocumentStatus,
  type PidomBridge,
  type ReaderOpenRequest,
  type ZoomAction,
} from '../shared/ipc';

/**
 * The preload bridge. This is the single, deliberately small seam between the
 * sandboxed renderer and the main process. It exposes named async functions
 * over `contextBridge` and never hands the renderer a raw `ipcRenderer`, so the
 * renderer can invoke only the channels enumerated here.
 */
const bridge: PidomBridge = {
  auth: {
    signIn: () => ipcRenderer.invoke(IPC.authSignIn),
    signOut: () => ipcRenderer.invoke(IPC.authSignOut),
    getIdToken: (opts) => ipcRenderer.invoke(IPC.authGetIdToken, opts),
    status: () => ipcRenderer.invoke(IPC.authStatus),
    onChange: (listener: (state: AuthState) => void) => {
      const handler = (_event: unknown, state: AuthState) => listener(state);
      ipcRenderer.on(IPC.authChanged, handler);
      return () => ipcRenderer.removeListener(IPC.authChanged, handler);
    },
  },
  db: {
    userVersion: () => ipcRenderer.invoke(IPC.dbUserVersion),
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
    close: () => ipcRenderer.invoke(IPC.windowClose),
    isMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized),
    onMaximizeChange: (listener: (isMaximized: boolean) => void) => {
      const handler = (_event: unknown, value: boolean) => listener(value);
      ipcRenderer.on(IPC.windowMaximizeChanged, handler);
      return () => ipcRenderer.removeListener(IPC.windowMaximizeChanged, handler);
    },
  },
  menu: {
    editAction: (action: EditAction) => ipcRenderer.invoke(IPC.menuEditAction, action),
    reload: () => ipcRenderer.invoke(IPC.menuReload),
    zoom: (action: ZoomAction) => ipcRenderer.invoke(IPC.menuZoom, action),
    newWindow: () => ipcRenderer.invoke(IPC.menuNewWindow),
    about: () => ipcRenderer.invoke(IPC.menuAbout),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke(IPC.shellOpenExternal, url),
  },
  power: {
    setKeepAwake: (on: boolean) => ipcRenderer.invoke(IPC.powerSetKeepAwake, on),
  },
  reader: {
    openDocument: (request: ReaderOpenRequest) =>
      ipcRenderer.invoke(IPC.readerOpenDocument, request),
    closeDocument: (handle: string) => ipcRenderer.invoke(IPC.readerCloseDocument, handle),
    fetchText: (signedUrl: string) => ipcRenderer.invoke(IPC.readerFetchText, signedUrl),
  },
  storage: {
    download: (documentId: string) => ipcRenderer.invoke(IPC.storageDownload, documentId),
    remove: (documentId: string) => ipcRenderer.invoke(IPC.storageRemove, documentId),
    status: (documentId: string) => ipcRenderer.invoke(IPC.storageStatus, documentId),
    list: () => ipcRenderer.invoke(IPC.storageList),
    usage: () => ipcRenderer.invoke(IPC.storageUsage),
    clearCache: () => ipcRenderer.invoke(IPC.storageClearCache),
    verify: (documentId: string) => ipcRenderer.invoke(IPC.storageVerify, documentId),
    reveal: () => ipcRenderer.invoke(IPC.storageReveal),
    onChange: (listener: (status: LocalDocumentStatus) => void) => {
      const handler = (_event: unknown, status: LocalDocumentStatus) => listener(status);
      ipcRenderer.on(IPC.storageChanged, handler);
      return () => ipcRenderer.removeListener(IPC.storageChanged, handler);
    },
  },
  platform: {
    os: process.platform,
  },
};

contextBridge.exposeInMainWorld('pidom', bridge);
