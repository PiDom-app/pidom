import { useCallback, useEffect, useState } from 'react';
import type { LocalDocumentStatus } from '../../../../shared/ipc';

/**
 * The live view of what this computer holds locally.
 *
 * Main owns the truth (SQLite + the files on disk); this hook mirrors it into
 * React. It seeds once from `storage.list()`, then follows the `storage.onChange`
 * push channel so a download advancing, a file removed, or a verify result lands
 * without re-querying. The renderer only ever names a document by its id — no
 * path crosses this seam. Actions are thin pass-throughs to the bridge.
 */

export interface Downloads {
  /** documentId → its current local status. Absent means no local record. */
  statuses: Map<string, LocalDocumentStatus>;
  /** True until the first `list()` resolves, so the screen can hold its layout. */
  loading: boolean;
  download: (documentId: string) => Promise<void>;
  remove: (documentId: string) => Promise<void>;
  verify: (documentId: string) => Promise<void>;
}

export function useDownloads(): Downloads {
  const [statuses, setStatuses] = useState<Map<string, LocalDocumentStatus>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    window.pidom.storage
      .list()
      .then((rows) => {
        if (cancelled) return;
        setStatuses(new Map(rows.map((row) => [row.documentId, row])));
        setLoading(false);
      })
      .catch((error) => {
        // A rejected seed must never leave the screen stuck on its shimmer.
        // Clear loading and surface the reason rather than hanging.
        if (cancelled) return;
        console.error('storage.list failed', error);
        setLoading(false);
      });

    // Each push is one document's new status. A `none` state (its record was
    // removed) drops the entry rather than lingering as a stale row.
    const unsubscribe = window.pidom.storage.onChange((status) => {
      setStatuses((prev) => {
        const next = new Map(prev);
        if (status.state === 'none') next.delete(status.documentId);
        else next.set(status.documentId, status);
        return next;
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const download = useCallback(async (documentId: string) => {
    await window.pidom.storage.download(documentId);
  }, []);
  const remove = useCallback(async (documentId: string) => {
    await window.pidom.storage.remove(documentId);
  }, []);
  const verify = useCallback(async (documentId: string) => {
    await window.pidom.storage.verify(documentId);
  }, []);

  return { statuses, loading, download, remove, verify };
}
