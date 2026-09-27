// Generates the desktop app icons from the shared brand mark.
//
// Source of truth is the mobile app's launcher icon
// (`../assets/images/icon.png`, itself rendered from `../assets/pidom-mark.svg`
// by `../scripts/generate-brand-assets.sh`) — so the desktop icon is the *same*
// glyph the phone shows, not a separate drawing.
//
// Rounded corners: the mobile source is a full-bleed *square* white plate. On
// phones the OS masks that square into a rounded/adaptive shape, so it never
// looks boxy. Windows does NOT do that for app icons — it rounds *window*
// corners automatically, but paints app icons (taskbar, Start, Alt-Tab, title
// bar, shortcut, Add/Remove Programs) exactly as authored. A square source
// therefore shows hard 90° corners next to every rounded Windows 11 icon. So we
// bake the rounding in here: mask the plate to a rounded rectangle before
// emitting the .ico / .png. Microsoft's icon guidance is explicit that shapes
// should carry the icon grid's rounded corners themselves —
// https://learn.microsoft.com/windows/apps/design/style/iconography/app-icon-design
//
// Output (committed, so CI needs no image tooling):
//   icons/icon.ico  — multi-resolution Windows icon (packaged .exe, installer,
//                     shortcut, Add/Remove Programs, and the .pdf association).
//   icons/icon.png  — 512px, for the runtime BrowserWindow icon and the Linux
//                     makers.
//
// Pure JS (jimp + png-to-ico): no ImageMagick/rsvg, no native install scripts,
// runs the same on Windows and Linux. Re-run with `npm run icons` whenever the
// brand mark changes.

import { Jimp } from 'jimp';
import pngToIco from 'png-to-ico';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, '..');
const source = resolve(desktopRoot, '../assets/images/icon.png');
const outDir = resolve(desktopRoot, 'icons');

// The sizes Windows picks between for the taskbar, Explorer views, and the
// installer. 256 is stored PNG-compressed inside the .ico (Vista+).
const icoSizes = [16, 24, 32, 48, 64, 128, 256];

// Work at high resolution, round once, then downscale to each output size — the
// downscale antialiases the corner arc, so every size gets a smooth edge from a
// single crisp mask.
const MASTER = 1024;

// Corner radius as a fraction of the icon's side. 0.2 lands on a modern
// rounded-square that reads as clearly rounded even at 16px (≈3px) without
// collapsing toward a circle at large sizes — in the same family as the
// squircle the mobile OS masks the phone icon into, so the two platforms look
// like one brand.
const CORNER_RADIUS_RATIO = 0.2;

/** True when (x, y) is inside a rounded rectangle of the given size/radius.
 *  Uses the standard rounded-rect signed-distance test: measure how far the
 *  point lies outside the inner (un-rounded) rectangle on each axis, then keep
 *  it only if that offset is within the corner radius. Edges (one axis outside)
 *  and the interior are always kept; only the four corner arcs get clipped. */
function insideRoundedRect(x, y, side, radius) {
  const dx = Math.max(radius - x, x - (side - 1 - radius), 0);
  const dy = Math.max(radius - y, y - (side - 1 - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

/** Load the square brand plate and clip it to a rounded rectangle by zeroing
 *  the alpha outside the mask. The interior (white plate + black glyph) is
 *  untouched, so only the corners become transparent. */
async function roundedMaster() {
  const image = await Jimp.read(source);
  image.resize({ w: MASTER, h: MASTER });

  const radius = Math.round(MASTER * CORNER_RADIUS_RATIO);
  image.scan(0, 0, image.bitmap.width, image.bitmap.height, function scanPixel(x, y, idx) {
    if (!insideRoundedRect(x, y, MASTER, radius)) {
      // Alpha is the 4th byte of each RGBA pixel.
      this.bitmap.data[idx + 3] = 0;
    }
  });

  return image;
}

/** A PNG buffer of the rounded master downscaled to `size`. */
async function pngAt(master, size) {
  const image = master.clone();
  image.resize({ w: size, h: size });
  return image.getBuffer('image/png');
}

await mkdir(outDir, { recursive: true });

const master = await roundedMaster();

const icoBuffers = await Promise.all(icoSizes.map((size) => pngAt(master, size)));
const ico = await pngToIco(icoBuffers);
await writeFile(resolve(outDir, 'icon.ico'), ico);

await writeFile(resolve(outDir, 'icon.png'), await pngAt(master, 512));

console.log(`Wrote icons/icon.ico (${icoSizes.join(', ')}px) and icons/icon.png (512px), corners rounded.`);
