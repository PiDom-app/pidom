import { Popover, Tooltip } from 'radix-ui';
import {
  ArrowUpCircle,
  CircleCheck,
  Download,
  Loader,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react';
import { useDesktopSettings } from '@/features/settings/use-desktop-settings';
import type { UpdatePhase, UpdateState } from '../../../../shared/ipc';
import { checkedAgo, useUpdate } from '../data/use-update';

/**
 * The title-bar update indicator: a small button that appears only when there is
 * something to say — a version detected, a download in flight, a staged update,
 * or a failure — and opens a Popover with the version, plain-text release notes,
 * and the one action that applies to the current phase.
 *
 * It stays hidden while `idle`/`unsupported` (nothing to report) and while the
 * user has turned on "only show updates in Settings" (quiet mode). It never
 * surfaces a path or URL from feed data: main hands it version strings, notes
 * text, and a phase, and "What's new" opens a fixed github.com release page
 * through the shell's https guard.
 */
export function UpdateIndicator() {
  const { state, check, download, restart, openNotes } = useUpdate();
  const quiet = useDesktopSettings().quietUpdates;

  // Nothing to show: up to date, unsupported platform, or the user chose to keep
  // updates out of the title bar.
  if (quiet) return null;
  if (state.phase === 'idle' || state.phase === 'unsupported') return null;

  return (
    <Popover.Root>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Popover.Trigger
            className="no-app-drag relative flex size-7 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-hover data-[state=open]:text-foreground"
            aria-label={tooltipFor(state)}
          >
            <PhaseIcon phase={state.phase} />
            {state.phase === 'ready' && (
              <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
            )}
          </Popover.Trigger>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="z-50 rounded-md border border-border bg-popover px-2 py-1 text-2xs text-popover-foreground shadow-lg"
            sideOffset={4}
          >
            {tooltipFor(state)}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-80 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <PopoverBody
            state={state}
            onCheck={() => void check()}
            onDownload={() => void download()}
            onRestart={() => void restart()}
            onOpenNotes={() => void openNotes()}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The title-bar glyph for each visible phase — spinner while working, a primary
 *  arrow when a version waits, an ok check (with a dot badge) when staged, a warn
 *  triangle on failure. */
function PhaseIcon({ phase }: { phase: UpdatePhase }) {
  switch (phase) {
    case 'checking':
    case 'downloading':
      return <Loader className="size-4 animate-spin" />;
    case 'available':
      return <ArrowUpCircle className="size-4 text-primary" />;
    case 'ready':
      return <CircleCheck className="size-4 text-ok" />;
    case 'error':
      return <TriangleAlert className="size-4 text-warn" />;
    default:
      return null;
  }
}

function tooltipFor(state: UpdateState): string {
  switch (state.phase) {
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return state.availableVersion
        ? `Pidom ${state.availableVersion} is available`
        : 'An update is available';
    case 'downloading':
      return 'Downloading update…';
    case 'ready':
      return 'Update ready — restart to install';
    case 'error':
      return 'Update failed';
    default:
      return 'Updates';
  }
}

const actionPrimaryClass =
  'inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus';

const actionGhostClass =
  'inline-flex items-center justify-center gap-2 rounded-md border border-border bg-elevated px-3 py-1.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus';

const whatsNewClass =
  'ml-auto text-xs text-primary outline-none transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-focus rounded-sm';

/** The popover contents, switched on phase. Header + version line + notes/sub,
 *  then the single contextual action for that phase. */
function PopoverBody({
  state,
  onCheck,
  onDownload,
  onRestart,
  onOpenNotes,
}: {
  state: UpdateState;
  onCheck: () => void;
  onDownload: () => void;
  onRestart: () => void;
  onOpenNotes: () => void;
}) {
  const version = state.availableVersion;
  const ago = checkedAgo(state.lastCheckedAt);

  return (
    <>
      <Header phase={state.phase} />

      <div className="px-2 pb-1">
        {state.phase === 'available' && (
          <>
            <p className="text-sm text-foreground">
              {version ? (
                <>
                  <span className="font-semibold">Pidom {version}</span> is available
                </>
              ) : (
                'A new version is available'
              )}
            </p>
            <p className="mt-0.5 text-xs text-fg-muted">
              You’re on {state.currentVersion}
              {ago ? ` · found ${ago}` : ''}
            </p>
            {state.notes && (
              <p className="mt-2.5 max-h-24 overflow-hidden text-xs leading-relaxed whitespace-pre-line text-fg-muted">
                {state.notes}
              </p>
            )}
          </>
        )}

        {state.phase === 'checking' && (
          <>
            <p className="text-sm font-medium text-foreground">Checking for updates</p>
            <p className="mt-0.5 text-xs text-fg-muted">Looking for a newer version…</p>
          </>
        )}

        {state.phase === 'downloading' && (
          <>
            <p className="text-sm text-foreground">
              {version ? <span className="font-semibold">Pidom {version}</span> : 'Update'}
            </p>
            <p className="mt-0.5 text-xs text-fg-muted">Downloading and preparing to install</p>
            {/* Squirrel.Windows emits no byte progress — an honest indeterminate
                bar: a filled primary track with the app's barber-pole texture
                sliding over it (stopped under reduce-motion). No fake percentage. */}
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-primary">
              <div className="dl-stripe-texture animate-dl-stripes h-full w-full" />
            </div>
          </>
        )}

        {state.phase === 'ready' && (
          <>
            <p className="text-sm text-foreground">
              {version ? (
                <>
                  <span className="font-semibold">Pidom {version}</span> is ready to install
                </>
              ) : (
                'An update is ready to install'
              )}
            </p>
            <p className="mt-0.5 text-xs text-fg-muted">Pidom will restart to finish updating</p>
          </>
        )}

        {state.phase === 'error' && (
          <>
            <p className="text-sm text-foreground">Couldn’t reach the update service</p>
            <p className="mt-0.5 text-xs text-fg-muted">Check your connection and try again</p>
          </>
        )}
      </div>

      <Actions
        state={state}
        onCheck={onCheck}
        onDownload={onDownload}
        onRestart={onRestart}
        onOpenNotes={onOpenNotes}
      />
    </>
  );
}

/** The popover title row — icon + label, on a hairline. */
function Header({ phase }: { phase: UpdatePhase }) {
  const label =
    phase === 'checking'
      ? 'Checking for updates…'
      : phase === 'available'
        ? 'Update available'
        : phase === 'downloading'
          ? 'Downloading update…'
          : phase === 'ready'
            ? 'Update ready'
            : 'Update failed';

  return (
    <div className="mb-2 flex items-center gap-2 px-2 pt-2 pb-2.5 shadow-[inset_0_-1px_0_rgb(var(--hairline))]">
      <PhaseIcon phase={phase} />
      <p className="text-sm font-semibold text-foreground">{label}</p>
    </div>
  );
}

/** The single contextual action for the current phase, on a top hairline. */
function Actions({
  state,
  onCheck,
  onDownload,
  onRestart,
  onOpenNotes,
}: {
  state: UpdateState;
  onCheck: () => void;
  onDownload: () => void;
  onRestart: () => void;
  onOpenNotes: () => void;
}) {
  const hasNotes = Boolean(state.notesUrl);

  return (
    <div className="mt-2 flex items-center gap-2 px-2 pt-3 pb-1.5 shadow-[inset_0_1px_0_rgb(var(--hairline))]">
      {state.phase === 'available' && (
        <button className={actionPrimaryClass} onClick={onDownload}>
          <Download className="size-4" />
          Download update
        </button>
      )}
      {state.phase === 'ready' && (
        <button className={actionPrimaryClass} onClick={onRestart}>
          <RotateCcw className="size-4" />
          Restart to update
        </button>
      )}
      {state.phase === 'error' && (
        <button className={actionGhostClass} onClick={onCheck}>
          <RefreshCw className="size-4" />
          Try again
        </button>
      )}
      {state.phase === 'downloading' && (
        <span className="text-xs text-fg-muted">This can take a moment</span>
      )}
      {state.phase === 'checking' && (
        <span className="text-xs text-fg-muted">Checking the update service…</span>
      )}

      {hasNotes && (state.phase === 'available' || state.phase === 'ready') && (
        <button className={whatsNewClass} onClick={onOpenNotes}>
          What’s new
        </button>
      )}
    </div>
  );
}
