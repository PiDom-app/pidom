import { Check } from 'lucide-react';
import { useTheme } from '@/providers/theme-provider';
import { useDesktopSettings, desktopSettings } from '../use-desktop-settings';
import { ACCENTS } from '@/design/appearance';
import { cn } from '@/lib/utils';

/**
 * The accent chooser. Desktop-only: the mobile app keeps the fixed purple, and
 * this preference stays on this computer. Selecting a swatch rewrites the
 * `--primary` token immediately, so the whole app updates live — the swatches
 * themselves are the preview.
 */
export function AccentSection() {
  const { mode } = useTheme();
  const settings = useDesktopSettings();
  const resolved =
    mode === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : mode;

  return (
    <section className="mb-12">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-foreground">Accent color</h2>
        <p className="mt-1 text-sm text-fg-muted">
          The color used for primary buttons, links, selection, and focus. Applies to this computer
          only.
        </p>
      </div>

      <div className="flex flex-wrap gap-2.5">
        {ACCENTS.map((accent) => {
          const selected = settings.accent === accent.name;
          return (
            <button
              key={accent.name}
              onClick={() => desktopSettings.setAccent(accent.name)}
              aria-label={accent.label}
              aria-pressed={selected}
              title={accent.label}
              className={cn(
                'flex size-9 items-center justify-center rounded-full outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-focus',
                selected && 'ring-2 ring-focus',
              )}
              style={{ backgroundColor: `rgb(${accent.swatch[resolved]})` }}
            >
              {selected && <Check className="size-4 text-white" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
