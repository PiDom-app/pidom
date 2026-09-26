import type { ReactNode } from 'react';

/**
 * The compact header every workspace page shares: a title, an optional subtitle,
 * and room for page-specific controls. Global search now lives centred in the
 * title bar, so the header no longer carries a search trigger. It sits directly
 * in the page flow — a heading and a row of controls, not a bar in a box.
 */
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </header>
  );
}
