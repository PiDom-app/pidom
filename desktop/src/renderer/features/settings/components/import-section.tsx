import { useEffect, useState } from 'react';
import { FilePlus2, FolderPlus } from 'lucide-react';
import { buttonGhostClass, buttonPrimaryClass } from '@/lib/ui';
import { useImports } from '@/features/import/data/use-imports';
import { SettingRow, SettingsSection, ToggleSetting } from './settings-ui';

const isWindows = window.pidom?.platform?.os === 'win32';

/**
 * Everything about bringing PDFs in from this computer: the two pickers (the
 * same actions as the Library header and drag-and-drop), a live readout of what
 * is still importing or has failed, and — on Windows — the "Open With" handler
 * toggle. Main owns every filesystem and registry step; this screen only calls
 * the bridge and shows counts.
 */
export function ImportSection() {
  const { pickFiles, pickFolder, retryAll, activeCount, failedCount } = useImports();

  return (
    <>
      <SettingsSection
        title="Import"
        description="Add PDFs stored on this computer. They stage locally, open right away, and upload to your library when you are online."
      >
        <SettingRow
          label="Add to your library"
          description="Pick individual files, or a folder to scan for PDFs."
        >
          <div className="flex items-center gap-2">
            <button className={buttonPrimaryClass} onClick={() => void pickFiles()}>
              <FilePlus2 className="size-4" />
              Import files
            </button>
            <button className={buttonGhostClass} onClick={() => void pickFolder()}>
              <FolderPlus className="size-4" />
              Import folder
            </button>
          </div>
        </SettingRow>

        <SettingRow
          label="Import activity"
          description={
            activeCount > 0
              ? `${activeCount} ${activeCount === 1 ? 'import' : 'imports'} in progress.`
              : failedCount > 0
                ? `${failedCount} ${failedCount === 1 ? 'import' : 'imports'} need attention.`
                : 'Nothing importing right now.'
          }
        >
          {failedCount > 0 ? (
            <button className={buttonGhostClass} onClick={() => void retryAll()}>
              Retry {failedCount === 1 ? 'import' : 'all'}
            </button>
          ) : (
            <span className="text-sm font-medium tabular-nums text-foreground">{activeCount}</span>
          )}
        </SettingRow>
      </SettingsSection>

      {isWindows && <AssociationSection />}
    </>
  );
}

/** The Windows "Open With → Pidom" handler. Registering only makes Pidom an
 *  available handler for `.pdf`; Windows never lets an app seize the default. */
function AssociationSection() {
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.pidom.import
      .getAssociation()
      .then((on) => !cancelled && setRegistered(on))
      .catch((error) => console.error('import.getAssociation failed', error));
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      setRegistered(await window.pidom.import.setAssociation(on));
    } catch (error) {
      console.error('import.setAssociation failed', error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title="File association"
      description="Let Windows offer Pidom when you right-click a PDF and choose Open With. This never changes your default PDF app — that stays your choice."
    >
      <SettingRow
        label="Show Pidom in “Open With” for PDFs"
        description="Also adds opened files to the Pidom jump-list under Recent."
      >
        <ToggleSetting
          label="Register the Pidom Open With handler"
          checked={registered === true}
          onCheckedChange={(on) => !busy && void toggle(on)}
        />
      </SettingRow>
    </SettingsSection>
  );
}
