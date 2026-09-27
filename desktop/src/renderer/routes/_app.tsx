import { useEffect, useRef } from 'react';
import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { AppShell } from '@/components/shell/app-shell';
import { useSession } from '@/providers/session-provider';

/**
 * The authenticated layout: every workspace route renders inside the shell. A
 * signed-out session is sent back to the connection screen; the ID token and its
 * verification stay in the main process and Convex, so this is a UX guard, not
 * the security boundary.
 */
export const Route = createFileRoute('/_app')({
  component: AppLayout,
});

function AppLayout() {
  const { status } = useSession();
  const navigate = useNavigate();
  // Once we've been signed in, a transient `loading` (e.g. a background token
  // refresh) must not unmount the shell — doing so would reset Downloads and
  // Library to their first-load state on every refresh.
  const hasBeenSignedIn = useRef(false);
  if (status === 'signed-in') hasBeenSignedIn.current = true;

  useEffect(() => {
    if (status === 'signed-out') void navigate({ to: '/' });
  }, [status, navigate]);

  if (status === 'signed-in' || (status === 'loading' && hasBeenSignedIn.current)) {
    return (
      <AppShell>
        <Outlet />
      </AppShell>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-fg-muted" />
    </div>
  );
}
