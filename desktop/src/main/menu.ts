import { app, dialog, Menu, type MenuItemConstructorOptions } from 'electron';

/**
 * Builds and installs a role-based application menu. Its job is narrow: give the
 * standard commands real accelerators (copy/paste/undo, quit, zoom, minimize,
 * close, and reload in dev) so keyboard shortcuts work. The *visible* menus are
 * the renderer's custom title-bar menubar; on Windows/Linux this native menu is
 * never drawn (the window is frameless), while on macOS it populates the system
 * menu bar as users expect there.
 */
export function buildAppMenu(opts: { isDev: boolean; createWindow: () => void }): void {
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
        ...(opts.isDev
          ? [
              { role: 'reload' as const },
              { role: 'toggleDevTools' as const },
              { type: 'separator' as const },
            ]
          : []),
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
          label: 'About Pidom',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'About Pidom',
              message: 'Pidom for Desktop',
              detail: `Version ${app.getVersion()}\nThe desktop companion to your Pidom reading library.`,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
