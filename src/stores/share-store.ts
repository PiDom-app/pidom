import { create } from 'zustand';

/**
 * What the share screen is holding while somebody makes their mind up.
 *
 * All of it is transient and none of it is worth a row: who has been picked,
 * what they are to be allowed, and the line being typed to them. It lives in a
 * store rather than in the screen's state because the permission is chosen in a
 * sheet and the recipients in a list, and threading a setter through both is
 * how a screen ends up owning three copies of the same fact.
 *
 * Cleared on send and on leaving. Nothing here survives the screen, and it
 * should not: an abandoned draft that reappears three days later beside a
 * different document is worse than no draft at all.
 */

export type Recipient =
  | { kind: 'person'; id: string; name: string; handle: string | null; pictureUrl: string | null }
  | { kind: 'group'; id: string; name: string; memberCount: number };

export type Permission = {
  role: 'viewer' | 'annotator';
  canDownload: boolean;
  canReshare: boolean;
  /**
   * How long the access lasts, in days, or `null` for no end.
   *
   * Days rather than a timestamp, because that is the shape of the decision —
   * somebody chooses "a week", not a moment — and a draft that carried an
   * absolute time would drift while the screen sat open. It becomes
   * `expiresAt` at the moment the share is written and nowhere earlier.
   *
   * `documentShares.expiresAt`, the cron that enforces it and the second check
   * in `Access.grants` have all existed since sharing shipped. Nothing ever
   * set the field: it was a whole feature with no way in.
   */
  expiresInDays: number | null;
};

type ShareStore = {
  /** The document being shared, so leaving and coming back to another one starts clean. */
  documentId: string | null;
  recipients: Recipient[];
  permission: Permission;
  sending: boolean;
  begin: (documentId: string, permission: Permission) => void;
  toggle: (recipient: Recipient) => void;
  setPermission: (permission: Permission) => void;
  setSending: (sending: boolean) => void;
  clear: () => void;
};

/**
 * The conservative default, and it is not this store's to choose.
 *
 * `begin` takes one, because the reader's own `defaultRole` /
 * `defaultCanDownload` settings decide it and those come from the account. This
 * is only what stands in before they have loaded — and it stands in as the
 * narrowest thing a share can be.
 */
const NARROWEST: Permission = {
  role: 'viewer',
  canDownload: false,
  canReshare: false,
  expiresInDays: null,
};

const EMPTY = {
  documentId: null,
  recipients: [] as Recipient[],
  permission: NARROWEST,
  sending: false,
};

export const useShareStore = create<ShareStore>()((set) => ({
  ...EMPTY,

  begin: (documentId, permission) =>
    set((state) =>
      // Coming back to the same document keeps the draft; a different one
      // starts over. Carrying four recipients across to another book is a way
      // to share the wrong thing with the right people.
      state.documentId === documentId ? state : { ...EMPTY, documentId, permission },
    ),

  toggle: (recipient) =>
    set((state) => {
      const already = state.recipients.some(
        (chosen) => chosen.kind === recipient.kind && chosen.id === recipient.id,
      );
      return {
        recipients: already
          ? state.recipients.filter(
              (chosen) => !(chosen.kind === recipient.kind && chosen.id === recipient.id),
            )
          : [...state.recipients, recipient],
      };
    }),

  setPermission: (permission) => set({ permission }),
  setSending: (sending) => set({ sending }),
  clear: () => set(EMPTY),
}));
