## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- The problem it addresses. Link an issue if there is one: Closes #123 -->

## How to check it

<!-- What a reviewer should do to see it work. Be specific about the state you
     started from — an empty library and a full one behave differently. -->

1.
2.

## Checklist

- [ ] `npm run typecheck` is clean
- [ ] Every colour comes from a token in `src/design/global.css` — no hex, no numbered Tailwind colour
- [ ] Any new `src/components/ui` component imports `styled` from `../styled-shim`, not `nativewind`
- [ ] New Convex functions validate their arguments, check ownership, and read with `.take()` rather than `.collect()`
- [ ] Tested on a device or emulator, not only in the type checker

## Screenshots

<!-- For anything visual, both themes. `docs/screens/` shows the house style. -->
