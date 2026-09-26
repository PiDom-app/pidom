#!/usr/bin/env node
/**
 * Token guard, ported from the mobile app's scripts/check-tokens.mjs.
 *
 * Tailwind's default palette is switched off in design/global.css, so a colour
 * utility that names a token which is not defined resolves to nothing and
 * renders no colour, silently. This script fails the build when a colour
 * utility (bg-, text-, border-, ring-, fill-, stroke-, …) under src/renderer
 * names a colour token that global.css does not define.
 *
 * It is intentionally conservative: it only flags the colour families above, and
 * it ignores non-colour utilities (spacing, sizing, etc.) that share the prefix.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cssPath = join(root, 'src/renderer/design/global.css');
const srcDir = join(root, 'src/renderer');

// Collect defined colour tokens from the `--color-*: ...` declarations.
const css = readFileSync(cssPath, 'utf8');
const defined = new Set(['transparent', 'current', 'inherit', 'white', 'black']);
for (const match of css.matchAll(/--color-([a-z0-9-]+)\s*:/g)) defined.add(match[1]);

// Colour-bearing utility families. Value may carry an opacity modifier (/50) and
// may be preceded by variant prefixes (hover:, dark:, data-[..]:). The token is
// captured whole, including its hyphens (fg-muted, border-strong).
const FAMILIES = [
  'bg',
  'text',
  'border',
  'ring',
  'fill',
  'stroke',
  'from',
  'to',
  'via',
  'divide',
  'outline',
  'decoration',
  'shadow',
  'accent',
  'caret',
];
const pattern = new RegExp(
  `(?:^|[\\s:"'\`([{])(?:${FAMILIES.join('|')})-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:/\\d{1,3})?(?=$|[\\s"'\`)\\]}])`,
  'g',
);

// Utilities in these families that are NOT colours — skip them.
const NON_COLOUR = new Set([
  'auto',
  'none',
  'full',
  'px',
  'screen',
  'fit',
  'min',
  'max',
  'clip',
  'ellipsis',
  'left',
  'right',
  'center',
  'justify',
  'start',
  'end',
  'top',
  'bottom',
  'wrap',
  'nowrap',
  'solid',
  'dashed',
  'dotted',
  'double',
  'hidden',
  'balance',
  'pretty',
  'xs',
  'sm',
  'md',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
  '2xs',
  'inner',
]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'routeTree.gen.ts') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    // Only scan source that USES utilities. global.css DEFINES the tokens (and
    // its comments mention examples like bg-red-500), so scanning it would flag
    // its own definitions.
    else if (['.ts', '.tsx', '.html'].includes(extname(path))) out.push(path);
  }
  return out;
}

const offenders = [];
for (const file of walk(srcDir)) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(pattern)) {
    const token = match[1];
    if (NON_COLOUR.has(token) || defined.has(token)) continue;
    // Ignore arbitrary values like bg-[rgb(...)] — the family regex won't match
    // those anyway, but guard against numeric-only leftovers.
    if (/^\d/.test(token)) continue;
    offenders.push({ file: file.replace(root + '/', ''), utility: match[0] });
  }
}

if (offenders.length > 0) {
  console.error('check-tokens: colour utilities naming undefined tokens:\n');
  for (const o of offenders) console.error(`  ${o.file}: ${o.utility}`);
  console.error(
    `\n${offenders.length} offender(s). Define the token in design/global.css or use a semantic one.`,
  );
  process.exit(1);
}

console.log('check-tokens: all colour utilities resolve to defined tokens.');
