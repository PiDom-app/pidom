# Contributing

Thanks for looking. This is a small project with strong opinions, and most of
them are written down — reading [docs/architecture.md](docs/architecture.md)
before a substantial change will save you a round trip.

## Getting it running

[docs/setup.md](docs/setup.md). The short version is that Expo Go will not work,
because Google Sign-In needs custom native code, so you need a development
build.

## The rules that are actually enforced

These are not style preferences. Each one is load-bearing, and there is a
comment in the code explaining why.

**Colours come from tokens.** `src/design/global.css` is the only place a colour
is defined. Tailwind's default palette is switched off, so `bg-red-500` names
nothing and renders nothing — silently. Three shipped bugs have come from
exactly that. Before opening a PR:

```bash
node -e '
const fs=require("fs"),path=require("path");
const css=fs.readFileSync("src/design/global.css","utf8");
const d=new Set([...css.matchAll(/^\s*--color-([a-z0-9-]+):/gm)].map(m=>m[1]));
const re=/\b(?:bg|text|border|ring|fill|stroke)-([a-z][a-z0-9-]*)(?:\/\d+)?\b/g;
const bad=[];
(function w(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);
 if(e.isDirectory()){w(p);continue} if(!/\.tsx?$/.test(p))continue;
 fs.readFileSync(p,"utf8").split("\n").forEach((l,i)=>{for(const m of l.matchAll(re))
  if(!d.has(m[1])) bad.push(`${p}:${i+1} ${m[0]}`)})}})("src");
console.log(bad.join("\n")||"ok");'
```

**`styled` comes from `../styled-shim`.** A vendored gluestack component that
imports it from `nativewind` drags a combinatorial type through the checker —
measured at 9.36M instantiations and 71 seconds. The shim is documented at
`src/components/ui/styled-shim.ts`. `npm run typecheck` should stay around three
seconds; if it jumps to a minute, that is why.

**No cards.** The library is one continuous surface. Sections are separated by
whitespace, covers are the only filled shapes, and `Card` stays unvendored.

**Convex functions validate, own, and bound.** Every public function takes
argument validators, resolves identity through `convex/model/auth.ts` rather
than from an argument, and reads with `.take(n)`. The two `.collect()` calls in
the codebase are cascade deletes and say so in a comment.

**Comments explain why, not what.** The code says what it does. A comment earns
its place by recording a decision, a constraint, or a bug that is not visible
from the lines around it.

## Proposing a change

1. Open an issue first for anything beyond a fix. It is cheaper to disagree
   about an approach in prose.
2. Branch from `main`.
3. Keep the diff to one thing.
4. Fill in the pull request template — particularly *how to check it*.

## Commits

Present tense, describing the change: `Fix the cover render racing the file
move`. If it closes an issue, say so in the body.

## Security

Do not open a public issue for anything that could expose a reader's documents
or credentials. [SECURITY.md](SECURITY.md) has the private route.
