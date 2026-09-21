import { useEffect } from 'react';
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

  useEffect(() => {
    if (status === 'signed-out') void navigate({ to: '/' });
  }, [status, navigate]);

  if (status !== 'signed-in') {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-fg-muted" />
      </div>
    );
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
