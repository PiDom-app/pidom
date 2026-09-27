/**
 * Shared class strings for the Radix-primitive surfaces that recur across the
 * app — menus, popovers, inputs, buttons. Centralised so every dropdown, context
 * menu, and popover reads the same and the token usage stays in one place. All
 * colours are semantic tokens; every radius is 6px.
 */

/** Floating surface for dropdown / context / popover content. */
export const surfaceClass =
  'z-50 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg';

/** A selectable row inside a menu. */
export const menuItemClass =
  'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground outline-none data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:text-fg-disabled';

/** A thin divider between menu groups. */
export const menuSeparatorClass = 'my-1 h-px bg-hairline';

/** Primary action button. */
export const buttonPrimaryClass =
  'inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-50';

/** Secondary / neutral button. */
export const buttonGhostClass =
  'inline-flex items-center justify-center gap-2 rounded-md border border-border bg-elevated px-3.5 py-2 text-sm font-medium text-foreground outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-50';

/**
 * A bottom hairline drawn as an inset box-shadow rather than a border utility.
 * The token guard reads a directional edge-border utility as an undefined
 * colour token; an inset shadow with the hairline token draws the same line and
 * stays within the token system.
 */
export const dividerBottom = 'shadow-[inset_0_-1px_0_rgb(var(--hairline))]';

/**
 * A single bottom or right edge in the border colour, drawn the same inset-
 * shadow way as `dividerBottom`. A one-side border width utility reads to the
 * token guard as a colour token named for the side, so an inset shadow with the
 * border token draws the same line and stays inside the token system.
 */
export const edgeBottom = 'shadow-[inset_0_-1px_0_rgb(var(--border))]';
export const edgeRight = 'shadow-[inset_-1px_0_0_rgb(var(--border))]';

/** Text input / search field. */
export const inputClass =
  'w-full rounded-md border border-input bg-elevated px-3 py-2 text-sm text-foreground outline-none placeholder:text-fg-subtle focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-focus';
