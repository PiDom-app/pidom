import { Avatar, DropdownMenu } from 'radix-ui';
import { useNavigate } from '@tanstack/react-router';
import { LogOut, Settings as SettingsIcon } from 'lucide-react';
import { useSession } from '@/providers/session-provider';
import { menuItemClass, menuSeparatorClass, surfaceClass } from '@/lib/ui';

/**
 * The signed-in account control at the foot of the nav rail: the Google avatar,
 * name, and a menu for settings and sign-out. Identity here is display-only —
 * Convex derives the real identity from the verified token.
 */
export function AccountControl() {
  const { profile, signOut } = useSession();
  const navigate = useNavigate();

  const name = profile?.name ?? 'Signed in';
  const email = profile?.email ?? '';
  const initial = (profile?.name ?? profile?.email ?? '?').trim().charAt(0).toUpperCase();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex w-full items-center gap-2.5 rounded-md p-2 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-hover">
        <Avatar.Root className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sunken">
          {profile?.picture && (
            <Avatar.Image src={profile.picture} alt="" className="h-full w-full object-cover" />
          )}
          <Avatar.Fallback className="text-sm font-medium text-fg-muted">{initial}</Avatar.Fallback>
        </Avatar.Root>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{name}</p>
          {email && <p className="truncate text-xs text-fg-muted">{email}</p>}
        </div>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={surfaceClass} align="start" side="top" sideOffset={6}>
          <DropdownMenu.Item
            className={menuItemClass}
            onSelect={() => void navigate({ to: '/settings' })}
          >
            <SettingsIcon className="size-4" />
            Settings
          </DropdownMenu.Item>
          <DropdownMenu.Separator className={menuSeparatorClass} />
          <DropdownMenu.Item className={menuItemClass} onSelect={() => void signOut()}>
            <LogOut className="size-4" />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
