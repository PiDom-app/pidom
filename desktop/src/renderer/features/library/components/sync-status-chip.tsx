import { RefreshCw } from 'lucide-react';
import { useCollectionsMirror } from '../data/use-collections-mirror';

/**
 * A quiet marker that organization edits are queued locally and haven't reached
 * the account yet. Collection, favorite, and finished writes land in the local
 * mirror and an outbox instantly (so they work offline); this chip reflects the
 * outbox depth from the mirror's `pending` count and disappears the moment the
 * drainer empties it. Renders nothing when everything is synced, so it never adds
 * chrome to the common case.
 */
export function SyncStatusChip() {
  const { pending } = useCollectionsMirror();
  if (pending <= 0) return null;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md bg-sunken px-2 py-1 text-xs text-fg-muted"
      title={`${pending} ${pending === 1 ? 'change' : 'changes'} waiting to sync`}
    >
      <RefreshCw className="size-3.5" />
      Changes will sync
    </span>
  );
}
