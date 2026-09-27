import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ImportJobStatus } from '../../../../shared/ipc';

/**
 * The live view of desktop-initiated imports.
 *
 * Main owns the pipeline (validate → stage → register → upload → reconcile) and
 * the SQLite rows behind it; this hook mirrors that into React. It seeds once
 * from `import.list()`, then follows the coalesced `import.onChange` push so a
 * stage landing, an upload advancing, or a failure lands without re-querying.
 * The renderer only ever names a job by its `localId` — no path crosses this
 * seam. Every action is a thin bridge pass-through, wrapped so a rejection
 * surfaces as a toast instead of an unhandled promise.
 */

export interface Imports {
  /** Every import job on this computer, newest activity first is left to main. */
  jobs: ImportJobStatus[];
  /** True until the first `list()` resolves. */
  loading: boolean;
  /** Jobs still moving through the pipeline (staged … uploaded). */
  activeCount: number;
  /** Jobs that stopped with an error and can be retried. */
  failedCount: number;
  pickFiles: () => Promise<void>;
  pickFolder: () => Promise<void>;
  addDropped: (files: File[]) => Promise<void>;
  cancel: (localId: string) => Promise<void>;
  retry: (localId: string) => Promise<void>;
  retryAll: () => Promise<void>;
}

/** States that mean the job is on disk and still working toward the cloud. */
export const ACTIVE: ReadonlySet<ImportJobStatus['state']> = new Set([
  'staging',
  'staged',
  'registering',
  'registered',
  'uploading',
  'uploaded',
]);

/** A terminal state — the job has left the pipeline for good. Exported so the
 *  batch-summary watcher and the queue agree on what "settled" means. */
export function isTerminalState(state: ImportJobStatus['state']): boolean {
  return state === 'done' || state === 'duplicate' || state === 'failed';
}

/** A short, reader-facing sentence for a picked/dropped count. */
function queuedMessage(count: number): string {
  if (count === 0) return 'No PDFs to import.';
  if (count === 1) return 'Importing 1 document…';
  return `Importing ${count} documents…`;
}

export function useImports(): Imports {
  const [jobs, setJobs] = useState<ImportJobStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    window.pidom.import
      .list()
      .then((rows) => {
        if (cancelled) return;
        setJobs(rows);
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('import.list failed', error);
        setLoading(false);
      });

    // Each push is a full snapshot of every job, so replacing wholesale keeps
    // the view exactly in step with main and drops finished/cancelled rows.
    const unsubscribe = window.pidom.import.onChange((next) => {
      setJobs(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const pickFiles = useCallback(async () => {
    try {
      const count = await window.pidom.import.pickFiles();
      if (count > 0) toast.success(queuedMessage(count));
    } catch (error) {
      console.error('import.pickFiles failed', error);
      toast.error('Could not import those files.');
    }
  }, []);

  const pickFolder = useCallback(async () => {
    try {
      const count = await window.pidom.import.pickFolder();
      toast[count > 0 ? 'success' : 'message'](
        count > 0 ? queuedMessage(count) : 'No PDFs found in that folder.',
      );
    } catch (error) {
      console.error('import.pickFolder failed', error);
      toast.error('Could not import that folder.');
    }
  }, []);

  const addDropped = useCallback(async (files: File[]) => {
    try {
      const count = await window.pidom.import.addDropped(files);
      toast[count > 0 ? 'success' : 'message'](
        count > 0 ? queuedMessage(count) : 'Only PDF files can be imported.',
      );
    } catch (error) {
      console.error('import.addDropped failed', error);
      toast.error('Could not import those files.');
    }
  }, []);

  const cancel = useCallback(async (localId: string) => {
    try {
      await window.pidom.import.cancel(localId);
    } catch (error) {
      console.error('import.cancel failed', error);
      toast.error('Could not cancel that import.');
    }
  }, []);

  const retry = useCallback(async (localId: string) => {
    try {
      await window.pidom.import.retry(localId);
    } catch (error) {
      console.error('import.retry failed', error);
      toast.error('Could not retry that import.');
    }
  }, []);

  const retryAll = useCallback(async () => {
    try {
      const count = await window.pidom.import.retryAll();
      if (count > 0) toast.success(`Retrying ${count} ${count === 1 ? 'import' : 'imports'}…`);
    } catch (error) {
      console.error('import.retryAll failed', error);
      toast.error('Could not retry imports.');
    }
  }, []);

  const activeCount = jobs.filter((j) => ACTIVE.has(j.state)).length;
  const failedCount = jobs.filter((j) => j.state === 'failed').length;

  return {
    jobs,
    loading,
    activeCount,
    failedCount,
    pickFiles,
    pickFolder,
    addDropped,
    cancel,
    retry,
    retryAll,
  };
}
