import { useEffect, useState } from 'react';
import { AlertDialog } from 'radix-ui';
import { useQuery } from 'convex/react';
import { api } from '@convex/api';
import { formatBytes } from '@/lib/format';
import { buttonGhostClass, buttonPrimaryClass, surfaceClass } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { StorageUsage } from '../../../../shared/ipc';
import { SettingRow, SettingsSection } from './settings-ui';

/**
 * What the account holds in the cloud, and what this computer holds locally.
 *
 * The cloud counters come from the account's own totals (library.usage). The
 * local section reads from the main process (storage.usage) — real bytes on this
 * disk, with a usage meter, safe cache clearing, and the managed library
 * location. Moving that location to another drive is a later phase, stated
 * honestly rather than shown as an inert control.
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
    </>
  );
}

/** The local library on this computer: usage, cache clearing, and location. */
function OnThisDeviceSection() {
  const [local, setLocal] = useState<StorageUsage | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => void window.pidom.storage.usage().then((u) => !cancelled && setLocal(u));
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
        description="Where offline documents live on this computer."
        align="start"
      >
        <div className="flex flex-col items-end gap-2">
          {local?.libraryPath && (
            <span className="max-w-72 truncate rounded-md bg-sunken px-2 py-1 text-xs text-fg-muted">
              {local.libraryPath}
            </span>
          )}
          <button className={buttonGhostClass} onClick={() => void window.pidom.storage.reveal()}>
            Reveal
          </button>
        </div>
      </SettingRow>

      <SettingRow
        label="Choose a different folder"
        description="Moving the library to another drive arrives in a later update."
      >
        <span className="text-sm text-fg-subtle">Coming soon</span>
      </SettingRow>
    </SettingsSection>
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
