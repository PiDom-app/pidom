import { create } from 'zustand';

/**
 * How far behind the account this device is.
 *
 * Transient, like the transfer store beside it and for a related reason: the
 * durable facts are already in SQLite — the queue is a table, and what it holds
 * survives a force-quit. This is only the running commentary, and a phase
 * restored from disk would claim to be syncing when nothing was.
 *
 * The counts come from the queue rather than from anything this store
 * increments, so the number on the account screen is the number of rows waiting
 * and not a tally that can drift from them.
 */

export type SyncPhase =
  /** No connection, or no verified identity. Nothing is going anywhere. */
  | 'offline'
  /** Connected, with work waiting. Between a change and the next drain. */
  | 'pending'
  /** Sending, or reading the account back. */
  | 'syncing'
  /** Nothing waiting, and the last pass finished. */
  | 'synced'
  /** Something in the queue will not go without a person. */
  | 'error';

type SyncState = {
  phase: SyncPhase;
  /** Operations waiting to be sent. */
  pending: number;
  /** Operations that stopped trying and want a decision. */
  failed: number;
  /** When the reconcile last finished. `null` until it has. */
  lastSyncedAt: number | null;
  set: (patch: Partial<Omit<SyncState, 'set'>>) => void;
};

export const useSyncStore = create<SyncState>()((set) => ({
  phase: 'offline',
  pending: 0,
  failed: 0,
  lastSyncedAt: null,
  set: (patch) => set(patch),
}));

/** The phase alone, so a small indicator does not re-render on a count. */
export function useSyncPhase(): SyncPhase {
  return useSyncStore((state) => state.phase);
}
