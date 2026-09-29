import { Fragment } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** One step in a breadcrumb trail. A crumb with `to` is a link; the last crumb
 *  is the current page and is rendered as plain text however it is configured. */
export interface Crumb {
  label: string;
  to?: string;
}

/**
 * A breadcrumb trail — the trail of pages leading to the one on screen.
 *
 * It sits directly in the page flow above the header, not in a bar or box: muted
 * links separated by a chevron, the current page in the foreground colour. The
 * link styling mirrors the nav rail (`hover:text-foreground`, the shared focus
 * ring) so the whole shell reads as one system. Corners stay 6px; colours are
 * semantic tokens only.
 */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center gap-1 text-sm', className)}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <Fragment key={`${item.label}-${index}`}>
            {index > 0 && (
              <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
            )}
            {item.to && !isLast ? (
              <Link
                to={item.to}
                className="truncate rounded-md text-fg-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={cn('truncate', isLast ? 'font-medium text-foreground' : 'text-fg-muted')}
                aria-current={isLast ? 'page' : undefined}
              >
                {item.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
