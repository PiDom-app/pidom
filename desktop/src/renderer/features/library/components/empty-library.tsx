import { Library } from 'lucide-react';

/**
 * First-run state, after connecting an account that has nothing in it yet.
 * Explains where documents come from without pretending the desktop can import
 * one today — importing and downloading arrive with the reader.
 */
export function EmptyLibrary() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex size-12 items-center justify-center rounded-md bg-sunken text-fg-subtle">
        <Library className="size-6" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-foreground">Your library is empty</h2>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">
        Documents you add on your phone show up here. Anything already in your account will appear
        as soon as it syncs.
      </p>
    </div>
  );
}
