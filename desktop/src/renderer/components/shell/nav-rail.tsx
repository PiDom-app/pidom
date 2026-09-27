import { Link } from '@tanstack/react-router';
import { Tooltip } from 'radix-ui';
import {
  BookmarkCheck,
  Download,
  FolderClosed,
  Home,
  Library,
  Settings as SettingsIcon,
  Star,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PidomMark } from '@/components/brand/pidom-mark';
import { useSession } from '@/providers/session-provider';
import { useConvexAuth } from 'convex/react';
import { useDesktopSettings } from '@/features/settings/use-desktop-settings';
import { cn } from '@/lib/utils';
import { AccountControl } from './account-control';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** The destinations, split into two labelled runs so the rail reads as groups
 * rather than one long list — the same shape as the mobile account hub. */
const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Browse',
    items: [
      { to: '/home', label: 'Home', icon: Home },
      { to: '/library', label: 'Library', icon: Library },
      { to: '/downloads', label: 'Downloads', icon: Download },
    ],
  },
  {
    label: 'Organise',
    items: [
      { to: '/collections', label: 'Collections', icon: FolderClosed },
      { to: '/favorites', label: 'Favorites', icon: Star },
      { to: '/finished', label: 'Finished', icon: BookmarkCheck },
    ],
  },
];

const itemClass =
  'flex items-center gap-3 rounded-md px-3 text-sm font-medium text-fg-muted outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus [&_svg]:size-6 [&_svg]:shrink-0';

const activeItemClass = 'bg-hover text-foreground';

const groupLabelClass =
  'px-3 pt-4 pb-1.5 text-2xs font-semibold tracking-wide text-fg-subtle uppercase';

/**
 * The permanent left navigation. It belongs to the structural background of the
 * shell — not another floating card — with the product mark and connection
 * state at the top, the primary destinations grouped through the middle, and
 * Settings plus the account control pinned to the bottom. Icons read at 24px so
 * a glance finds them; each destination carries a tooltip for the same reason.
 */
export function NavRail() {
  const { density } = useDesktopSettings();
  const itemPad = density === 'compact' ? 'py-1.5' : 'py-2';
  return (
    <nav className="flex h-full w-64 shrink-0 flex-col px-3 pt-9 pb-3">
      <div className="flex items-center gap-2.5 px-2 pt-2 pb-1">
        <PidomMark size={22} className="text-primary" />
        <span className="text-lg font-semibold tracking-tight text-foreground">Pidom</span>
      </div>
      <ConnectionIndicator />

      <div className="mt-2 flex flex-1 flex-col">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <p className={groupLabelClass}>{group.label}</p>
            <div className="flex flex-col gap-0.5">
              {group.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} label={label} icon={Icon} pad={itemPad} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mx-1 mb-2 h-px bg-hairline" />
      <div className="flex flex-col gap-0.5">
        <NavLink to="/settings" label="Settings" icon={SettingsIcon} pad={itemPad} />
        <AccountControl />
      </div>
    </nav>
  );
}

/** One destination: an active-aware link wrapped in a tooltip that names it. */
function NavLink({
  to,
  label,
  icon: Icon,
  pad,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  pad: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Link to={to} className={cn(itemClass, pad)} activeProps={{ className: activeItemClass }}>
          <Icon />
          {label}
        </Link>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={6}
          className="z-50 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-lg"
        >
          {label}
          <Tooltip.Arrow className="fill-popover" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** A compact line under the brand showing the desktop is connected to Convex. */
function ConnectionIndicator() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { status } = useSession();

  const connected = isAuthenticated && status === 'signed-in';
  const label = isLoading ? 'Connecting…' : connected ? 'Connected' : 'Offline';
  const dotClass = isLoading ? 'bg-warn' : connected ? 'bg-ok' : 'bg-fg-disabled';

  return (
    <div className="flex items-center gap-2 px-2 text-2xs text-fg-subtle">
      <span className={cn('size-1.5 rounded-full', dotClass)} />
      {label}
    </div>
  );
}
