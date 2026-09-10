'use client';
import { PrimitiveIcon, UIIcon } from '@gluestack-ui/core/icon/creator';
import type { VariantProps } from '@gluestack-ui/utils/nativewind-utils';
import { tva, useStyleContext, withStyleContext } from '@gluestack-ui/utils/nativewind-utils';
import React from 'react';
import { Text, View } from 'react-native';
import { Svg } from 'react-native-svg';

// `../styled-shim`, never `nativewind` — see the note in that file. The CLI
// writes the nativewind import, and left alone it takes `tsc` from four
// seconds to seventy-five.
import { styled } from '../styled-shim';

const SCOPE = 'BADGE';

/**
 * Audited against `docs/design.md` before it was used.
 *
 * Three things the CLI wrote had to go. The `dark:` variants — `bg-destructive`
 * and `border-border` both flip themselves through `global.css`, and `dark:` in
 * application code is the thing this project does not do; there is exactly one
 * occurrence in `src/` and it is a key in `tokens.ts`. `text-white`, which
 * resolves only because `--color-white` happens to exist and is not what a
 * foreground on a filled surface means. And `rounded-sm`, which is 6px like
 * every other radius here, so it is written as `rounded-md` with the rest.
 */
const badgeStyle = tva({
  base: 'flex-row items-center justify-center rounded-md px-2 py-0.5',
  variants: {
    variant: {
      default: 'bg-primary',
      secondary: 'bg-secondary',
      destructive: 'bg-destructive',
      outline: 'border border-border bg-transparent',
    },
  },
});

const badgeTextStyle = tva({
  base: 'text-xs font-medium tracking-normal uppercase',
  parentVariants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      destructive: 'text-primary-foreground',
      outline: 'text-foreground',
    },
  },
});

const badgeIconStyle = tva({
  base: 'fill-none h-3 w-3 pointer-events-none',
  parentVariants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      destructive: 'text-primary-foreground',
      outline: 'text-foreground',
    },
  },
});

const ContextView = withStyleContext(View, SCOPE);

type IBadgeProps = React.ComponentPropsWithoutRef<typeof ContextView> &
  VariantProps<typeof badgeStyle>;
function Badge({
  children,
  variant = 'default',
  className,
  ...props
}: { className?: string } & IBadgeProps) {
  return (
    <ContextView
      className={badgeStyle({ variant, class: className })}
      {...props}
      context={{ variant }}
    >
      {children}
    </ContextView>
  );
}

type IBadgeTextProps = React.ComponentPropsWithoutRef<typeof Text> &
  VariantProps<typeof badgeTextStyle>;

const BadgeText = React.forwardRef<React.ComponentRef<typeof Text>, IBadgeTextProps>(
  function BadgeText({ children, className, ...props }, ref) {
    const { variant: parentVariant } = useStyleContext(SCOPE);
    return (
      <Text
        ref={ref}
        className={badgeTextStyle({
          parentVariants: {
            variant: parentVariant,
          },
          class: className,
        })}
        {...props}
      >
        {children}
      </Text>
    );
  },
);

type IBadgeIconProps = React.ComponentPropsWithoutRef<typeof PrimitiveIcon> &
  VariantProps<typeof badgeIconStyle> & {
    size?: number;
  };

const StyledUIIcon = styled(UIIcon, {
  className: {
    target: 'style',
    nativeStyleToProp: {
      height: true,
      width: true,
      fill: true,
      color: 'classNameColor',
      stroke: true,
    },
  },
});

const BadgeIcon = React.forwardRef<React.ComponentRef<typeof Svg>, IBadgeIconProps>(
  function BadgeIcon({ className, size, ...props }, ref) {
    const { variant: parentVariant } = useStyleContext(SCOPE);

    if (typeof size === 'number') {
      return (
        <StyledUIIcon
          ref={ref}
          {...props}
          className={badgeIconStyle({ class: className })}
          size={size}
        />
      );
    } else if ((props?.height !== undefined || props?.width !== undefined) && size === undefined) {
      return <StyledUIIcon ref={ref} {...props} className={badgeIconStyle({ class: className })} />;
    }
    return (
      <StyledUIIcon
        className={badgeIconStyle({
          parentVariants: {
            variant: parentVariant,
          },
          class: className,
        })}
        {...props}
        ref={ref}
      />
    );
  },
);

Badge.displayName = 'Badge';
BadgeText.displayName = 'BadgeText';
BadgeIcon.displayName = 'BadgeIcon';

export { Badge, BadgeIcon, BadgeText };
