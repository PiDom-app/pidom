import { ArrowLeft, Loader2, TriangleAlert } from 'lucide-react';
import { buttonGhostClass } from '@/lib/ui';

/** The reader while the document is being fetched and opened. */
export function ReaderLoading() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background">
      <Loader2 className="size-6 animate-spin text-fg-muted" />
      <p className="text-sm text-fg-muted">Opening…</p>
    </div>
  );
}

/** The reader when the document could not be opened. */
export function ReaderError({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <TriangleAlert className="size-7 text-fg-muted" />
      <p className="max-w-sm text-sm text-fg-muted">{message}</p>
      <button className={buttonGhostClass} onClick={onBack}>
        <ArrowLeft className="size-4" />
        Back to library
      </button>
    </div>
  );
}
