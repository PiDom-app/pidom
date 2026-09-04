# Design

The token system, and the canvas the screens are drawn on.

## Design tokens

`src/design/global.css` is the only place colours are defined. Components reach
for semantic tokens (`bg-background`, `text-muted-foreground`, `border-border`)
and never a hex or a numbered Tailwind colour — Tailwind's default palette is
switched off, so `bg-red-500` does not exist.

Three themes: light, dark, and system. Dark is true black with a neutral grey
ramp, no blue cast. Every corner is 6px; `rounded-full` is reserved for avatars
and status dots. The radius scale is defined at 6px at every step so a component
reaching for `rounded-lg` cannot break the rule by accident.

`src/components/ui` holds only the components actually imported. Adding one is
`npx gluestack-ui@latest add <name>`, which finds this folder on its own. Then
**repoint any `styled` import at `../styled-shim`** (see Scripts) — five of the
seven added for the library screen arrived importing it from `'nativewind'`.

Check what the CLI wrote before trusting it. Because Tailwind's palette is
switched off, a component reaching for one names nothing at all and renders no
colour, silently. Auditing every colour utility in `src/` against the tokens in
`global.css` turned up six that rendered wrong: the AlertDialog backdrop
(`bg-black/50`, so the sign-out dialog had no dim behind it), the Actionsheet
backdrop (`bg-[#000]/50`, which does render — as pure black over a light theme
that wants near-black), the avatar's status dot, the focus ring on every
`Pressable`, and the `highlight` variant on `Text`, `Heading`, `Menu` and
`Actionsheet`. All six now point at tokens. The audit is worth re-running after
any `add`.

The type scale needed one addition for the same reason: gluestack's `Text` and
`Heading` both offer a `2xs` size and map it to `text-2xs`, which Tailwind's
default scale does not define. `--text-2xs` is now in `global.css` at 10px,
which is the metadata line under a document tile.

`web.output` is `single`, not `static`. Expo's static rendering runs the tree
through `react-native-web` in Node, which the NativeWind v5 preview currently
breaks — and pre-rendering HTML for an auth-gated reader buys nothing anyway.

## The canvas

`.design/` holds the design source: `build.mjs` generates one `.dc.html`
artboard per screen — forty-six of them — and `screens.mjs` draws eighteen of
the same screens as SVG for the images in the README. Both read the same tokens
as `src/design/global.css`, so a colour that changes there has to change in both
— the audit that checks `src/` does not reach them.

`build.mjs` also writes `canvas.json`, which lays the artboards out. Editing that
file by hand is a change the next build silently reverts; the generator owns it.

```bash
node .design/build.mjs      # artboards for the canvas
node .design/screens.mjs    # SVG for docs/screens/
```

Rasterising the SVG needs `rsvg-convert`:

```bash
cd docs/screens && for f in *.svg; do rsvg-convert -w 780 "$f" -o "${f%.svg}.png"; done
```
