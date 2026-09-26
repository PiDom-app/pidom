import { Check } from 'lucide-react';
import { useTheme, type ThemeMode } from '@/providers/theme-provider';
import { useDesktopSettings, desktopSettings } from '../use-desktop-settings';
import { FONTS, SCALINGS, type Density, type FontChoice, type Scaling } from '@/design/appearance';
import { SettingRow, SettingsSection, SelectSetting, ToggleSetting } from './settings-ui';
import { cn } from '@/lib/utils';

/**
 * Fixed palette pairs for the mini previews, so each card shows its own theme
 * regardless of the current one. Values mirror design/global.css; `line`,
 * `text`, `tile`, and `edge` are contrast-picked so the mock reads clearly even
 * when a light preview sits on a light card. Hex on purpose — these are frozen
 * swatches of the two themes, not live tokens.
 */
const PALETTE = {
  light: {
    bg: '#ffffff',
    rail: '#f0efec',
    content: '#fafaf9',
    line: '#d6d3ce',
    text: '#b9b6b1',
    tile: '#eceae6',
    tileEdge: '#dedbd6',
    active: '#e6e4e0',
    edge: '#e2e0dc',
  },
  dark: {
    bg: '#000000',
    rail: '#0d0d0d',
    content: '#141414',
    line: '#2e2d2b',
    text: '#46443f',
    tile: '#1c1c1c',
    tileEdge: '#2a2927',
    active: '#1f1f1f',
    edge: '#2a2927',
  },
};

/**
 * A tiny Pidom window: nav rail with the accent brand dot and one active row,
 * a content header, and a document-tile grid. It reads as a screenshot of the
 * app in that theme rather than abstract bars, which is what the card is for.
 */
function MiniPreview({ scheme, framed = true }: { scheme: 'light' | 'dark'; framed?: boolean }) {
  const p = PALETTE[scheme];
  const tile = { backgroundColor: p.tile, boxShadow: `inset 0 0 0 1px ${p.tileEdge}` };
  return (
    <div
      className={cn('flex h-full w-full overflow-hidden', framed && 'rounded-md')}
      style={{ backgroundColor: p.bg, boxShadow: framed ? `inset 0 0 0 1px ${p.edge}` : undefined }}
    >
      <div className="flex w-2/5 flex-col gap-1.5 p-2" style={{ backgroundColor: p.rail }}>
        <div className="mb-0.5 flex items-center gap-1">
          <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          <span className="h-1 flex-1 rounded-full" style={{ backgroundColor: p.text }} />
        </div>
        <div className="h-2 rounded-md" style={{ backgroundColor: p.active }} />
        <div className="mx-0.5 h-1 rounded-full" style={{ backgroundColor: p.line }} />
        <div className="mx-0.5 h-1 rounded-full" style={{ backgroundColor: p.line }} />
        <div className="mx-0.5 h-1 w-4/5 rounded-full" style={{ backgroundColor: p.line }} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2" style={{ backgroundColor: p.content }}>
        <div className="h-1.5 w-1/2 rounded-full" style={{ backgroundColor: p.text }} />
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-1.5">
          <div className="rounded-sm" style={tile} />
          <div className="rounded-sm" style={tile} />
          <div className="rounded-sm" style={tile} />
          <div className="rounded-sm" style={tile} />
        </div>
      </div>
    </div>
  );
}

function ThemeCard({
  mode,
  label,
  selected,
  onSelect,
}: {
  mode: ThemeMode;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'group flex flex-col gap-2 rounded-md border p-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus',
        selected ? 'border-primary' : 'border-border hover:border-border-strong',
      )}
    >
      {/* The aspect-ratio lives on the preview itself, so its height is definite
          (from its own width) and the mock's `h-full` fills it. Putting the ratio
          on the button instead let the grid stretch the row to the mock's small
          intrinsic height — the previews looked shrunken, then vanished when the
          mock was taken out of flow. */}
      <div className="aspect-[4/3] w-full overflow-hidden rounded-md">
        {mode === 'system' ? (
          <div
            className="flex h-full w-full overflow-hidden rounded-md"
            style={{ boxShadow: `inset 0 0 0 1px ${PALETTE.dark.edge}` }}
          >
            <div className="w-1/2 overflow-hidden">
              <MiniPreview scheme="light" framed={false} />
            </div>
            <div className="w-1/2 overflow-hidden">
              <MiniPreview scheme="dark" framed={false} />
            </div>
          </div>
        ) : (
          <MiniPreview scheme={mode} />
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {selected && <Check className="size-4 text-primary" />}
      </div>
    </button>
  );
}

export function AppearanceSection() {
  const { mode, setMode } = useTheme();
  const settings = useDesktopSettings();

  return (
    <>
      <SettingsSection title="Appearance" description="How Pidom looks on this computer.">
        <div className="py-4 shadow-[inset_0_-1px_0_rgb(var(--hairline))]">
          <p className="text-sm font-medium text-foreground">Theme</p>
          <p className="mt-0.5 mb-4 text-sm text-fg-muted">Light, dark, or follow the system.</p>
          <div className="grid grid-cols-3 gap-3">
            <ThemeCard
              mode="light"
              label="Light"
              selected={mode === 'light'}
              onSelect={() => setMode('light')}
            />
            <ThemeCard
              mode="dark"
              label="Dark"
              selected={mode === 'dark'}
              onSelect={() => setMode('dark')}
            />
            <ThemeCard
              mode="system"
              label="System"
              selected={mode === 'system'}
              onSelect={() => setMode('system')}
            />
          </div>
        </div>

        <SettingRow label="Interface font" description="Applies across the app on this device.">
          <SelectSetting<FontChoice>
            label="Interface font"
            value={settings.font}
            onValueChange={desktopSettings.setFont}
            options={FONTS.map((f) => ({ value: f.name, label: f.label }))}
          />
        </SettingRow>

        <SettingRow
          label="Density"
          description="Comfortable spacing, or compact for larger libraries."
        >
          <SelectSetting<Density>
            label="Density"
            value={settings.density}
            onValueChange={desktopSettings.setDensity}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
        </SettingRow>

        <SettingRow label="Interface scaling" description="Scale the whole interface up or down.">
          <SelectSetting<string>
            label="Interface scaling"
            value={String(settings.scaling)}
            onValueChange={(v) => desktopSettings.setScaling(Number(v) as Scaling)}
            options={SCALINGS.map((s) => ({ value: String(s), label: `${s}%` }))}
          />
        </SettingRow>

        <SettingRow
          label="Reduce motion"
          description="Turn off the app's entrance and transition animations."
        >
          <ToggleSetting
            label="Reduce motion"
            checked={settings.reduceMotion}
            onCheckedChange={desktopSettings.setReduceMotion}
          />
        </SettingRow>
      </SettingsSection>
    </>
  );
}
