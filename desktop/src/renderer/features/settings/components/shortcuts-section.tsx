import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useDesktopSettings, desktopSettings } from '../use-desktop-settings';
import { SHORTCUTS, chordFromEvent, formatChord, type ShortcutId } from '../shortcuts';
import { SettingsSection } from './settings-ui';
import { cn } from '@/lib/utils';

/**
 * The keyboard commands the desktop app answers. Click a shortcut to rebind it:
 * the button captures the next chord and stores it. Bindings persist on this
 * device (see use-desktop-settings). Wiring a custom chord into the main-process
 * menu accelerators is a later addition; this pass owns the in-app palette.
 */
export function ShortcutsSection() {
  const { shortcuts } = useDesktopSettings();
  const isMac = window.pidom?.platform?.os === 'darwin';
  const [capturing, setCapturing] = useState<ShortcutId | null>(null);

  return (
    <SettingsSection
      title="Keyboard shortcuts"
      description="Move without reaching for the mouse. Click a shortcut to rebind it."
    >
      <ul>
        {SHORTCUTS.map((shortcut) => (
          <li
            key={shortcut.id}
            className="flex items-center justify-between gap-6 py-3 shadow-[inset_0_-1px_0_rgb(var(--hairline))]"
          >
            <span className="text-sm text-foreground">{shortcut.command}</span>
            <ChordButton
              chord={shortcuts[shortcut.id]}
              isMac={isMac}
              capturing={capturing === shortcut.id}
              onStart={() => setCapturing(shortcut.id)}
              onCapture={(chord) => {
                desktopSettings.setShortcut(shortcut.id, chord);
                setCapturing(null);
              }}
              onCancel={() => setCapturing(null)}
            />
          </li>
        ))}
      </ul>

      <button
        onClick={() => desktopSettings.resetShortcuts()}
        className="mt-5 inline-flex items-center gap-1.5 text-sm text-link hover:text-link-hover"
      >
        <RotateCcw className="size-4" />
        Reset all to defaults
      </button>
    </SettingsSection>
  );
}

/**
 * A rebindable chord. Idle it shows the current binding; clicked it captures the
 * next key combination. Escape cancels; a lone modifier keeps it waiting.
 */
function ChordButton({
  chord,
  isMac,
  capturing,
  onStart,
  onCapture,
  onCancel,
}: {
  chord: string;
  isMac: boolean;
  capturing: boolean;
  onStart: () => void;
  onCapture: (chord: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!capturing) return;
    ref.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      const next = chordFromEvent(e);
      if (next) onCapture(next);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing, onCapture, onCancel]);

  return (
    <button
      ref={ref}
      onClick={onStart}
      onBlur={() => capturing && onCancel()}
      aria-label={
        capturing ? 'Press a key combination' : `Rebind (currently ${formatChord(chord, isMac)})`
      }
      className={cn(
        'rounded-md border px-2 py-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus',
        capturing
          ? 'border-focus text-primary'
          : 'border-border bg-sunken text-fg-muted hover:border-border-strong hover:text-foreground',
      )}
    >
      {capturing ? 'Press keys…' : formatChord(chord, isMac)}
    </button>
  );
}
