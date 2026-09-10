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

## The bold-text trap

`plugins/with-text-measurement-fix.js` neutralises Android's
`fontWeightAdjustment`, because React Native measures text with the unadjusted
typeface and clips whatever the bump adds — "Contents" renders as "Content",
"Search your library" as "Search your".

Its guard used to be "if the marker is already in `MainActivity.kt`, do
nothing", which made the override **unupgradable**. The first version of the fix
used `applyOverrideConfiguration`, that version does not work, and every
prebuild after it saw its own marker and left it in place — so a device with
Bold text on kept losing the last word of every label in a build whose source
contained the working fix. The plugin replaces its own block now.

If labels start losing a character, check
`adb shell settings get secure font_weight_adjustment` before looking at the
layout.

`web.output` is `single`, not `static`. Expo's static rendering runs the tree
through `react-native-web` in Node, which the NativeWind v5 preview currently
breaks — and pre-rendering HTML for an auth-gated reader buys nothing anyway.

## The canvas

`.design/` holds the design source: `build.mjs` generates one `.dc.html`
artboard per screen — eighty-nine of them — and `screens.mjs` draws twenty-one
of the same screens as SVG for the images in the README. Both read the same tokens
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

## The sharing surfaces

Twenty-eight artboards, drawn before any of the code was written. Six screens,
three sheets and a dialog, and every one of them wears the shell
`navigator-screen.tsx` established: a back arrow, a glyph, two lines of title,
something small on the right, an optional row of chips, and a rule.
`components/segments.tsx` is that shell, lifted rather than reinvented — four
new screens with four slightly different headers would be four screens that look
like four different applications.

The vocabulary does not change. No cards. `rounded-md` everywhere.
`data-[active=true]:bg-hover` on every pressable. `Divider className="bg-hairline"`.
Semantic tokens only, so no colour on any of these screens is a hex.

**No `Tabs`.** gluestack ships one. This app's segmented control is the chip row
from the navigator, built that way after a sheet's height moved its own control
under somebody's thumb — a second one would be a second vocabulary for the same
job. `Tag` in `components/person-row.tsx` is the same chip used as a role label,
and the presence dot is a `Box` with `bg-ok`, because `AvatarBadge` carries its
own colour and every colour here comes from a token.

**`Badge` was finally vendored**, and only once there was a number somebody has
to act on. It carries exactly two: unanswered shares on the Shared row, and
unread activity on the Activity row. That is the whole rule for it — the only
filled shape on the account screen and the only number on it anybody is expected
to do something about, which is what separates it from every other piece of
metadata there, all of which is `text-fg-subtle` and stays that way. Vendoring
it took the two mandatory steps this document requires: `styled` repointed to
`../styled-shim`, and its colour classes audited (`dark:bg-destructive/60`,
`dark:border-border/90` and `text-white` removed, `rounded-sm` to `rounded-md`).

**Screens rather than sheets, with two exceptions.** Choosing a permission is
four rows that will never be five, and a profile preview is a fixed block —
neither has a height that is the reader's data, so both are `Actionsheet`s
shaped like `document-details.tsx`. Everything else is a route, because
everything else holds a list.

Three of the artboards exist to say something the code cannot:

- **`ShareRevoked`** — access removed, the local copy still openable, and the
  sentence that a downloaded file cannot be recalled.
- **`ManageAccessRemove`** — the same truth in the dialog, before the tap.
- **`ShareModel`** (900×720) — identity, membership and access as three separate
  things, and a column headed **Never** listing what removing access does not
  reach.

## Where content sits

Three rules, written down after a round of screens broke all three.

**A list starts at the top; a single message sits in the middle.** Those are
two different things and the mistake was treating them as one. Rows begin at the
top against the `px-6` gutter, so an empty list and a full one start in the same
place — but an empty state is not a list with nothing in it, it is the only
thing on the screen, and the only honest place for the only thing on the screen
is the centre of it. `Empty` is `flex-1 items-center justify-center`, with no
fixed top padding to guess a screen height with.

That needs height to centre in. Inside a `ScrollView` the content container is
sized by its children, so `flex-1` collapses and the state pins to the top
anyway; the scrolling screens set `flexGrow: 1` on their content style (or
`grow` in a `contentContainerClassName`) to give it the viewport as a floor
without a ceiling. Short content centres, long content scrolls exactly as
before.

The one screen that had a centred _hero_ — a 164px identity block with an
explicit `<Box className="flex-1" />` under it — went the other way, to a
left-aligned identity row over a scroller. It was not an empty state; it was a
screen full of content pretending to be one, and the spacer is what clipped
long titles with no way to reach them.

**Skeletons, not spinners.** Eight screens loaded into an identical
`flex-1 items-center justify-center` spinner. They use `ShareRowSkeleton` and
`PersonRowSkeleton` now, modelled on `library-skeleton.tsx`: the shape of what
is coming, in the position it will occupy, rather than a dot in the middle of
nothing.

**A long list scrolls, and a fixed footer does not.** The results on the share
screen were a `.map()` inside a plain `VStack` and could not be reached past the
fold; they are a `FlashList`. Anything that has to stay reachable while the body
scrolls — the Share button, Save on the profile screen — sits under a `Divider`
below the scroller rather than floating over it.

## Picking a time without a date picker

Quiet hours are two times of day, and the sheet that sets them is forty-eight
rows in half-hour steps rather than `@react-native-community/datetimepicker`.
That would be a dependency, two native behaviours and two sets of theming to
fight, for a value nobody sets to 22:17. The list is both smaller and easier to
hit than a spinner, and its height is fixed rather than fitted — forty-eight
rows would otherwise push the sheet past the top of the screen and take the drag
indicator with it.
