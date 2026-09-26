import { DropdownMenu } from 'radix-ui';
import { ChevronDown, FilePlus2, FolderPlus, Plus } from 'lucide-react';
import { buttonPrimaryClass, menuItemClass, surfaceClass } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { useImports } from '../data/use-imports';

/**
 * The Library's Import affordance: one primary button that drops a short menu of
 * the two ways in — a native file picker or a folder scan. Both hand off to
 * main, which owns every filesystem step; the renderer only ever gets a count
 * back. Drag-and-drop is the third way in and lives on the page itself, so it
 * needs no control here.
 */
export function ImportMenu({ className }: { className?: string }) {
  const { pickFiles, pickFolder } = useImports();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={cn(buttonPrimaryClass, className)}>
        <Plus className="size-4" />
        Import
        <ChevronDown className="size-3.5 opacity-80" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={surfaceClass} align="end" sideOffset={4}>
          <DropdownMenu.Item className={menuItemClass} onSelect={() => void pickFiles()}>
            <FilePlus2 className="size-4" />
            Import files…
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItemClass} onSelect={() => void pickFolder()}>
            <FolderPlus className="size-4" />
            Import folder…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
