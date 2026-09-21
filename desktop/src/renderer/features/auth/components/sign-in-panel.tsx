import { Separator, Tooltip } from 'radix-ui';
import { Lock } from 'lucide-react';
import { PidomMark } from '../../../components/brand/pidom-mark';
import { GoogleSignInButton } from './google-sign-in-button';

function openExternal(url: string) {
  void window.pidom.shell.openExternal(url);
}

/**
 * The left half of the first-run surface. One job: connect this desktop app to
 * the reader's existing account. No registration, no workspace, no password —
 * the same Google account they already use on mobile, and nothing else.
 */
export function SignInPanel({ onSignIn }: { onSignIn: () => void | Promise<void> }) {
  return (
    <div className="flex h-full flex-col justify-between px-10 pt-14 pb-10">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <PidomMark size={40} className="text-primary" />
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-foreground">
          Connect your reading library
        </h1>
        <p className="mt-3 max-w-sm text-fg-muted">
          Sign in with the same Google account you use on mobile to connect this desktop app.
        </p>

        <div className="mt-8 w-full max-w-sm">
          <GoogleSignInButton onPress={onSignIn} />

          <div className="mt-4 flex items-center justify-center gap-2 text-fg-subtle">
            <Lock className="size-3.5" />
            <Tooltip.Provider delayDuration={200}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <span className="text-2xs cursor-default underline decoration-dotted underline-offset-2">
                    Your files stay on each device.
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    sideOffset={6}
                    className="animate-slide-down z-50 max-w-xs rounded-md border border-border bg-popover px-3 py-2 text-2xs text-popover-foreground shadow-lg"
                  >
                    Pidom uses your account only to sync your library and reading state. The PDFs
                    themselves stay stored locally on each device.
                    <Tooltip.Arrow className="fill-popover" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-sm text-center">
        <Separator.Root className="mb-4 h-px bg-hairline" />
        <p className="text-2xs text-fg-subtle">
          By signing in, you agree to our{' '}
          <button
            type="button"
            onClick={() => openExternal('https://pidom.app/terms')}
            className="text-link underline"
          >
            Terms of Service
          </button>{' '}
          and{' '}
          <button
            type="button"
            onClick={() => openExternal('https://pidom.app/privacy')}
            className="text-link underline"
          >
            Privacy Policy
          </button>
          .
        </p>
      </div>
    </div>
  );
}
