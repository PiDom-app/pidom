import { useEffect, useState } from 'react';
import { Menubar } from 'radix-ui';
import { useRouterState } from '@tanstack/react-router';
import { Minus, Square, Copy, X } from 'lucide-react';
import { PidomMark } from '../brand/pidom-mark';
import { TitlebarSearch } from './titlebar-search';
import { ImportQueue } from '../../features/import/components/import-queue';
import { useSession } from '../../providers/session-provider';
import { useTheme, type ThemeMode } from '../../providers/theme-provider';
import { useImports } from '../../features/import/data/use-imports';
import { cn } from '../../lib/utils';

const isDev = import.meta.env.DEV;
// Guarded: the preload defines `window.pidom` in the real renderer, but a
// preload failure should degrade rather than throw a blank window at load.
const isMac = window.pidom?.platform?.os === 'darwin';

/**
 * The custom, VS Code-style title bar. The whole strip is a drag region; menus
 * and window controls opt back out with `no-app-drag`. On macOS the native
 * traffic lights occupy the left inset (we pad for them); on Windows/Linux we
 * render our own minimize / maximize / close cluster on the right.
 *
 * In the reader it gets out of the way: the bar is hidden the moment a document
 * opens so the page owns the whole window, and slides back down when the pointer
 * reaches the top edge (or a menu is open) so window controls and the drag region
 * stay reachable. Everywhere else it is always present.
 */
export function TitleBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onReader = pathname.startsWith('/reader/');
  // Global search lives centred in the title bar on the workspace routes, where
  // the command palette is mounted. Not on the sign-in screen (`/`) or in the
  // reader, where the bar deliberately stays out of the way.
  const showSearch = !onReader && pathname !== '/';
  const [hovering, setHovering] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // On the reader the bar rests hidden and reveals on top-edge hover or an open
  // menu; anywhere else it is simply always shown.
  const revealed = !onReader || hovering || menuOpen;

  return (
    <>
      {/* A slim sensor at the very top edge, only in the reader, that brings the
          hidden bar back when the pointer arrives. */}
      {onReader && (
        <div className="absolute inset-x-0 top-0 z-40 h-2" onMouseEnter={() => setHovering(true)} />
      )}
      <header
        onMouseLeave={() => setHovering(false)}
        className={cn(
          'app-drag absolute inset-x-0 top-0 z-50 flex h-9 shrink-0 items-center pr-2 select-none transition-[transform,opacity] duration-200',
          onReader && 'bg-background/80 backdrop-blur-sm',
          revealed
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-full opacity-0',
        )}
      >
        {/* Left inset: brand, with room for the macOS traffic lights. */}
        <div className={cn('flex items-center gap-2', isMac ? 'pl-20' : 'pl-3')}>
          <PidomMark size={16} className="text-primary" />
          <span className="text-2xs font-semibold tracking-wide text-fg-muted uppercase">
            Pidom
          </span>
        </div>

        <AppMenubar onOpenChange={setMenuOpen} />

        <div className="flex min-w-0 flex-1 justify-center px-3">
          {showSearch && (
            <div className="w-full max-w-md">
              <TitlebarSearch />
            </div>
          )}
        </div>

        {showSearch && (
          <div className="flex items-center pr-1">
            <ImportQueue />
          </div>
        )}

        {!isMac && <WindowControls />}
      </header>
    </>
  );
}

const triggerClass =
  'no-app-drag cursor-default rounded-md px-2 py-1 text-sm text-fg-muted outline-none transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-hover data-[state=open]:text-foreground';

const contentClass =
  'animate-slide-down z-50 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg';

const itemClass =
  'flex cursor-default items-center justify-between gap-6 rounded-md px-2 py-1.5 text-sm text-foreground outline-none data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:text-fg-disabled';

function AppMenubar({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const { status, signOut } = useSession();
  const { mode, setMode } = useTheme();
  const { pickFiles, pickFolder } = useImports();
  const bridge = window.pidom;
  const signedIn = status === 'signed-in';

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ];

  return (
    <Menubar.Root
      className="app-drag flex items-center pl-2"
      onValueChange={(value) => onOpenChange?.(value !== '')}
    >
      <Menubar.Menu>
        <Menubar.Trigger className={triggerClass}>File</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content className={contentClass} align="start" sideOffset={4}>
            <Menubar.Item className={itemClass} onSelect={() => void bridge.menu.newWindow()}>
              New Window
              <Shortcut keys="Ctrl+Shift+N" />
            </Menubar.Item>
            <Menubar.Separator className="my-1 h-px bg-hairline" />
            <Menubar.Item className={itemClass} onSelect={() => void pickFiles()}>
              Import Files…
            </Menubar.Item>
            <Menubar.Item className={itemClass} onSelect={() => void pickFolder()}>
              Import Folder…
            </Menubar.Item>
            <Menubar.Separator className="my-1 h-px bg-hairline" />
            <Menubar.Item
              className={itemClass}
              disabled={!signedIn}
              onSelect={() => void signOut()}
            >
              Sign Out
            </Menubar.Item>
            <Menubar.Separator className="my-1 h-px bg-hairline" />
            {/* A single-window reader: closing the window quits on Win/Linux. */}
            <Menubar.Item className={itemClass} onSelect={() => void bridge.window.close()}>
              Quit
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      <Menubar.Menu>
        <Menubar.Trigger className={triggerClass}>Edit</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content className={contentClass} align="start" sideOffset={4}>
            <Menubar.Item
              className={itemClass}
              onSelect={() => void bridge.menu.editAction('undo')}
            >
              Undo
              <Shortcut keys="Ctrl+Z" />
            </Menubar.Item>
            <Menubar.Item
              className={itemClass}
              onSelect={() => void bridge.menu.editAction('redo')}
            >
              Redo
              <Shortcut keys="Ctrl+Y" />
            </Menubar.Item>
            <Menubar.Separator className="my-1 h-px bg-hairline" />
            <Menubar.Item className={itemClass} onSelect={() => void bridge.menu.editAction('cut')}>
              Cut
              <Shortcut keys="Ctrl+X" />
            </Menubar.Item>
            <Menubar.Item
              className={itemClass}
              onSelect={() => void bridge.menu.editAction('copy')}
            >
              Copy
              <Shortcut keys="Ctrl+C" />
            </Menubar.Item>
            <Menubar.Item
              className={itemClass}
              onSelect={() => void bridge.menu.editAction('paste')}
            >
              Paste
              <Shortcut keys="Ctrl+V" />
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      <Menubar.Menu>
        <Menubar.Trigger className={triggerClass}>View</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content className={contentClass} align="start" sideOffset={4}>
            {isDev && (
              <>
                <Menubar.Item className={itemClass} onSelect={() => void bridge.menu.reload()}>
                  Reload
                  <Shortcut keys="Ctrl+R" />
                </Menubar.Item>
                <Menubar.Separator className="my-1 h-px bg-hairline" />
              </>
            )}
            <Menubar.Sub>
              <Menubar.SubTrigger className={itemClass}>Theme</Menubar.SubTrigger>
              <Menubar.Portal>
                <Menubar.SubContent className={contentClass} sideOffset={2} alignOffset={-4}>
                  {themeOptions.map((option) => (
                    <Menubar.Item
                      key={option.value}
                      className={cn(itemClass, option.value === mode && 'text-primary')}
                      onSelect={() => setMode(option.value)}
                    >
                      {option.label}
                    </Menubar.Item>
                  ))}
                </Menubar.SubContent>
              </Menubar.Portal>
            </Menubar.Sub>
            <Menubar.Separator className="my-1 h-px bg-hairline" />
            <Menubar.Item className={itemClass} onSelect={() => void bridge.menu.zoom('in')}>
              Zoom In
              <Shortcut keys="Ctrl++" />
            </Menubar.Item>
            <Menubar.Item className={itemClass} onSelect={() => void bridge.menu.zoom('out')}>
              Zoom Out
              <Shortcut keys="Ctrl+-" />
            </Menubar.Item>
            <Menubar.Item className={itemClass} onSelect={() => void bridge.menu.zoom('reset')}>
              Reset Zoom
              <Shortcut keys="Ctrl+0" />
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      <Menubar.Menu>
        <Menubar.Trigger className={triggerClass}>Window</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content className={contentClass} align="start" sideOffset={4}>
            <Menubar.Item className={itemClass} onSelect={() => void bridge.window.minimize()}>
              Minimize
            </Menubar.Item>
            <Menubar.Item className={itemClass} onSelect={() => void bridge.window.close()}>
              Close
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      <Menubar.Menu>
        <Menubar.Trigger className={triggerClass}>Help</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content className={contentClass} align="start" sideOffset={4}>
            <Menubar.Item className={itemClass} onSelect={() => void bridge.menu.about()}>
              About Pidom
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>
    </Menubar.Root>
  );
}

function Shortcut({ keys }: { keys: string }) {
  return <span className="text-2xs tracking-wide text-fg-subtle">{keys}</span>;
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const bridge = window.pidom;

  useEffect(() => {
    void bridge.window.isMaximized().then(setMaximized);
    return bridge.window.onMaximizeChange(setMaximized);
  }, [bridge]);

  const buttonClass =
    'no-app-drag flex h-9 w-11 items-center justify-center text-fg-muted transition-colors hover:bg-hover hover:text-foreground';

  // The bar is a transparent overlay, so the controls can sit over the image
  // panel; a faint blurred backdrop keeps the glyphs legible over any artwork.
  return (
    <div className="flex items-stretch overflow-hidden rounded-md bg-background/50 backdrop-blur-sm">
      <button
        aria-label="Minimize"
        className={buttonClass}
        onClick={() => void bridge.window.minimize()}
      >
        <Minus className="size-4" />
      </button>
      <button
        aria-label={maximized ? 'Restore' : 'Maximize'}
        className={buttonClass}
        onClick={() => void bridge.window.toggleMaximize()}
      >
        {maximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}
      </button>
      <button
        aria-label="Close"
        className={cn(buttonClass, 'hover:bg-destructive hover:text-destructive-foreground')}
        onClick={() => void bridge.window.close()}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
