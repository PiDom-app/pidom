import { useState } from 'react';
import { AlertDialog, Avatar } from 'radix-ui';
import { useConvexAuth } from 'convex/react';
import { Trash2 } from 'lucide-react';
import { useSession } from '@/providers/session-provider';
import { useAccountProfile } from '../use-account-profile';
import { SettingRow, SettingsSection } from './settings-ui';
import { buttonGhostClass, surfaceClass } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * The account this desktop is connected to, and the sync state. The desktop is
 * another authenticated client of the same Convex account as the phone — it
 * shows the connection rather than owning it. Sign-out removes cloud access; it
 * never touches files saved on this computer. Deleting the account is the one
 * destructive thing here, gated behind a typed confirmation.
 */
export function AccountSection() {
  const { profile: sessionProfile, signOut } = useSession();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { profile } = useAccountProfile();

  const connected = isAuthenticated && !isLoading;
  const stateLabel = isLoading ? 'Connecting…' : connected ? 'Connected' : 'Offline';
  const name = profile?.name ?? sessionProfile?.name ?? null;
  const email = profile?.email ?? sessionProfile?.email ?? null;
  const picture = sessionProfile?.picture ?? profile?.pictureUrl ?? null;
  const initial = (name ?? email ?? '?').trim().charAt(0).toUpperCase();

  const created =
    profile?.createdAt != null
      ? `Library created ${new Date(profile.createdAt).toLocaleDateString()}`
      : 'Signed in with Google';

  return (
    <SettingsSection title="Account & sync" description="The Pidom account shared with your phone.">
      <div className="flex items-center gap-3 py-4">
        <Avatar.Root className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sunken">
          {picture && <Avatar.Image src={picture} alt="" className="h-full w-full object-cover" />}
          <Avatar.Fallback className="text-lg font-medium text-fg-muted">{initial}</Avatar.Fallback>
        </Avatar.Root>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {name ?? 'Signed in with Google'}
          </p>
          {email && <p className="truncate text-sm text-fg-muted">{email}</p>}
          <p className="truncate text-xs text-fg-subtle">{created}</p>
        </div>
      </div>

      <SettingRow label="Connection" description="Your library syncs live while this is connected.">
        <span className="inline-flex items-center gap-2 text-sm text-fg-muted">
          <span
            className={cn(
              'size-1.5 rounded-full',
              isLoading ? 'bg-warn' : connected ? 'bg-ok' : 'bg-fg-disabled',
            )}
          />
          {stateLabel}
        </span>
      </SettingRow>

      <SettingRow
        label="Sign out"
        description="Removes access to your cloud library on this computer. It does not delete any local files."
      >
        <button className={buttonGhostClass} onClick={() => void signOut()}>
          Sign out
        </button>
      </SettingRow>

      <DeleteAccountRow />
    </SettingsSection>
  );
}

/**
 * The account deletion row and its typed confirmation. The mutation tombstones
 * the account immediately and cascades server-side; there is no undo, so the
 * button only enables once the reader types DELETE. On success the session signs
 * out, matching the phone.
 */
function DeleteAccountRow() {
  const { signOut } = useSession();
  const { deleteAccount } = useAccountProfile();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (confirm !== 'DELETE') return;
    setBusy(true);
    try {
      await deleteAccount({});
      await signOut();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <SettingRow
      label="Delete account"
      description="Every document, note, group and share. This cannot be undone."
      align="start"
    >
      <AlertDialog.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirm('');
        }}
      >
        <AlertDialog.Trigger asChild>
          <button
            className={cn(
              buttonGhostClass,
              'border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive',
            )}
          >
            <Trash2 className="size-4" />
            Delete my account
          </button>
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-overlay/60" />
          <AlertDialog.Content
            className={cn(
              surfaceClass,
              'fixed top-1/2 left-1/2 z-50 w-[26rem] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 p-5',
            )}
          >
            <AlertDialog.Title className="text-lg font-semibold text-foreground">
              Delete your account?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-fg-muted">
              This removes every document in your account, every note you have written, every group
              you own and every share in both directions. It starts immediately and there is no way
              back.
            </AlertDialog.Description>
            <label className="mt-4 block text-sm text-fg-muted">
              Type <span className="font-medium text-foreground">DELETE</span> to confirm.
              <input
                autoFocus
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-label="Type DELETE to confirm"
                className="mt-1.5 w-full rounded-md border border-input bg-elevated px-3 py-2 text-sm text-foreground outline-none focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-focus"
              />
            </label>
            <div className="mt-5 flex justify-end gap-3">
              <AlertDialog.Cancel asChild>
                <button className={buttonGhostClass}>Cancel</button>
              </AlertDialog.Cancel>
              <button
                onClick={() => void run()}
                disabled={confirm !== 'DELETE' || busy}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-destructive px-3.5 py-2 text-sm font-medium text-fg-inverted outline-none transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-50"
              >
                {busy ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </SettingRow>
  );
}
