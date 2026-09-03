import { create } from 'zustand';

/**
 * What is moving right now.
 *
 * Transient by design, and deliberately not in Convex: a progress field on the
 * document row would be a write every few hundred milliseconds, replicated to
 * every device the reader owns, re-rendering rails on all of them to animate a
 * bar on one. It is also not persisted — a transfer does not survive the
 * process that was running it.
 */

export type TransferKind = 'upload' | 'download';

export type Transfer = {
  kind: TransferKind;
  sent: number;
  total: number;
};

type TransferState = {
  active: ReadonlyMap<string, Transfer>;
  start: (documentId: string, kind: TransferKind) => void;
  progress: (documentId: string, sent: number, total: number) => void;
  finish: (documentId: string) => void;
};

export const useTransferStore = create<TransferState>()((set) => ({
  active: new Map(),

  start: (documentId, kind) =>
    set((state) => {
      const next = new Map(state.active);
      next.set(documentId, { kind, sent: 0, total: 0 });
      return { active: next };
    }),

  progress: (documentId, sent, total) =>
    set((state) => {
      const current = state.active.get(documentId);
      if (current === undefined) {
        return state;
      }
      const next = new Map(state.active);
      next.set(documentId, { ...current, sent, total });
      return { active: next };
    }),

  finish: (documentId) =>
    set((state) => {
      if (!state.active.has(documentId)) {
        return state;
      }
      const next = new Map(state.active);
      next.delete(documentId);
      return { active: next };
    }),
}));

/** The reactive read. Selecting one entry keeps a tile off every other tile's re-render. */
export function useTransfer(documentId: string): Transfer | null {
  return useTransferStore((state) => state.active.get(documentId) ?? null);
}
