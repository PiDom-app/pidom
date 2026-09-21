import { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { buttonGhostClass, buttonPrimaryClass, inputClass } from '@/lib/ui';

/**
 * Rename a document. A small modal rather than a card: Electron's renderer has
 * no working `window.prompt`, and a title is worth confirming before it is
 * written back to the shared account.
 */
export function RenameDialog({
  open,
  currentTitle,
  onOpenChange,
  onRename,
}: {
  open: boolean;
  currentTitle: string;
  onOpenChange: (open: boolean) => void;
  onRename: (title: string) => void;
}) {
  const [value, setValue] = useState(currentTitle);

  // Reset to the live title whenever the dialog opens for a document.
  useEffect(() => {
    if (open) setValue(currentTitle);
  }, [open, currentTitle]);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== currentTitle) onRename(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-50 bg-overlay/50" />
        <Dialog.Content
          className="animate-slide-up fixed top-1/2 left-1/2 z-50 w-[24rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-elevated p-5 shadow-lg outline-none"
          onOpenAutoFocus={(e) => {
            // Focus and select the field, not the first button.
            e.preventDefault();
          }}
        >
          <Dialog.Title className="text-sm font-semibold text-foreground">
            Rename document
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-fg-muted">
            The title syncs to every device on your account.
          </Dialog.Description>
          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              autoFocus
              className={inputClass}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label="Document title"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close className={buttonGhostClass} type="button">
                Cancel
              </Dialog.Close>
              <button className={buttonPrimaryClass} type="submit" disabled={!value.trim()}>
                Save
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
