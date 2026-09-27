import type { ReactNode } from 'react';
import { NavRail } from './nav-rail';
import { CommandSearch } from '@/features/library/components/command-search';

/**
 * The bottom-grounded floating shell. The Electron window is the canvas: a solid
 * neutral background fills it, the nav rail sits directly on that background, and
 * the workspace is a single surface with a small top and side margin whose bottom
 * edge meets the window — so the app reads as growing upward from the desktop
 * rather than floating in a browser. Solid surface, one restrained border, 6px
 * top corners; no glass, blur, or heavy elevation.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full bg-background">
      <NavRail />
      <main className="min-w-0 flex-1 pt-10 pr-2.5">
        <div className="h-full overflow-hidden rounded-t-md border border-border bg-surface">
          {children}
        </div>
      </main>
      <CommandSearch />
    </div>
  );
}
