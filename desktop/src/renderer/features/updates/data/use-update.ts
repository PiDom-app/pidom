import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { UpdateState } from '../../../../shared/ipc';

/**
 * The live view of the desktop auto-updater.
 *
 * Main owns the whole loop — detection, download, and staging —
 * update — and this hook mirrors its state into React. It seeds once from
 * `update.getState()`, then follows the coalesced `update.onChange` push so a
 * probe finishing, a download advancing, or a failure lands without re-querying.
 * Every action is a thin bridge pass-through, wrapped so a rejection surfaces as
 * a toast rather than an unhandled promise. Main is authoritative: it is inert
 * off packaged-Windows (`phase` stays `unsupported`) and re-validates every call.
 */

export interface Update {
  state: UpdateState;
  /** Run a detection probe (no download). */
  check: () => Promise<void>;
  /** Download + stage the detected update. */
  download: () => Promise<void>;
  /** Quit and apply a staged update. */
  restart: () => Promise<void>;
  /** Open the release page in the system browser. */
  openNotes: () => Promise<void>;
}

/** The state before the first `getState()` resolves — up to date, nothing known. */
const INITIAL: UpdateState = {
  phase: 'idle',
  currentVersion: '',
  availableVersion: null,
  notes: null,
  notesUrl: null,
  lastCheckedAt: null,
  downloadProgress: null,
  error: null,
};

export function useUpdate(): Update {
  const [state, setState] = useState<UpdateState>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    window.pidom.update
      .getState()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((error) => {
        if (!cancelled) console.error('update.getState failed', error);
      });

    // Each push is a full snapshot, so replacing wholesale keeps the view exactly
    // in step with main across every phase transition.
    const unsubscribe = window.pidom.update.onChange((next) => {
      setState(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const check = useCallback(async () => {
    try {
      await window.pidom.update.check();
    } catch (error) {
      console.error('update.check failed', error);
      toast.error('Could not check for updates.');
    }
  }, []);

  const download = useCallback(async () => {
    try {
      await window.pidom.update.download();
    } catch (error) {
      console.error('update.download failed', error);
      toast.error('Could not download the update.');
    }
  }, []);

  const restart = useCallback(async () => {
    try {
      await window.pidom.update.restart();
    } catch (error) {
      console.error('update.restart failed', error);
      toast.error('Could not restart to update.');
    }
  }, []);

  const openNotes = useCallback(async () => {
    try {
      await window.pidom.update.openNotes();
    } catch (error) {
      console.error('update.openNotes failed', error);
    }
  }, []);

  return { state, check, download, restart, openNotes };
}

/** A short, reader-facing "how long ago" for the last-checked timestamp. Null
 *  input (never checked) reads as null so callers can omit the clause. */
export function checkedAgo(at: number | null): string | null {
  if (at === null) return null;
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
