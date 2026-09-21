import { useEffect } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import type { Id } from '@convex/dataModel';
import { useSession } from '@/providers/session-provider';
import { ReaderScreen } from '@/features/reader/components/reader-screen';

/**
 * The reader is a full-screen route, deliberately outside `_app`'s bordered
 * panel: the document is the dominant surface, not a page inside the workspace
 * shell. It keeps the overlay title bar from the root route so window controls
 * stay reachable.
 *
 * Auth is a UX guard here, the same as `_app` — a signed-out session is sent to
 * the connection screen. The real boundary is server-side: the id token is
 * verified in the main process and by Convex, and every function the reader
 * calls resolves the owner from that token.
 */
export const Route = createFileRoute('/reader/$documentId')({
  component: ReaderRoute,
});

function ReaderRoute() {
  const { documentId } = Route.useParams();
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

  return <ReaderScreen documentId={documentId as Id<'documents'>} />;
}
