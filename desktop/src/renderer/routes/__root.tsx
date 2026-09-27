import { useEffect } from 'react';
import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { TitleBar } from '../components/titlebar/title-bar';
import { ImportBatchToaster } from '../features/import/components/import-batch-toaster';
import { ImportProber } from '../features/import/components/import-prober';

/**
 * Root route. The app shell is deliberately flat: a custom title bar on top and
 * the route content flowing directly into the surface below it (see CLAUDE.md —
 * flat, cardless, content-first).
 *
 * The title bar is a transparent overlay rather than a stacked strip, so the
 * content beneath it — including the full-height image panel — bleeds to the very
 * top edge and reaches up to the title bar rather than starting below it. The bar
 * stays the topmost interactive layer so its drag region, menus, and window
 * controls remain live over whatever renders behind them.
 */
export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const navigate = useNavigate();

  // A file opened from the OS (double-click, "Open With", Open Recent) is staged
  // by main, which then pushes the freshly-minted document id here; jump straight
  // to the reader for it. Wired at the root so it works before sign-in too — a
  // staged local copy opens offline.
  useEffect(() => {
    return window.pidom.import.onOpenExternalDocument((documentId) => {
      void navigate({ to: '/reader/$documentId', params: { documentId } });
    });
  }, [navigate]);

  return (
    <div className="relative h-full">
      <main className="h-full overflow-auto">
        <Outlet />
      </main>
      <TitleBar />
      <ImportBatchToaster />
      <ImportProber />
    </div>
  );
}
