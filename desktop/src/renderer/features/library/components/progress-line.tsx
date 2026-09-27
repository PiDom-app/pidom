import { cn } from '@/lib/utils';

/**
 * A thin reading-position line. Communicates progress without a number or a
 * card — a hairline track with a primary-filled portion.
 */
export function ProgressLine({ progress, className }: { progress: number; className?: string }) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div
      className={cn('h-0.5 w-full overflow-hidden rounded-full bg-hairline', className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}
