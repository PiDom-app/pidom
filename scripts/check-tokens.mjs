import fs from 'node:fs';
import path from 'node:path';

/**
 * Fails if any colour utility in `src/` names a token that does not exist.
 *
 * Tailwind's default palette is switched off in `src/design/global.css`
 * (`--color-*: initial`), so a component reaching for `bg-red-500` — or for a
 * gluestack token this theme never defined, like `ring-indicator-info` — names
 * nothing and renders no colour at all. Nothing errors. The AlertDialog
 * backdrop shipped invisible that way, and three vendored components arrived
 * with the same problem.
 *
 * Run by CI and worth running before a pull request.
 */
const css = fs.readFileSync('src/design/global.css', 'utf8');
const defined = new Set([...css.matchAll(/^\s*--color-([a-z0-9-]+):/gm)].map((m) => m[1]));

const UTILITY =
  /\b(?:bg|text|border|ring|fill|stroke|outline|placeholder|caret|divide)-([a-z][a-z0-9-]*)(?:\/\d+)?\b/g;

/** Suffixes that are not colours: `text-center`, `border-t`, `text-sm`. */
const NOT_A_COLOUR = new Set(
  ('none auto solid dashed dotted hidden left right center start end top bottom x y xs sm md lg ' +
    'xl base px wrap nowrap balance pretty clip ellipsis uppercase lowercase normal collapse ' +
    'separate inline block full screen fit min max reverse wide wider widest tight loose snug ' +
    'transparent current line through no underline offset opacity t b l r transform safe decoration'
  ).split(' '),
);

const problems = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(file);
      continue;
    }
    if (!/\.tsx?$/.test(file)) continue;
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const match of line.matchAll(UTILITY)) {
          const name = match[1];
          if (defined.has(name) || NOT_A_COLOUR.has(name)) continue;
          // `text-decoration-none` is a CSS property gluestack emits for web,
          // not a colour utility.
          if (match[0] === 'text-decoration-none') continue;
          problems.push(`${file}:${i + 1}  ${match[0]}`);
        }
      });
  }
})('src');

if (problems.length > 0) {
  console.error('Colour utilities with no token behind them:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\n${problems.length} problem(s). Every colour must resolve to a token in src/design/global.css.`);
  process.exit(1);
}
console.log('Every colour utility in src/ resolves to a token.');
