import { Download } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';

/**
 * Downloads to this computer. Metadata and covers sync today; saving the PDF
 * bytes locally (and opening them in the reader) is the next piece of desktop
 * work, so this states that plainly rather than showing an empty list.
 */
export function DownloadsScreen() {
  return (
    <div className="mx-auto h-full max-w-6xl overflow-auto px-8 py-8">
      <PageHeader title="Downloads" subtitle="Documents saved on this computer." />
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="flex size-12 items-center justify-center rounded-md bg-sunken text-fg-subtle">
          <Download className="size-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-foreground">
          Downloads are coming to desktop
        </h2>
        <p className="mt-1 max-w-sm text-sm text-fg-muted">
          Your library and reading progress already sync here. Saving documents to this computer for
          offline reading lands in a later update.
        </p>
      </div>
    </div>
  );
}
