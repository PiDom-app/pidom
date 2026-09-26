// Generates the desktop app icons from the shared brand mark.
//
// Source of truth is the mobile app's launcher icon
// (`../assets/images/icon.png`, itself rendered from `../assets/pidom-mark.svg`
// by `../scripts/generate-brand-assets.sh`) — so the desktop icon is the *same*
// glyph the phone shows, not a separate drawing.
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

async function pngAt(size) {
  const image = await Jimp.read(source);
  image.resize({ w: size, h: size });
  return image.getBuffer('image/png');
}

await mkdir(outDir, { recursive: true });

const icoBuffers = await Promise.all(icoSizes.map(pngAt));
const ico = await pngToIco(icoBuffers);
await writeFile(resolve(outDir, 'icon.ico'), ico);

await writeFile(resolve(outDir, 'icon.png'), await pngAt(512));

console.log(`Wrote icons/icon.ico (${icoSizes.join(', ')}px) and icons/icon.png (512px).`);
