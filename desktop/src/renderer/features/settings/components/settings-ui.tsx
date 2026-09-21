import type { ReactNode } from 'react';
import { Select, Switch } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { dividerBottom, surfaceClass } from '@/lib/ui';
import { cn } from '@/lib/utils';

/** A settings section: a heading, optional description, and rows beneath it,
 * separated by whitespace and hairlines — not stacked cards. */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-12">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      <div>{children}</div>
    </section>
  );
}

/** One control on its own line: label + description on the left, control right. */
export function SettingRow({
  label,
  description,
  children,
  align = 'center',
}: {
  label: string;
  description?: string;
  children?: ReactNode;
  align?: 'center' | 'start';
}) {
  return (
    <div
      className={cn(
        'flex justify-between gap-6 py-4',
        dividerBottom,
        align === 'center' ? 'items-center' : 'items-start',
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

/** A labelled on/off switch. */
export function ToggleSetting({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      className="relative h-5 w-9 rounded-full bg-border-strong outline-none transition-colors data-[state=checked]:bg-primary focus-visible:ring-2 focus-visible:ring-focus"
    >
      <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-4" />
    </Switch.Root>
  );
}

/** A compact select. Options are value/label pairs. */
export function SelectSetting<T extends string>({
  value,
  onValueChange,
  options,
  label,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <Select.Root value={value} onValueChange={(v) => onValueChange(v as T)}>
      <Select.Trigger
        aria-label={label}
        className="inline-flex min-w-36 items-center justify-between gap-2 rounded-md border border-border bg-elevated px-3 py-2 text-sm text-foreground outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus"
      >
        <Select.Value />
        <Select.Icon>
          <ChevronDown className="size-4 text-fg-muted" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className={cn(surfaceClass, 'min-w-radix-select')}
          position="popper"
          sideOffset={4}
        >
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                className="flex cursor-default items-center justify-between gap-6 rounded-md px-2 py-1.5 text-sm text-foreground outline-none data-[highlighted]:bg-hover"
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check className="size-4 text-primary" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
