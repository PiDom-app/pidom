import { useState } from 'react';
import { ScrollArea } from 'radix-ui';
import { cn } from '@/lib/utils';
import { SelectSetting } from './settings-ui';
import { AppearanceSection } from './appearance-section';
import { AccentSection } from './accent-section';
import { ReaderSection } from './reader-section';
import { StorageSection } from './storage-section';
import { ImportSection } from './import-section';
import { AccountSection } from './account-section';
import { ProfileSection } from './profile-section';
import { ShortcutsSection } from './shortcuts-section';
import { PrivacySection } from './privacy-section';

type SectionId =
  | 'appearance'
  | 'accent'
  | 'reader'
  | 'storage'
  | 'import'
  | 'account'
  | 'profile'
  | 'shortcuts'
  | 'privacy';

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'accent', label: 'Accent color' },
  { id: 'reader', label: 'Reader' },
  { id: 'storage', label: 'Library & storage' },
  { id: 'import', label: 'Import' },
  { id: 'account', label: 'Account & sync' },
  { id: 'profile', label: 'Profile' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
  { id: 'privacy', label: 'Privacy & security' },
];

/**
 * Settings sits in the same shell but reads as a deliberate, centered workspace
 * rather than a full-bleed page: a comfortable max width, a section rail on the
 * left, and content on the right. On a narrow window the rail collapses into a
 * select.
 */
export function SettingsScreen() {
  const [active, setActive] = useState<SectionId>('appearance');

  return (
    <ScrollArea.Root type="scroll" className="h-full">
      <ScrollArea.Viewport className="h-full">
        <div className="mx-auto max-w-4xl px-8 py-10">
          <h1 className="mb-8 text-2xl font-semibold tracking-tight text-foreground">Settings</h1>

          <div className="mb-6 md:hidden">
            <SelectSetting<SectionId>
              label="Settings section"
              value={active}
              onValueChange={setActive}
              options={SECTIONS.map((s) => ({ value: s.id, label: s.label }))}
            />
          </div>

          <div className="flex gap-10">
            <nav className="hidden w-48 shrink-0 md:block">
              <div className="sticky top-0 flex flex-col gap-0.5">
                {SECTIONS.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => setActive(section.id)}
                    className={cn(
                      'rounded-md px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus',
                      active === section.id
                        ? 'bg-hover font-medium text-foreground'
                        : 'text-fg-muted hover:bg-hover hover:text-foreground',
                    )}
                  >
                    {section.label}
                  </button>
                ))}
              </div>
            </nav>

            <div className="min-w-0 flex-1">
              {active === 'appearance' && <AppearanceSection />}
              {active === 'accent' && <AccentSection />}
              {active === 'reader' && <ReaderSection />}
              {active === 'storage' && <StorageSection />}
              {active === 'import' && <ImportSection />}
              {active === 'account' && <AccountSection />}
              {active === 'profile' && <ProfileSection />}
              {active === 'shortcuts' && <ShortcutsSection />}
              {active === 'privacy' && <PrivacySection />}
            </div>
          </div>
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar
        orientation="vertical"
        className="flex w-2 touch-none p-0.5 select-none"
      >
        <ScrollArea.Thumb className="flex-1 rounded-full bg-border-strong" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}
