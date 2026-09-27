import { cn } from '@/lib/utils';
import type { DownloadAnimation } from '@/features/settings/use-desktop-settings';

/**
 * A determinate download indicator in the reader's chosen style. `progress` is
 * always the real fraction of bytes received; the animation only rides on top,
 * so a reduced-motion setting stops the motion (see global.css) without ever
 * hiding how far along the download is.
 *
 * Four styles, matching the sign-off mockup: `bar` (the minimal default, the
 * same hairline the reader uses for reading position), `comet` (a light glint
 * sweeping the filled part), `ring` (a circular fill), and `stripes` (a
 * barber-pole texture over the fill).
 */
/**
 * When the motion runs. A live download animates continuously (`always`); a
 * settings preview stays still and only plays while the reader points at its row
 * (`hover`), so the list is calm at rest and demonstrates the style on demand.
 * The `hover` variants read a `group-hover`/`group-focus-visible` state from an
 * ancestor marked `group`; reduce-motion still wins over both (see global.css).
 */
type PlayMode = 'always' | 'hover';

/** The animation utility for a style, gated by when it should play. */
function motion(base: string, when: PlayMode): string {
  return when === 'always'
    ? base
    : cn('[animation-play-state:paused]', base, 'group-hover:[animation-play-state:running]');
}

export function DownloadProgress({
  style,
  progress,
  animated = 'always',
  className,
}: {
  style: DownloadAnimation;
  progress: number;
  animated?: PlayMode;
  className?: string;
}) {
  const fraction = Math.max(0, Math.min(1, progress));
  const pct = fraction * 100;
  const rounded = Math.round(pct);

  if (style === 'ring') {
    return (
      <div
        className={cn('relative size-8 shrink-0', className)}
        role="progressbar"
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn('size-full rounded-full', motion('animate-dl-spin', animated))}
          style={{
            background: `conic-gradient(rgb(var(--primary)) 0 ${pct}%, rgb(var(--hairline)) ${pct}% 100%)`,
          }}
        />
        {/* The hub matches the page surface so only the ring reads. */}
        <div className="absolute inset-[3px] rounded-full bg-surface" />
      </div>
    );
  }

  const common = {
    role: 'progressbar' as const,
    'aria-valuenow': rounded,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
  };

  if (style === 'comet') {
    return (
      <div
        className={cn('relative h-1 w-full overflow-hidden rounded-full bg-hairline', className)}
        {...common}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        >
          <div
            className={cn(
              'dl-glint absolute inset-y-0 w-2/5',
              motion('animate-dl-comet', animated),
            )}
          />
        </div>
      </div>
    );
  }

  if (style === 'stripes') {
    return (
      <div
        className={cn('h-1.5 w-full overflow-hidden rounded-full bg-hairline', className)}
        {...common}
      >
        <div
          className={cn(
            'dl-stripe-texture h-full rounded-full bg-primary',
            motion('animate-dl-stripes', animated),
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  }

  // bar — the minimal default. No motion of its own; the fill is the readout.
  return (
    <div
      className={cn('h-0.5 w-full overflow-hidden rounded-full bg-hairline', className)}
      {...common}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}
