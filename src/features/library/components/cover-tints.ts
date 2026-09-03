/**
 * The generated-cover palette.
 *
 * Nothing installed can rasterise page one of a PDF, so a document with no
 * thumbnail gets a cover instead of a grey file icon. The tint is a pure
 * function of the document id, which means the same document is the same colour
 * on every device the reader signs into, for as long as it exists.
 *
 * Twelve buckets, thirty degrees apart, anchored on the brand purple's hue
 * (282°, from `--primary` in `global.css`). Generated from:
 *
 *   dark   oklch(0.295 0.062 h)  on  oklch(0.900 0.045 h)
 *   light  oklch(0.925 0.045 h)  on  oklch(0.400 0.105 h)
 *
 * Baked to hex rather than computed at runtime because React Native's colour
 * parser does not read `oklch()`, and because twelve pairs is a table, not a
 * calculation. To change the ramp, change the formula above and regenerate.
 */

export type CoverTint = { bg: string; fg: string };

const DARK: readonly CoverTint[] = [
  { bg: '#28284a', fg: '#d9dbfc' }, // 282°
  { bg: '#372343', fg: '#e8d6f4' }, // 312°
  { bg: '#411f35', fg: '#f4d3e6' }, // 342°
  { bg: '#461e24', fg: '#fad2d6' }, //  12°
  { bg: '#462112', fg: '#f9d5c7' }, //  42°
  { bg: '#3f2701', fg: '#f1dabe' }, //  72°
  { bg: '#332d00', fg: '#e3e0be' }, // 102°
  { bg: '#21330f', fg: '#d3e5c6' }, // 132°
  { bg: '#033623', fg: '#c5e8d5' }, // 162°
  { bg: '#003634', fg: '#bde8e6' }, // 192°
  { bg: '#003343', fg: '#bfe5f4' }, // 222°
  { bg: '#132e4a', fg: '#c9e1fc' }, // 252°
];

const LIGHT: readonly CoverTint[] = [
  { bg: '#e1e3ff', fg: '#403e7e' }, // 282°
  { bg: '#f0defd', fg: '#5a3470' }, // 312°
  { bg: '#fddbef', fg: '#6c2d57' }, // 342°
  { bg: '#ffdbde', fg: '#752b38' }, //  12°
  { bg: '#ffddcf', fg: '#743012' }, //  42°
  { bg: '#fae2c6', fg: '#693c00' }, //  72°
  { bg: '#ece8c6', fg: '#544800' }, // 102°
  { bg: '#dbedce', fg: '#315309' }, // 132°
  { bg: '#cdf0dd', fg: '#005836' }, // 162°
  { bg: '#c5f0ee', fg: '#005856' }, // 192°
  { bg: '#c7eefc', fg: '#005270' }, // 222°
  { bg: '#d1e9ff', fg: '#13497e' }, // 252°
];

/**
 * A stable 32-bit hash of the document id.
 *
 * Purely presentational — it picks a colour and nothing else, so it never has
 * to agree with anything on the server. What it does have to be is stable: the
 * same id must land on the same bucket on every device and after every update,
 * which is why this is a fixed three-line function and not a library call.
 */
function hashOf(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function coverTint(documentId: string, theme: 'light' | 'dark'): CoverTint {
  const table = theme === 'dark' ? DARK : LIGHT;
  return table[hashOf(documentId) % table.length];
}
