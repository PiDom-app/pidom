import { app, dialog, Menu, type MenuItemConstructorOptions } from 'electron';
import type { UpdateState } from '../shared/ipc';

/**
 * Builds and installs a role-based application menu. Its job is narrow: give the
 * standard commands real accelerators (copy/paste/undo, quit, zoom, minimize,
 * close, and reload in dev) so keyboard shortcuts work. The *visible* menus are
 * the renderer's custom title-bar menubar; on Windows/Linux this native menu is
 * never drawn (the window is frameless), while on macOS it populates the system
 * menu bar as users expect there.
 */
export function buildAppMenu(opts: {
  isDev: boolean;
  createWindow: () => void;
  /** Kick off a detection check. Inert off unsupported packaged targets (the service stays
   *  `unsupported`); the renderer's Updates surface reflects the result. */
  checkForUpdates: () => void;
  getUpdateState: () => UpdateState;
  restartUpdate: () => void;
}): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => opts.createWindow(),
        },
        { type: 'separator' as const },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },
    {
      label: 'View',
      submenu: [
        // Reload stays a dev-only affordance, but DevTools is available in the
        // packaged app too so renderer issues (e.g. a blank window) can be
        // inspected. This also wires the F12 / Cmd+Opt+I accelerator.
        ...(opts.isDev ? [{ role: 'reload' as const }] : []),
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' as const }, { role: 'close' as const }],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: () => opts.checkForUpdates(),
        },
        { type: 'separator' as const },
        {
          label: 'About Pidom',
          click: async () => {
            const state = opts.getUpdateState();
            const updateText =
              state.phase === 'ready'
                ? `Update ${state.availableVersion ?? ''} is ready.`
                : state.phase === 'available'
                  ? `Update ${state.availableVersion ?? ''} is available.`
                  : state.phase === 'downloading'
                    ? `Downloading ${state.availableVersion ?? 'the latest update'}…`
                    : state.phase === 'error'
                      ? 'The latest update could not be installed.'
                      : state.phase === 'unsupported'
                        ? 'Automatic updates are unavailable for this build.'
                        : 'Pidom is up to date.';
            const buttons = state.phase === 'ready' ? ['Close', 'Restart to Update'] : ['Close', 'Check for Updates'];
            const result = await dialog.showMessageBox({
              type: 'info',
              title: 'About Pidom',
              message: 'Pidom for Desktop',
              detail: `Version ${app.getVersion()}\nThe desktop companion to your Pidom reading library.\n\nUpdates\n${updateText}`,
              buttons,
            });
            if (result.response !== 1) return;
            if (state.phase === 'ready') opts.restartUpdate();
            else opts.checkForUpdates();
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
