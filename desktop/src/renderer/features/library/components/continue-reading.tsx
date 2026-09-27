import { BookOpen } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { DocumentCover } from './document-cover';
import { ProgressLine } from './progress-line';
import { DocumentActions } from './document-actions';
import { buttonPrimaryClass } from '@/lib/ui';
import { formatPage, formatProgress } from '@/lib/format';
import type { LibraryDocument } from '../data/types';

/**
 * The active reading context, given the widest treatment on the page: a large
 * cover beside the title, author, progress, and the primary Continue action.
 * This is the reader's place, not "recently opened" — it leads the workspace
 * because it is what they were doing. Continue opens the reader at the saved
 * position; the page and progress beside it say where that is.
 */
export function ContinueReading({ document }: { document: LibraryDocument }) {
  return (
    <section aria-labelledby="continue-heading">
      <h2 id="continue-heading" className="mb-3 text-sm font-semibold text-fg-muted">
        Continue reading
      </h2>
      <div className="flex gap-5">
        <div className="w-32 shrink-0 sm:w-40">
          <DocumentCover document={document} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-xl font-semibold text-foreground" title={document.title}>
              {document.title}
            </h3>
            <p className="mt-1 truncate text-sm text-fg-muted">
              {document.author ?? 'Unknown author'}
            </p>
          </div>

          <div className="max-w-md">
            <div className="mb-1.5 flex items-center justify-between text-xs text-fg-muted">
              <span>{formatPage(document.currentPage, document.pageCount)}</span>
              <span>{formatProgress(document.progress)}</span>
            </div>
            <ProgressLine progress={document.progress} />
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/reader/$documentId"
              params={{ documentId: document.id }}
              className={buttonPrimaryClass}
            >
              <BookOpen className="size-4" />
              Continue
            </Link>
            <DocumentActions document={document} />
          </div>
        </div>
      </div>
    </section>
  );
}
