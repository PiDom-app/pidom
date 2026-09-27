import { useEffect, useRef, useState } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@convex/api';
import { useSession } from '../../../providers/session-provider';
import MagneticGrid from './magnetic-grid';
import { SignInPanel } from './sign-in-panel';

/**
 * The entire first-run experience: connect this desktop app to the reader's
 * existing account. The desktop is just another authenticated client of the
 * same Convex deployment — same account, same library metadata — so this screen
 * moves through sign-in → connecting → connected, and the PDFs themselves stay
 * local to each device.
 *
 * Left half carries the state; the right half is the dot-reveal panel. Under a
 * narrow window the right panel drops away and the left centres.
 */
export function ConnectionScreen() {
  const { status, profile, signIn } = useSession();
  const convex = useConvexAuth();
  const navigate = useNavigate();

  // Convex verifies the JWT; only then does the account have a profile row.
  const ensureProfile = useMutation(api.users.ensureProfile);
  const [profileReady, setProfileReady] = useState(false);
  const ensuredRef = useRef(false);

  useEffect(() => {
    if (!convex.isAuthenticated) {
      ensuredRef.current = false;
      setProfileReady(false);
      return;
    }
    if (ensuredRef.current) return;
    ensuredRef.current = true;
    void ensureProfile({})
      .then(() => setProfileReady(true))
      .catch(() => {
        ensuredRef.current = false;
        toast.error("Couldn't connect your library", {
          description: 'Please try signing in again.',
        });
      });
  }, [convex.isAuthenticated, ensureProfile]);

  // Metadata only — never PDF bytes. Skipped until the profile row exists.
  const usage = useQuery(api.library.usage, profileReady ? {} : 'skip');

  const handleSignIn = async () => {
    try {
      await signIn();
    } catch {
      toast.error("Sign-in didn't complete", { description: 'Please try again.' });
    }
  };

  const connected =
    convex.isAuthenticated && profileReady && usage !== undefined && profile !== null;

  // Once the account is connected and its profile row exists, the desktop moves
  // into the shell. The library and settings live there.
  useEffect(() => {
    if (connected) void navigate({ to: '/home' });
  }, [connected, navigate]);

  return (
    <div className="flex h-full">
      {/* Left half carries the auth state; both halves share the width evenly. */}
      <div className="flex-1">
        {status === 'signed-out' && <SignInPanel onSignIn={handleSignIn} />}
        {status === 'signed-in' && !connected && <ConnectingState />}
        {status === 'loading' && !connected && <ConnectingState label="Loading…" />}
      </div>

      {/* Right half: the full-height image panel. Drops away under a narrow window
          so the auth side takes the whole width. */}
      <div className="hidden flex-1 min-[880px]:block">
        <MagneticGrid />
      </div>
    </div>
  );
}

function ConnectingState({ label = 'Connecting your library…' }: { label?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-10">
      <Loader2 className="size-6 animate-spin text-fg-muted" />
      <p className="text-sm text-fg-muted">{label}</p>
    </div>
  );
}
