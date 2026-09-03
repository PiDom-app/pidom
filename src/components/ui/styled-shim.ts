import { styled as nativewindStyled } from 'nativewind';
import type { ComponentPropsWithRef, ComponentType, ElementType } from 'react';

/**
 * A cheaply-typed `styled`, for the vendored components below this folder.
 *
 * WHY THIS EXISTS. NativeWind re-exports `styled` from `react-native-css`,
 * whose signature is:
 *
 *     styled: <const C extends ReactComponent, const M extends StyledConfiguration<C>>(…) => any
 *
 * `StyledConfiguration<C>` resolves to `DotNotation<ComponentProps<C>>`, which
 * recurses ten levels deep through the component's props building a template
 * literal union of every dotted path — `style.transform[number].scale` and so
 * on. Over a React Native view, and especially over a Reanimated animated
 * component, that union is combinatorial. Measured on this project it cost
 * 9.36M type instantiations and 71 seconds of a 75-second `tsc` run, and it
 * overflowed outright on `toast` (TS2589 "excessively deep", TS2590 "union type
 * too complex to represent").
 *
 * Every one of those instantiations is spent computing a constraint that is
 * then thrown away: the real `styled` returns `any`, and the call sites in this
 * folder pass one of two fixed mapping shapes. So the constraint buys no safety
 * here at all.
 *
 * Fixing it means never letting `C` reach `DotNotation`. `component` is typed
 * loosely and the result is typed precisely, which is the useful half — call
 * sites get `ComponentPropsWithRef<C> & { className?: string }` instead of the
 * `any` upstream hands back, so this is better typed than what it replaces.
 *
 * REGENERATING. `npx gluestack-ui add <name>` writes a component that imports
 * `styled` from 'nativewind'. Repoint it here, or the slow path comes back.
 */

/**
 * The two mapping shapes the components in this folder actually pass.
 *
 * Most send `className` straight at `style`. The three that wrap something
 * drawing itself from props rather than a stylesheet — `Icon`, `Badge`'s icon,
 * `Spinner` — send the long form, which pulls resolved values back out of the
 * computed style and onto native props (`ActivityIndicator` takes a `color`
 * prop, not a `color` style).
 *
 * Spelled out rather than widened to `unknown`: this argument is the one thing
 * a caller can get wrong here, and the whole point of the file is that upstream
 * no longer checks it.
 */
type ClassNameMapping = {
  className:
    | 'style'
    | {
        target: string | false;
        nativeStyleToProp?: Record<string, true | string>;
      };
};

export function styled<C extends ElementType>(
  component: C,
  mapping: ClassNameMapping,
): ComponentType<ComponentPropsWithRef<C> & { className?: string }> {
  return (
    nativewindStyled as (
      c: unknown,
      m: unknown,
      // `WithRef` rather than `ComponentProps`: every call site forwards a ref
      // into the result, and the plain form drops it for a component whose
      // props type was written without one.
    ) => ComponentType<ComponentPropsWithRef<C> & { className?: string }>
  )(component, mapping);
}
