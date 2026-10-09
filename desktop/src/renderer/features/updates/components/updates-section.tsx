import {
  ArrowUpCircle,
  CircleCheck,
  Download,
  ExternalLink,
  Info,
  Loader,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react';
import { buttonGhostClass, buttonPrimaryClass } from '@/lib/ui';
import { cn } from '@/lib/utils';
import {
  desktopSettings,
  useDesktopSettings,
} from '@/features/settings/use-desktop-settings';
import {
  SettingRow,
  SettingsSection,
  ToggleSetting,
} from '@/features/settings/components/settings-ui';
import { checkedAgo, useUpdate } from '@/features/updates/data/use-update';
import type { UpdateState } from '../../../../shared/ipc';

/**
 * Settings ▸ Updates. The current version, a live status line with the one
 * action that applies to the current phase, and three per-device toggles that
 * round-trip to main (via `setPrefs` in use-desktop-settings) so it actually
 * drives `autoUpdater`. Flat and cardless — rows sit in the page on hairline
 * dividers, not in boxes.
 *
 * When the platform can't self-update (anything but a packaged Windows/macOS or
 * Linux AppImage build, which main reports as the `unsupported` phase) the live controls give way to a
 * plain muted note, so the surface stays honest without pretending to update.
 */
export function UpdatesSection() {
  const { state, check, download, restart, openNotes } = useUpdate();
  const settings = useDesktopSettings();

  const supported = state.phase !== 'unsupported';

  return (
    <SettingsSection
      title="Updates"
      description="Pidom keeps itself up to date from the official GitHub releases."
    >
      <SettingRow label="Current version" description="The build running on this computer." align="start">
        <span className="inline-block rounded-md bg-sunken px-2.5 py-1.5 font-mono text-xs text-fg-muted">
          {state.currentVersion ? `Pidom ${state.currentVersion}` : 'Pidom'}
        </span>
      </SettingRow>

      {supported ? (
        <>
          <SettingRow
            label="Status"
            description="Checked automatically on launch and periodically."
            align="start"
          >
            <StatusAction
              state={state}
              onCheck={() => void check()}
              onDownload={() => void download()}
              onRestart={() => void restart()}
            />
          </SettingRow>

          <StatusLine state={state} />

          <SettingRow
            label="Automatic updates"
            description="Check for new versions on launch and while Pidom runs."
          >
            <ToggleSetting
              label="Check for updates automatically"
              checked={settings.autoCheckUpdates}
              onCheckedChange={desktopSettings.setAutoCheckUpdates}
            />
          </SettingRow>

          <SettingRow
            label="Download updates automatically"
            description="Fetch and stage the update in the background when one is found."
          >
            <ToggleSetting
              label="Download updates automatically"
              checked={settings.autoDownloadUpdates}
              onCheckedChange={desktopSettings.setAutoDownloadUpdates}
            />
          </SettingRow>

          <SettingRow
            label="Only show updates in Settings"
            description="Hide the title-bar indicator and check here instead."
          >
            <ToggleSetting
              label="Only show updates in Settings"
              checked={settings.quietUpdates}
              onCheckedChange={desktopSettings.setQuietUpdates}
            />
          </SettingRow>

          {Boolean(state.notesUrl) && (
            <SettingRow
              label="What’s new"
              description="Read the release notes for the latest version."
            >
              <button
                className="inline-flex items-center gap-1.5 text-sm text-primary outline-none transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-focus rounded-sm"
                onClick={() => void openNotes()}
              >
                Open release notes
                <ExternalLink className="size-3.5" />
              </button>
            </SettingRow>
          )}
        </>
      ) : (
        <div className="mt-4 flex items-start gap-2.5 rounded-md border border-dashed border-border px-4 py-3.5 text-sm text-fg-muted">
          <Info className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
          <span>
            Automatic updates are available in packaged Windows, macOS, and Linux AppImage builds.
            On this platform, update Pidom by installing the latest release manually.
          </span>
        </div>
      )}
    </SettingsSection>
  );
}

/** The contextual action button for the current phase, sitting in the Status row. */
function StatusAction({
  state,
  onCheck,
  onDownload,
  onRestart,
}: {
  state: UpdateState;
  onCheck: () => void;
  onDownload: () => void;
  onRestart: () => void;
}) {
  const busy = state.phase === 'checking' || state.phase === 'downloading';

  if (state.phase === 'available') {
    return (
      <button className={buttonPrimaryClass} onClick={onDownload}>
        <Download className="size-4" />
        Download update
      </button>
    );
  }
  if (state.phase === 'ready') {
    return (
      <button className={buttonPrimaryClass} onClick={onRestart}>
        <RotateCcw className="size-4" />
        Restart to update
      </button>
    );
  }
  return (
    <button className={buttonGhostClass} onClick={onCheck} disabled={busy}>
      <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
      {state.phase === 'error' ? 'Try again' : 'Check now'}
    </button>
  );
}

/** A one-line, icon-led readout of what the updater knows, with the last-checked
 *  time. Sits directly under the Status row (no divider of its own). */
function StatusLine({ state }: { state: UpdateState }) {
  const ago = checkedAgo(state.lastCheckedAt);
  const version = state.availableVersion;

  const { icon, text, tone } = describe(state, version);

  return (
    <div className={cn('flex items-center gap-2 py-3 text-sm', tone)}>
      {icon}
      <span>
        {text}
        {ago ? <span className="text-fg-subtle"> · checked {ago}</span> : ''}
      </span>
    </div>
  );
}

function describe(
  state: UpdateState,
  version: string | null,
): { icon: React.ReactNode; text: string; tone: string } {
  switch (state.phase) {
    case 'checking':
      return {
        icon: <Loader className="size-4 animate-spin text-fg-muted" />,
        text: 'Checking for a new version…',
        tone: 'text-fg-muted',
      };
    case 'available':
      return {
        icon: <ArrowUpCircle className="size-4 text-primary" />,
        text: version ? `Pidom ${version} is available` : 'A new version is available',
        tone: 'text-fg-muted',
      };
    case 'downloading':
      return {
        icon: <Loader className="size-4 animate-spin text-fg-muted" />,
        text: version
          ? `Downloading Pidom ${version}${state.downloadProgress === null ? '…' : ` (${Math.round(state.downloadProgress)}%)…`}`
          : 'Downloading the update…',
        tone: 'text-fg-muted',
      };
    case 'ready':
      return {
        icon: <CircleCheck className="size-4 text-ok" />,
        text: version ? `Pidom ${version} is ready to install` : 'An update is ready to install',
        tone: 'text-fg-muted',
      };
    case 'error':
      return {
        icon: <TriangleAlert className="size-4 text-warn" />,
        text: updateErrorLabel(state.error),
        tone: 'text-fg-muted',
      };
    default:
      return {
        icon: <CircleCheck className="size-4 text-ok" />,
        text: 'Pidom is up to date',
        tone: 'text-fg-muted',
      };
  }
}

function updateErrorLabel(error: string | null): string {
  switch (error) {
    case 'feed-timeout':
      return 'The update service took too long to respond';
    case 'feed network error':
      return 'The update service is unreachable';
    case 'feed parse failed':
    case 'feed version missing':
      return 'The latest release data was invalid';
    case 'download-failed':
    case 'update-error':
      return 'Couldn’t download the update';
    default:
      return 'Couldn’t check for updates';
  }
}
