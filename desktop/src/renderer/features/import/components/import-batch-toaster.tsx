import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { ACTIVE, isTerminalState, useImports } from '../data/use-imports';
import type { ImportJobState } from '../../../../shared/ipc';

/**
 * A headless watcher that announces the outcome of a burst of imports once it
 * settles — "3 imported · 2 already in library · 1 not a PDF". Mounted exactly
 * once at the app root so the summary fires a single time, not once per
 * `useImports` consumer (tiles, the queue, and menus all read the same hook).
 *
 * It tallies each job's transition INTO a terminal state and flushes when the
 * active count falls back to zero. The first snapshot only seeds the tracker, so
 * imports finished in an earlier run are never re-counted.
 */
export function ImportBatchToaster() {
  const { jobs } = useImports();

  const prevStates = useRef<Map<string, ImportJobState>>(new Map());
  const seeded = useRef(false);
  const tally = useRef({ imported: 0, duplicate: 0, unsupported: 0, failed: 0 });
  const prevActive = useRef(0);

  useEffect(() => {
    const active = jobs.filter((j) => ACTIVE.has(j.state)).length;

    if (!seeded.current) {
      for (const job of jobs) prevStates.current.set(job.localId, job.state);
      seeded.current = true;
      prevActive.current = active;
      return;
    }

    for (const job of jobs) {
      const prev = prevStates.current.get(job.localId);
      const settledNow =
        prev !== job.state &&
        isTerminalState(job.state) &&
        (prev === undefined || !isTerminalState(prev));
      if (settledNow) {
        if (job.state === 'done') tally.current.imported += 1;
        else if (job.state === 'duplicate') tally.current.duplicate += 1;
        else if (job.error === 'not-a-pdf') tally.current.unsupported += 1;
        else tally.current.failed += 1;
      }
      prevStates.current.set(job.localId, job.state);
    }
    // Forget cancelled jobs so a later re-import with the same id counts afresh.
    const present = new Set(jobs.map((j) => j.localId));
    for (const id of [...prevStates.current.keys()]) {
      if (!present.has(id)) prevStates.current.delete(id);
    }

    if (prevActive.current > 0 && active === 0) {
      const t = tally.current;
      const parts: string[] = [];
      if (t.imported) parts.push(`${t.imported} imported`);
      if (t.duplicate) parts.push(`${t.duplicate} already in library`);
      if (t.unsupported) parts.push(`${t.unsupported} not a PDF`);
      if (t.failed) parts.push(`${t.failed} failed`);
      if (parts.length > 0) {
        const message = parts.join(' · ');
        if (t.failed || t.unsupported) toast.error(message);
        else toast.success(message);
      }
      tally.current = { imported: 0, duplicate: 0, unsupported: 0, failed: 0 };
    }
    prevActive.current = active;
  }, [jobs]);

  return null;
}
