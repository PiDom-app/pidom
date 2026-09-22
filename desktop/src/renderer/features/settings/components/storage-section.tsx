import { useEffect, useState } from 'react';
import { AlertDialog } from 'radix-ui';
import { useQuery } from 'convex/react';
import { Check, Copy } from 'lucide-react';
import { api } from '@convex/api';
import { formatBytes } from '@/lib/format';
import { buttonGhostClass, buttonPrimaryClass, dividerBottom, surfaceClass } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { DownloadProgress } from '@/features/downloads/components/download-progress';
import {
  desktopSettings,
  useDesktopSettings,
  type DownloadAnimation,
} from '../use-desktop-settings';
import type { MigrationStatus, StorageUsage } from '../../../../shared/ipc';
import { SettingRow, SettingsSection } from './settings-ui';

/**
 * What the account holds in the cloud, and what this computer holds locally.
 *
 * The cloud counters come from the account's own totals (library.usage). The
 * local section reads from the main process (storage.usage) — real bytes on this
 * disk, with a usage meter, safe cache clearing, the managed library location
 * (with copy-path and a working move to another drive), and the download
 * animation the reader prefers.
 */
export function StorageSection() {
  const usage = useQuery(api.library.usage, {});

  return (
    <>
      <SettingsSection
        title="Library & storage"
        description="What your account holds across devices."
      >
        <SettingRow
          label="Documents in the cloud"
          description="Synced and available to download on any device."
        >
          <Stat value={usage ? String(usage.syncedCount) : '—'} />
        </SettingRow>
        <SettingRow label="Cloud storage used">
          <Stat value={usage ? formatBytes(usage.syncedBytes) : '—'} />
        </SettingRow>
        <SettingRow
          label="On one device only"
          description="Imported on a phone and not yet synced."
        >
          <Stat value={usage ? String(usage.localOnlyCount) : '—'} />
        </SettingRow>
      </SettingsSection>

      <OnThisDeviceSection />
      <DownloadAnimationSection />
    </>
  );
}

/** The local library on this computer: usage, cache clearing, and location. */
function OnThisDeviceSection() {
  const [local, setLocal] = useState<StorageUsage | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      void window.pidom.storage
        .usage()
        .then((u) => !cancelled && setLocal(u))
        .catch((error) => console.error('storage.usage failed', error));
    refresh();
    // A download finishing or a copy removed changes the totals; follow the same
    // push channel the Downloads screen does so the numbers stay live.
    const unsubscribe = window.pidom.storage.onChange(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const documentBytes = local?.documentBytes ?? 0;
  const cacheBytes = local?.cacheBytes ?? 0;
  const freeBytes = local?.freeBytes ?? null;
  const total = documentBytes + cacheBytes + (freeBytes ?? 0);
  const pct = (n: number) => (total > 0 ? `${Math.max(0, (n / total) * 100)}%` : '0%');

  return (
    <SettingsSection
      title="On this device"
      description="Documents saved locally for offline reading. Kept separate from regenerable caches."
    >
      <div className={cn('pt-1 pb-4', 'shadow-[inset_0_-1px_0_rgb(var(--hairline))]')}>
        <div className="my-3 flex h-2 overflow-hidden rounded-md bg-hairline">
          <span className="block h-full bg-primary" style={{ width: pct(documentBytes) }} />
          <span className="block h-full bg-warn" style={{ width: pct(cacheBytes) }} />
        </div>
        <div className="flex flex-wrap gap-5 text-xs text-fg-muted">
          <Legend swatch="bg-primary" label={`Documents · ${formatBytes(documentBytes)}`} />
          <Legend swatch="bg-warn" label={`Cache · ${formatBytes(cacheBytes)}`} />
          <Legend
            swatch="bg-hairline"
            label={`Free · ${freeBytes != null ? formatBytes(freeBytes) : '—'}`}
          />
        </div>
      </div>

      <SettingRow
        label="Documents on this computer"
        description="Open instantly, no connection needed."
      >
        <Stat value={local ? String(local.documentCount) : '—'} />
      </SettingRow>
      <SettingRow label="Document storage used">
        <Stat value={local ? formatBytes(local.documentBytes) : '—'} />
      </SettingRow>

      <ClearCacheRow
        cacheBytes={cacheBytes}
        documentCount={local?.documentCount ?? 0}
        onCleared={setLocal}
      />

      <SettingRow label="Free disk space">
        <Stat value={freeBytes != null ? formatBytes(freeBytes) : '—'} />
      </SettingRow>

      <SettingRow
        label="Library location"
        description={
          local?.isCustomLocation
            ? 'A folder you chose. Offline documents live here.'
            : 'Where offline documents live on this computer.'
        }
        align="start"
      >
        <div className="flex flex-col items-end gap-2">
          {local?.libraryPath && (
            <div className="flex items-center gap-1.5">
              <span
                className="max-w-72 truncate rounded-md bg-sunken px-2 py-1 font-mono text-xs text-fg-muted"
                title={local.libraryPath}
              >
                {local.libraryPath}
              </span>
              <CopyPathButton />
            </div>
          )}
          <button className={buttonGhostClass} onClick={() => void window.pidom.storage.reveal()}>
            Reveal
          </button>
        </div>
      </SettingRow>

      <MoveLibraryRow onMoved={setLocal} />
    </SettingsSection>
  );
}

/** Copies the active library path to the clipboard (main does the write), with a
 *  brief check-mark confirmation. */
function CopyPathButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await window.pidom.storage.copyPath();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      className={cn(buttonGhostClass, 'px-2 py-1.5')}
      onClick={() => void copy()}
      aria-label="Copy library path"
      title="Copy path"
    >
      {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
    </button>
  );
}

/** A short reader-facing reason for a rejected or failed move. */
const MIGRATION_REASON: Record<string, string> = {
  busy: 'a move is already running',
  'bad-path': 'that path is not valid',
  'missing-folder': 'that folder no longer exists',
  'not-a-directory': 'that is not a folder',
  'inside-app-data': 'pick a folder outside the app data directory',
  'inside-library': 'pick a folder outside an existing Pidom library',
  'same-location': 'the library is already there',
  'no-space': 'not enough free space on that drive',
  'verify-failed': 'a copied file did not match — nothing was changed',
  'signed-out': 'sign in first',
  'move-failed': 'the move could not complete',
};

/** The ordered phases shown as a checklist while a move runs. */
const MIGRATION_STEPS: { phase: MigrationStatus['phase']; label: string }[] = [
  { phase: 'validating', label: 'Check the folder is writable, with room to spare' },
  { phase: 'copying', label: 'Copy every document to the new folder' },
  { phase: 'verifying', label: 'Verify each copy against its hash' },
  { phase: 'switching', label: 'Switch to the new location' },
  { phase: 'cleaning', label: 'Remove the old copies' },
];
const PHASE_ORDER: MigrationStatus['phase'][] = [
  'idle',
  'validating',
  'copying',
  'verifying',
  'switching',
  'cleaning',
  'done',
];

/**
 * The "move the library to another drive" flow: pick a folder with the OS
 * dialog, confirm, then watch a live checklist as main validates, copies,
 * verifies, switches, and cleans up. Reading stays available throughout — the
 * active root only switches after every copy is verified.
 */
function MoveLibraryRow({ onMoved }: { onMoved: (usage: StorageUsage) => void }) {
  const [destination, setDestination] = useState<string | null>(null);
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = destination !== null;

  useEffect(() => {
    if (!open) return;
    // Progress arrives on the push channel; mirror it into the dialog checklist.
    const unsubscribe = window.pidom.storage.onMigration(setStatus);
    return unsubscribe;
  }, [open]);

  const choose = async () => {
    const chosen = await window.pidom.storage.chooseFolder();
    if (!chosen) return;
    setError(null);
    setStatus(null);
    setDestination(chosen);
  };

  const run = async () => {
    if (!destination) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.pidom.storage.moveLibrary(destination);
      if (result.ok) {
        onMoved(await window.pidom.storage.usage());
        setDestination(null);
      } else {
        setError(result.error ?? 'move-failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return; // never abandon a running move by dismissing the dialog
    setDestination(null);
    setStatus(null);
    setError(null);
  };

  const activeIndex = status ? PHASE_ORDER.indexOf(status.phase) : 0;
  const done = status?.phase === 'done';

  return (
    <SettingRow
      label="Choose a different folder"
      description="Move every downloaded document to another drive. Reading stays available throughout."
    >
      <button className={buttonGhostClass} onClick={() => void choose()}>
        Choose folder…
      </button>

      <AlertDialog.Root open={open} onOpenChange={(next) => !next && close()}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-overlay/60" />
          <AlertDialog.Content
            className={cn(
              surfaceClass,
              'fixed top-1/2 left-1/2 z-50 w-[30rem] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 p-5',
            )}
            onEscapeKeyDown={(e) => busy && e.preventDefault()}
          >
            <AlertDialog.Title className="text-lg font-semibold text-foreground">
              Move your library
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-fg-muted">
              Move every downloaded document to{' '}
              <span className="font-mono text-foreground">{destination}</span>. You can keep reading
              while this runs; the library only switches over once every copy is verified.
            </AlertDialog.Description>

            {(busy || status) && (
              <div className="mt-4">
                {MIGRATION_STEPS.map((step) => {
                  const stepIndex = PHASE_ORDER.indexOf(step.phase);
                  const state =
                    done || stepIndex < activeIndex
                      ? 'done'
                      : stepIndex === activeIndex
                        ? 'active'
                        : 'todo';
                  const counted =
                    step.phase === status?.phase &&
                    (step.phase === 'copying' || step.phase === 'verifying') &&
                    status.total > 0;
                  return (
                    <div key={step.phase} className="flex items-center gap-2.5 py-1.5 text-sm">
                      <StepDot state={state} />
                      <span className={state === 'todo' ? 'text-fg-muted' : 'text-foreground'}>
                        {step.label}
                      </span>
                      {counted && (
                        <span className="ml-auto text-xs tabular-nums text-fg-muted">
                          {status.done} / {status.total}
                        </span>
                      )}
                    </div>
                  );
                })}
                {busy && !done && (
                  <div className="mt-3">
                    <DownloadProgress
                      style="comet"
                      progress={status && status.total > 0 ? status.done / status.total : 0}
                    />
                  </div>
                )}
              </div>
            )}

            {error && (
              <p className="mt-3 text-sm text-destructive">
                Could not move the library — {MIGRATION_REASON[error] ?? 'the move failed'}. Your
                documents are untouched at the current location.
              </p>
            )}

            <div className="mt-5 flex justify-end gap-3">
              {!done && (
                <AlertDialog.Cancel asChild>
                  <button className={buttonGhostClass} disabled={busy}>
                    {error ? 'Close' : 'Cancel'}
                  </button>
                </AlertDialog.Cancel>
              )}
              {done ? (
                <button className={buttonPrimaryClass} onClick={close}>
                  Done
                </button>
              ) : (
                !error && (
                  <button className={buttonPrimaryClass} onClick={() => void run()} disabled={busy}>
                    {busy ? 'Moving…' : 'Move library'}
                  </button>
                )
              )}
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </SettingRow>
  );
}

/** The status dot beside a migration step. */
function StepDot({ state }: { state: 'done' | 'active' | 'todo' }) {
  if (state === 'done') {
    return (
      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-ok">
        <Check className="size-2.5 text-primary-foreground" />
      </span>
    );
  }
  if (state === 'active') {
    return <span className="size-4 shrink-0 rounded-full bg-primary" />;
  }
  return <span className="size-4 shrink-0 rounded-full bg-border-strong" />;
}

/** The four download animations, previewed live, so the reader picks by sight. */
const ANIMATIONS: { value: DownloadAnimation; name: string; hint: string }[] = [
  { value: 'bar', name: 'Bar', hint: 'Minimal · default' },
  { value: 'comet', name: 'Comet', hint: 'Light sweep' },
  { value: 'ring', name: 'Ring', hint: 'Circular' },
  { value: 'stripes', name: 'Stripes', hint: 'Barber-pole' },
];

function DownloadAnimationSection() {
  const { downloadAnimation, reduceMotion } = useDesktopSettings();

  return (
    <SettingsSection
      title="Download animation"
      description="How an in-progress download looks in the Downloads list. Point at a style to see it move. Respects Reduce motion."
    >
      {ANIMATIONS.map((anim) => {
        const active = downloadAnimation === anim.value;
        return (
          <button
            key={anim.value}
            onClick={() => desktopSettings.setDownloadAnimation(anim.value)}
            aria-pressed={active}
            className={cn(
              'group flex w-full items-center justify-between gap-6 py-4 text-left outline-none',
              dividerBottom,
              'focus-visible:bg-hover',
            )}
          >
            <span className="flex min-w-0 items-center gap-3">
              <RadioDot selected={active} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{anim.name}</span>
                <span className="block text-sm text-fg-muted">{anim.hint}</span>
              </span>
            </span>
            <span className={cn('shrink-0', anim.value === 'ring' ? '' : 'w-40')}>
              <DownloadProgress style={anim.value} progress={0.62} animated="hover" />
            </span>
          </button>
        );
      })}
      {reduceMotion && (
        <p className="mt-4 text-sm text-fg-muted">
          Reduce motion is on, so each style shows as a still determinate fill. Turn it off in
          Appearance to see the motion.
        </p>
      )}
    </SettingsSection>
  );
}

/** A radio-style selection dot: an outlined ring that fills when chosen. */
function RadioDot({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded-full border transition-colors',
        selected ? 'border-primary' : 'border-border-strong',
      )}
    >
      {selected && <span className="size-2 rounded-full bg-primary" />}
    </span>
  );
}

/** The regenerable-cache row and its confirm dialog. Clearing removes only the
 *  cache; downloaded documents are never touched, which the dialog states. */
function ClearCacheRow({
  cacheBytes,
  documentCount,
  onCleared,
}: {
  cacheBytes: number;
  documentCount: number;
  onCleared: (usage: StorageUsage) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      onCleared(await window.pidom.storage.clearCache());
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <SettingRow
      label="Regenerable cache"
      description="Rendered pages and search data. Safe to clear; documents stay."
    >
      <div className="flex items-center gap-3">
        <Stat value={formatBytes(cacheBytes)} />
        <AlertDialog.Root open={open} onOpenChange={setOpen}>
          <AlertDialog.Trigger asChild>
            <button className={buttonGhostClass} disabled={cacheBytes <= 0}>
              Clear cache
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
                Clear regenerable cache?
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-sm text-fg-muted">
                This removes {formatBytes(cacheBytes)} of rendered pages and search data. Your{' '}
                {documentCount} downloaded {documentCount === 1 ? 'document' : 'documents'} stay on
                this computer and reopen instantly. The cache rebuilds as you read.
              </AlertDialog.Description>
              <div className="mt-5 flex justify-end gap-3">
                <AlertDialog.Cancel asChild>
                  <button className={buttonGhostClass}>Cancel</button>
                </AlertDialog.Cancel>
                <button className={buttonPrimaryClass} onClick={() => void run()} disabled={busy}>
                  {busy ? 'Clearing…' : 'Clear cache'}
                </button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
    </SettingRow>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-2.5 rounded-md', swatch)} />
      {label}
    </span>
  );
}

function Stat({ value }: { value: string }) {
  return <span className="text-sm font-medium tabular-nums text-foreground">{value}</span>;
}
