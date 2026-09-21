import { useQuery } from 'convex/react';
import { api } from '@convex/api';
import { formatBytes } from '@/lib/format';
import { SettingRow, SettingsSection } from './settings-ui';

/**
 * What the account is storing. The numbers come from the account's own counters
 * (library.usage), not a scan. A local PDF folder and cache controls arrive with
 * desktop downloads — noted honestly rather than shown as inert switches.
 */
export function StorageSection() {
  const usage = useQuery(api.library.usage, {});

  return (
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
      <SettingRow label="On one device only" description="Imported on a phone and not yet synced.">
        <Stat value={usage ? String(usage.localOnlyCount) : '—'} />
      </SettingRow>
      <SettingRow
        label="Local downloads"
        description="Downloading documents to this computer arrives in a later update."
      >
        <span className="text-sm text-fg-subtle">Coming soon</span>
      </SettingRow>
    </SettingsSection>
  );
}

function Stat({ value }: { value: string }) {
  return <span className="text-sm font-medium tabular-nums text-foreground">{value}</span>;
}
