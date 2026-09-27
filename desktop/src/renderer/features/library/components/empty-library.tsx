import { FilePlus2, FolderPlus, Library } from 'lucide-react';
import { buttonGhostClass, buttonPrimaryClass } from '@/lib/ui';
import { useImports } from '@/features/import/data/use-imports';

/**
 * First-run state, after connecting an account that has nothing in it yet.
 * Explains where documents come from and offers the two ways to add one from
 * this device — a file picker or a folder scan — with a hint that dropping PDFs
 * onto the window works too. Documents added on the phone still arrive by sync.
 */
export function EmptyLibrary() {
  const { pickFiles, pickFolder } = useImports();

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex size-12 items-center justify-center rounded-md bg-sunken text-fg-subtle">
        <Library className="size-6" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-foreground">Your library is empty</h2>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">
        Import a PDF from this computer, or open one on your phone — anything in your account
        appears here as soon as it syncs.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <button className={buttonPrimaryClass} onClick={() => void pickFiles()}>
          <FilePlus2 className="size-4" />
          Import files
        </button>
        <button className={buttonGhostClass} onClick={() => void pickFolder()}>
          <FolderPlus className="size-4" />
          Import folder
        </button>
      </div>
      <p className="mt-3 text-xs text-fg-subtle">Or drop PDFs anywhere on this window.</p>
    </div>
  );
}
