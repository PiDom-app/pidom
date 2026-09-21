import { useReaderPreferences } from '@/features/reader/data/use-reader-preferences';
import { SettingRow, SettingsSection, SelectSetting, ToggleSetting } from './settings-ui';

/**
 * How this account reads, everywhere.
 *
 * These preferences sync through Convex, not localStorage: a reader who sets
 * right-to-left or a dark page here wants it that way on their phone too. Per-
 * device state — the last zoom, the sidebar width — is not here; it stays on the
 * machine that set it (see `use-desktop-settings.ts`). The document background is
 * kept separate from the app's light/dark theme on purpose: a dark UI with a
 * white page is a common and reasonable pairing.
 */
export function ReaderSection() {
  const { prefs, update } = useReaderPreferences();

  return (
    <SettingsSection
      title="Reader"
      description="Defaults for reading. These follow your account across devices."
    >
      <SettingRow label="Page layout" description="How pages are arranged when a document opens.">
        <SelectSetting
          label="Page layout"
          value={prefs.defaultViewMode}
          onValueChange={(defaultViewMode) => update({ defaultViewMode })}
          options={[
            { value: 'continuous', label: 'Continuous' },
            { value: 'single', label: 'Single page' },
            { value: 'spread', label: 'Two-page spread' },
          ]}
        />
      </SettingRow>

      <SettingRow label="Page scaling" description="How a page is sized to the window.">
        <SelectSetting
          label="Page scaling"
          value={prefs.pageScaling}
          onValueChange={(pageScaling) => update({ pageScaling })}
          options={[
            { value: 'fit-width', label: 'Fit width' },
            { value: 'fit-page', label: 'Fit page' },
            { value: 'auto', label: 'Auto' },
            { value: 'last-used', label: 'Last used' },
          ]}
        />
      </SettingRow>

      <SettingRow label="Page spacing" description="The gap between pages in continuous mode.">
        <SelectSetting
          label="Page spacing"
          value={prefs.pageSpacing}
          onValueChange={(pageSpacing) => update({ pageSpacing })}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'normal', label: 'Normal' },
            { value: 'relaxed', label: 'Relaxed' },
          ]}
        />
      </SettingRow>

      <SettingRow
        label="Document background"
        description="The surface behind the page, separate from the app theme."
      >
        <SelectSetting
          label="Document background"
          value={prefs.documentBackground}
          onValueChange={(documentBackground) => update({ documentBackground })}
          options={[
            { value: 'neutral', label: 'Neutral' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </SettingRow>

      <SettingRow label="Reading direction" description="Which way pages advance.">
        <SelectSetting
          label="Reading direction"
          value={prefs.pageDirection}
          onValueChange={(pageDirection) => update({ pageDirection })}
          options={[
            { value: 'ltr', label: 'Left to right' },
            { value: 'rtl', label: 'Right to left' },
          ]}
        />
      </SettingRow>

      <SettingRow
        label="Toolbar"
        description="Whether the toolbar stays put or gets out of the way."
      >
        <SelectSetting
          label="Toolbar"
          value={prefs.toolbarBehavior}
          onValueChange={(toolbarBehavior) => update({ toolbarBehavior })}
          options={[
            { value: 'always', label: 'Always visible' },
            { value: 'auto-hide', label: 'Hide while reading' },
            { value: 'manual', label: 'Manual' },
          ]}
        />
      </SettingRow>

      <SettingRow label="Sidebar" description="Whether the navigator opens with a document.">
        <SelectSetting
          label="Sidebar"
          value={prefs.sidebarBehavior}
          onValueChange={(sidebarBehavior) => update({ sidebarBehavior })}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'collapsed', label: 'Collapsed' },
            { value: 'last-used', label: 'Last used' },
          ]}
        />
      </SettingRow>

      <SettingRow label="Page navigation" description="How a jump between pages moves.">
        <SelectSetting
          label="Page navigation"
          value={prefs.pageNavigation}
          onValueChange={(pageNavigation) => update({ pageNavigation })}
          options={[
            { value: 'continuous', label: 'Smooth' },
            { value: 'snap', label: 'Snap to page' },
          ]}
        />
      </SettingRow>

      <SettingRow label="Restore last position" description="Reopen a document where you left off.">
        <ToggleSetting
          label="Restore last position"
          checked={prefs.restorePosition}
          onCheckedChange={(restorePosition) => update({ restorePosition })}
        />
      </SettingRow>
    </SettingsSection>
  );
}
