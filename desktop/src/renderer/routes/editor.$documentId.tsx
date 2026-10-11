import { useEffect } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import type { Id } from '@convex/dataModel';
import { useSession } from '@/providers/session-provider';
import { DocumentEditor } from '@/features/editor/document-editor';

export const Route = createFileRoute('/editor/$documentId')({
  component: EditorRoute,
});

function EditorRoute() {
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

  return <DocumentEditor documentId={documentId as Id<'documents'>} />;
}
