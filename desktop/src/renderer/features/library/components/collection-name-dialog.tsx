import { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { buttonGhostClass, buttonPrimaryClass, inputClass } from '@/lib/ui';

/** Mirrors the server's `COLLECTION_NAME_MAX`; the server is still the authority. */
const NAME_MAX = 80;

/**
 * Name a collection — create a new one or rename an existing one. A small modal
 * rather than a card, the same shape as `rename-dialog.tsx`: Electron's renderer
 * has no working `window.prompt`, and the name syncs to the shared account.
 *
 * One dialog for both cases: `initialValue` empty is a create, populated is a
 * rename. The caller decides the title and the submit label.
 */
export function CollectionNameDialog({
  open,
  title,
  submitLabel,
  initialValue,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  initialValue: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  // Reset to the starting value each time the dialog opens.
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const trimmed = value.trim();
  const submit = () => {
    if (trimmed && trimmed !== initialValue.trim()) onSubmit(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-50 bg-overlay/50" />
        <Dialog.Content className="animate-slide-up fixed top-1/2 left-1/2 z-50 w-[24rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-elevated p-5 shadow-lg outline-none">
          <Dialog.Title className="text-sm font-semibold text-foreground">{title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-fg-muted">
            The name syncs to every device on your account.
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
              maxLength={NAME_MAX}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Collection name"
              aria-label="Collection name"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close className={buttonGhostClass} type="button">
                Cancel
              </Dialog.Close>
              <button className={buttonPrimaryClass} type="submit" disabled={!trimmed}>
                {submitLabel}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
