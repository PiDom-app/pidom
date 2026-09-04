import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * Renders the app's screens to SVG for the README.
 *
 * The canvas artboards in `build.mjs` are HTML, and nothing on this machine
 * turns HTML into an image. SVG rasterises with `rsvg-convert`, which is here —
 * so the screens are drawn a second time in a format that can become a PNG.
 *
 * Same tokens, same geometry, same type scale as `build.mjs` and as
 * `src/design/global.css`. If a colour changes there it has to change here, and
 * the audit that checks `src/` will not catch it.
 */

const D = {
  bg: '#000000', surface: '#0d0d0d', elevated: '#141414', hover: '#1a1a1a',
  hairline: '#1c1b1a', border: '#262523', borderStrong: '#3d3b38',
  fg: '#e8e6e3', fgMuted: '#8f8d88', fgSubtle: '#6e6c68', fgDisabled: '#4e4d4a',
  primary: '#6a59e8', primaryTint: '#1a1633', destructive: '#eb5757', onPrimary: '#ffffff',
  inset: 'rgba(255,255,255,.05)', page: '#fdfdfc', pageInk: '#1a1a1a', pageRule: '#c9c6c0',
};
const L = {
  bg: '#ffffff', surface: '#fafaf9', elevated: '#ffffff', hover: '#f0efec',
  hairline: '#eceae6', border: '#e2e0dc', borderStrong: '#c6c3be',
  fg: '#171615', fgMuted: '#6e6c68', fgSubtle: '#8f8d88', fgDisabled: '#b0aea9',
  primary: '#6a59e8', primaryTint: '#f0eefd', destructive: '#d0282c', onPrimary: '#ffffff',
  inset: 'rgba(0,0,0,.06)', page: '#fdfdfc', pageInk: '#1a1a1a', pageRule: '#c9c6c0',
};

const FONT = 'Noto Sans, DejaVu Sans, Helvetica, Arial, sans-serif';
const W = 390, H = 844, PAD = 24, R = 6;
const COVER_W = 120, COVER_H = 170, GAP = 14;

/* ── primitives ───────────────────────────────────────────────────── */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function rect(x, y, w, h, fill, r = 0, extra = '') {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${r ? ` rx="${r}"` : ''}${extra}/>`;
}
function text(x, y, s, { size = 12, fill = '#fff', weight = 400, anchor = 'start', ls = 0, op = 1 } = {}) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${ls ? ` letter-spacing="${ls}"` : ''}${op !== 1 ? ` opacity="${op}"` : ''}>${esc(s)}</text>`;
}
/** SVG has no wrapping. Break on width, at a space where one is near. */
function wrap(s, size, width, lines) {
  const per = size * 0.54;
  const max = Math.max(4, Math.floor(width / per));
  const out = [];
  let rest = String(s);
  while (rest.length > 0 && out.length < lines) {
    if (rest.length <= max) { out.push(rest); break; }
    if (out.length === lines - 1) { out.push(rest.slice(0, max - 1) + '…'); break; }
    let cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return out;
}
function block(x, y, s, { size = 12, fill = '#fff', weight = 400, width = 120, lines = 2, lh = 16 } = {}) {
  return wrap(s, size, width, lines)
    .map((line, i) => text(x, y + i * lh, line, { size, fill, weight }))
    .join('');
}

const ICONS = {
  search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16M21 21l-4.3-4.3',
  chevronRight: 'm9 18 6-6-6-6', chevronLeft: 'm15 18-6-6 6-6', arrowLeft: 'm12 19-7-7 7-7M19 12H5',
  plus: 'M5 12h14M12 5v14', more: 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2M19 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2M5 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2',
  check: 'M20 6 9 17l-5-5',
  heart: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6',
  folderPlus: 'M12 10v6M9 13h6M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
  pencil: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zm-6.174-1.812 4 4',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
  book: 'M12 7v14M16 12h2M16 8h2M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3zM8 12h2M8 8h2',
  cloudUp: 'M12 13v8M8 17l4-4 4 4M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25',
  cloudDown: 'M12 13v8M8 17l4 4 4-4M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25',
  cloudOff: 'm2 2 20 20M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07',
  phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM12 18h.01',
  sort: 'm21 16-4 4-4-4M17 20V4m-14 4 4-4 4 4M7 4v16',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  list: 'M3 6h.01M3 12h.01M3 18h.01M8 6h13M8 12h13M8 18h13',
  filePlus: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M12 18v-6m-3 3 3-3 3 3',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M12 16v-4M12 8h.01',
  check2: 'M20 6 9 17l-5-5', rotate: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  settings: 'M20 7h-9M14 17H5M17 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6M7 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  logout: 'm16 17 5-5-5-5M21 12H9M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4',
  folder: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
  x: 'M18 6 6 18M6 6l12 12',
  listTree: 'M21 12h-8M21 6H8M21 18h-8M3 6v4c0 1.1.9 2 2 2h3M3 10v6c0 1.1.9 2 2 2h3',
  rows3: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2M21 9H3M21 15H3',
  rectangleVertical: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2',
  columns2: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2M12 3v18',
  maximize: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  target: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  chevronUp: 'm18 15-6-6-6 6',
  chevronDown: 'm6 9 6 6 6-6',
};
function icon(name, x, y, size, color, sw = 1.75) {
  const s = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${color}" stroke-width="${sw / s}" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]}"/></g>`;
}

/* ── document data, matching the canvas ───────────────────────────── */
const DOCS = [
  { t: 'Thinking, Fast and Slow', a: 'Daniel Kahneman', p: 499, page: 216, size: '4.1 MB' },
  { t: 'The Design of Everyday Things', a: 'Don Norman', p: 368, page: 261, size: '9.7 MB' },
  { t: 'Convex Backend Architecture', a: null, p: 84, page: 15, size: '1.2 MB' },
  { t: 'Designing Data-Intensive Applications', a: 'Martin Kleppmann', p: 613, page: 88, size: '12.4 MB' },
  { t: 'Sapiens: A Brief History of Humankind', a: 'Yuval Noah Harari', p: null, size: '6.8 MB' },
  { t: 'React Native Performance Notes', a: null, p: null, size: '380 KB' },
  { t: 'Annual Report 2025', a: null, p: null, size: '2.4 MB' },
  { t: 'The Pragmatic Programmer', a: 'Hunt & Thomas', p: 352, size: '3.3 MB' },
  { t: 'Domain-Driven Design', a: 'Eric Evans', p: 560, page: 560, size: '8.1 MB' },
  { t: 'Lease Agreement — 14 Kilimani Road', a: null, p: 9, size: '210 KB' },
  { t: 'Kubernetes Up and Running', a: 'Burns & Beda', p: 278, page: 34, size: '7.2 MB' },
];
const doc = (t) => DOCS.find((d) => d.t.startsWith(t));

/* ── composite pieces ─────────────────────────────────────────────── */
/** A rendered first page — what the cover generator actually produces. */
function pageCover(d, x, y, w, c) {
  const h = Math.round(w * (COVER_H / COVER_W));
  const s = w / COVER_W;
  let o = rect(x, y, w, h, c.page, R);
  o += block(x + 12 * s, y + 30 * s, d.t, { size: 11 * s, fill: c.pageInk, weight: 700, width: w - 24 * s, lines: 2, lh: 13 * s });
  if (d.a && w > 60) o += text(x + 12 * s, y + 60 * s, d.a, { size: 7 * s, fill: '#6e6c68' });
  for (let i = 0; i < 9; i++) {
    const rw = (i % 4 === 3 ? 58 : 92) * s;
    o += rect(x + 12 * s, y + (78 + i * 9) * s, rw, Math.max(1, 1.6 * s), c.pageRule);
  }
  o += `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="${R}" fill="none" stroke="${c.inset}"/>`;
  return o;
}

/** The one document tile every rail draws. */
function tile(d, x, y, c, { w = COVER_W, progress = false, meta = null, dim = false, glyph = null } = {}) {
  const h = Math.round(w * (COVER_H / COVER_W));
  let o = `<g${dim ? ' opacity="0.45"' : ''}>${pageCover(d, x, y, w, c)}</g>`;
  const titleY = y + h + 8 + 11;
  o += block(x, titleY, d.t, { size: 12, fill: dim ? c.fgDisabled : c.fg, width: w, lines: 2, lh: 16 });
  let my = titleY + 32 + 2;
  if (progress) {
    const pct = d.page && d.p ? d.page / d.p : 0;
    o += rect(x, my, w, 2, c.border, 1) + rect(x, my, Math.round(w * pct), 2, c.primary, 1);
    my += 12;
  } else my += 9;
  const line = meta ?? (d.p ? `PDF · ${d.p} pages` : `PDF · ${d.size}`);
  const gx = glyph ? 12 : 0;
  if (glyph) o += icon(glyph, x, my - 8, 10, dim ? c.fgDisabled : c.fgMuted, 2.4);
  o += text(x + gx, my, line, { size: 10, fill: dim ? c.fgDisabled : c.fgSubtle });
  return o;
}
const tileH = (w = COVER_W, progress = false) => Math.round(w * (COVER_H / COVER_W)) + 8 + 32 + (progress ? 12 : 9) + 5;

function rail(title, y, c, items) {
  let o = text(PAD, y + 14, title, { size: 16, fill: c.fg, weight: 700 });
  let x = PAD;
  for (const it of items) { o += it(x, y + 32); x += COVER_W + GAP; }
  return o;
}

function header(c, name = 'Emmanuel') {
  let o = text(PAD, 34, 'Good evening', { size: 12, fill: c.fgSubtle });
  o += text(PAD, 62, name, { size: 24, fill: c.fg, weight: 700 });
  o += `<circle cx="${W - PAD - 18}" cy="46" r="18" fill="${c.primary}"/>`;
  o += text(W - PAD - 18, 51, 'EG', { size: 13, fill: c.onPrimary, weight: 600, anchor: 'middle' });
  return o;
}
function searchTrigger(c, y = 84) {
  let o = rect(PAD, y, W - PAD * 2, 44, c.surface, R);
  o += `<rect x="${PAD + 0.5}" y="${y + 0.5}" width="${W - PAD * 2 - 1}" height="43" rx="${R}" fill="none" stroke="${c.hairline}"/>`;
  o += icon('search', PAD + 12, y + 13, 18, c.fgSubtle);
  o += text(PAD + 40, y + 27, 'Search your library', { size: 14, fill: c.fgSubtle });
  return o;
}

function svg(body, { w = W, h = H, bg } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="${bg}"/>
${body}
</svg>`;
}

/* ── the screens ──────────────────────────────────────────────────── */
const screens = {};

function home(c) {
  let o = header(c) + searchTrigger(c);
  let y = 152;
  o += rail('Continue reading', y, c, [
    (x, yy) => tile(doc('Thinking,'), x, yy, c, { progress: true, meta: '42% · page 216 of 499' }),
    (x, yy) => tile(doc('The Design of'), x, yy, c, { progress: true, meta: '71% · page 261 of 368' }),
    (x, yy) => tile(doc('Convex Backend'), x, yy, c, { progress: true, meta: '18% · page 15 of 84' }),
  ]);
  y += 32 + tileH(COVER_W, true) + 26;
  o += rail('Recently added', y, c, [
    (x, yy) => tile(doc('Annual Report'), x, yy, c, { meta: 'PDF · 2.4 MB' }),
    (x, yy) => tile(doc('Lease Agreement'), x, yy, c),
    (x, yy) => tile(doc('Sapiens'), x, yy, c, { dim: true, glyph: 'cloudDown', meta: 'In your account · 6.8 MB' }),
  ]);
  y += 32 + tileH() + 26;
  o += rail('Favourites', y, c, [
    (x, yy) => tile(doc('The Design of'), x, yy, c),
    (x, yy) => tile(doc('The Pragmatic'), x, yy, c),
    (x, yy) => tile(doc('Designing Data'), x, yy, c),
  ]);
  y += 32 + tileH() + 26;
  o += rail('On this device', y, c, [
    (x, yy) => tile(doc('Annual Report'), x, yy, c),
    (x, yy) => tile(doc('Convex Backend'), x, yy, c),
    (x, yy) => tile(doc('Lease Agreement'), x, yy, c),
  ]);
  return svg(o, { h: 1290, bg: c.bg });
}
screens['home-dark'] = home(D);
screens['home-light'] = home(L);

screens['empty'] = (() => {
  const c = D;
  let o = header(c) + searchTrigger(c);
  o += icon('book', W / 2 - 20, 330, 40, c.fgSubtle, 1.5);
  o += text(W / 2, 410, 'Nothing here yet', { size: 20, fill: c.fg, weight: 700, anchor: 'middle' });
  wrap('Import a PDF and it stays on this device — readable with no connection, and your place is kept on every device you sign in to.', 14, 290, 4)
    .forEach((l, i) => { o += text(W / 2, 438 + i * 21, l, { size: 14, fill: c.fgMuted, anchor: 'middle' }); });
  o += rect(W / 2 - 78, 540, 156, 44, c.primary, R);
  o += icon('filePlus', W / 2 - 58, 553, 18, c.onPrimary, 2);
  o += text(W / 2 + 14, 568, 'Import PDF', { size: 14, fill: c.onPrimary, weight: 500, anchor: 'middle' });
  return svg(o, { bg: c.bg });
})();

screens['loading'] = (() => {
  const c = D;
  let o = header(c) + searchTrigger(c);
  const bone = (x, y, w, h) => rect(x, y, w, h, c.hover, R);
  let y = 152;
  for (const label of ['Continue reading', 'Recently added']) {
    o += text(PAD, y + 14, label, { size: 16, fill: c.fg, weight: 700 });
    let x = PAD;
    for (let i = 0; i < 3; i++) {
      o += bone(x, y + 32, COVER_W, COVER_H) + bone(x, y + 32 + COVER_H + 8, COVER_W, 12)
         + bone(x, y + 32 + COVER_H + 26, 80, 12) + bone(x, y + 32 + COVER_H + 46, 60, 10);
      x += COVER_W + GAP;
    }
    y += 32 + tileH() + 26;
  }
  return svg(o, { bg: c.bg });
})();

screens['reader'] = (() => {
  const c = D;
  const d = doc('Thinking,');
  const pct = 142 / d.p;
  let o = rect(0, 0, W, H, c.page);
  // The chrome overlays the page, so the text starts below it. Drawn at 78 the
  // running head sat underneath the top bar.
  o += text(40, 138, 'PART II · HEURISTICS AND BIASES', { size: 9, fill: '#8f8d88', ls: 1.2 });
  o += text(40, 176, 'The Law of Small Numbers', { size: 15, fill: c.pageInk, weight: 700 });
  for (let i = 0; i < 40; i++) {
    const w = i % 7 === 6 ? 160 : i % 5 === 4 ? 270 : 310;
    o += rect(40, 200 + i * 14, w, 2, c.pageRule);
  }
  o += rect(0, 0, W, 96, c.bg) + rect(0, 96, W, 1, c.hairline);
  o += icon('arrowLeft', PAD, 54, 22, c.fg, 2);
  o += block(PAD + 34, 62, d.t, { size: 14, fill: c.fg, weight: 600, width: 220, lines: 1, lh: 16 });
  o += icon('listTree', W - PAD - 52, 55, 20, c.fg, 2);
  o += icon('more', W - PAD - 20, 55, 20, c.fg, 2);
  o += rect(0, H - 88, W, 1, c.hairline) + rect(0, H - 87, W, 87, c.bg);
  // The page count is a control: tapping it is how you reach page 438.
  o += text(PAD, H - 56, `142 of ${d.p}`, { size: 12, fill: c.fgMuted });
  o += text(W - PAD - 26, H - 56, `${Math.round(pct * 100)}%`, { size: 12, fill: c.fgSubtle, anchor: 'end' });
  o += icon('rows3', W - PAD - 16, H - 66, 16, c.fgMuted);
  o += rect(PAD, H - 44, W - PAD * 2, 2, c.border, 1) + rect(PAD, H - 44, Math.round((W - PAD * 2) * pct), 2, c.primary, 1);
  return svg(o, { bg: c.page });
})();


/** A dimmed screen with a sheet over it. */
function sheet(c, behind, rows, { title = null, sub = null, cover = null, h = 940 } = {}) {
  const sheetH = 70 + (title ? 74 : 0) + rows.length * 52 + 34;
  const top = h - sheetH;
  let o = behind;
  o += rect(0, 0, W, h, 'rgba(0,0,0,.62)');
  o += rect(0, top, W, sheetH, c.elevated, R);
  o += rect(0, top + sheetH - 12, W, 12, c.elevated);
  o += rect(W / 2 - 18, top + 10, 36, 4, c.borderStrong, 2);
  let y = top + 26;
  if (title) {
    if (cover) o += pageCover(cover, PAD, y, 44, c);
    o += block(PAD + (cover ? 58 : 0), y + 16, title, { size: 15, fill: c.fg, weight: 600, width: 250, lines: 1, lh: 18 });
    if (sub) o += text(PAD + (cover ? 58 : 0), y + 36, sub, { size: 12, fill: c.fgSubtle });
    y += 74;
    o += rect(0, y - 8, W, 1, c.hairline);
  }
  for (const [ic, label, danger] of rows) {
    if (ic === null) { o += rect(0, y + 24, W, 1, c.hairline); y += 8; continue; }
    o += icon(ic, PAD, y + 14, 19, danger ? c.destructive : c.fgMuted);
    o += text(PAD + 34, y + 30, label, { size: 16, fill: danger ? c.destructive : c.fg });
    y += 52;
  }
  return svg(o, { h, bg: c.bg });
}

function homeBehind(c) {
  let o = header(c) + searchTrigger(c);
  o += rail('Continue reading', 152, c, [
    (x, y) => tile(doc('Thinking,'), x, y, c, { progress: true, meta: '42% · page 216 of 499' }),
    (x, y) => tile(doc('The Design of'), x, y, c, { progress: true, meta: '71% · page 261 of 368' }),
    (x, y) => tile(doc('Convex Backend'), x, y, c, { progress: true, meta: '18% · page 15 of 84' }),
  ]);
  return o;
}

screens['document-actions'] = sheet(D, homeBehind(D), [
  ['check2', 'Mark as finished', false],
  ['folderPlus', 'Add to collection', false],
  ['folder', 'New collection with this', false],
  ['heart', 'Remove from favourites', false],
  ['cloudUp', 'Make available on all devices', false],
  ['pencil', 'Rename', false],
  ['info', 'Details', false],
  ['share', 'Share a copy', false],
  [null, null, false],
  ['trash', 'Delete', true],
], {
  title: 'Thinking, Fast and Slow',
  sub: 'Daniel Kahneman · 42% · page 216 of 499',
  cover: doc('Thinking,'),
  h: 940,
});

screens['account-menu'] = (() => {
  const c = D;
  let o = homeBehind(c);
  o += rect(0, 0, W, H, 'rgba(0,0,0,.45)');
  const mx = W - PAD - 198, my = 66;
  o += rect(mx, my, 198, 186, c.elevated, R);
  o += `<rect x="${mx + 0.5}" y="${my + 0.5}" width="197" height="185" rx="${R}" fill="none" stroke="${c.border}"/>`;
  o += text(mx + 14, my + 24, 'Emmanuel Gichuhi', { size: 13, fill: c.fg, weight: 600 });
  o += text(mx + 14, my + 42, 'egichuhi580@gmail.com', { size: 11, fill: c.fgSubtle });
  o += rect(mx, my + 54, 198, 1, c.hairline);
  const items = [['user', 'Account'], ['settings', 'Settings']];
  let iy = my + 62;
  for (const [ic, label] of items) {
    o += icon(ic, mx + 14, iy + 13, 17, c.fgMuted) + text(mx + 42, iy + 28, label, { size: 14, fill: c.fg });
    iy += 44;
  }
  o += rect(mx, iy + 4, 198, 1, c.hairline);
  o += icon('logout', mx + 14, iy + 22, 17, c.destructive) + text(mx + 42, iy + 37, 'Sign out', { size: 14, fill: c.destructive });
  return svg(o, { bg: c.bg });
})();

function libraryHeader(c, mode) {
  let o = icon('chevronLeft', PAD - 8, 34, 22, c.fg, 2);
  o += text(PAD + 22, 52, 'Library', { size: 20, fill: c.fg, weight: 700 });
  o += icon('sort', W - PAD - 84, 36, 18, c.fg);
  o += rect(W - PAD - 62, 30, 62, 32, c.surface, R);
  o += rect(W - PAD - 60 + (mode === 'grid' ? 0 : 30), 32, 30, 28, c.hover, R);
  o += icon('grid', W - PAD - 55, 39, 16, mode === 'grid' ? c.fg : c.fgSubtle);
  o += icon('list', W - PAD - 25, 39, 16, mode === 'list' ? c.fg : c.fgSubtle);
  return o;
}
function searchField(c, value, y = 76) {
  let o = rect(PAD, y, W - PAD * 2, 44, c.surface, R);
  o += `<rect x="${PAD + 0.5}" y="${y + 0.5}" width="${W - PAD * 2 - 1}" height="43" rx="${R}" fill="none" stroke="${c.primary}"/>`;
  o += icon('search', PAD + 12, y + 13, 18, c.fgMuted);
  o += text(PAD + 40, y + 27, value, { size: 14, fill: c.fg });
  o += rect(PAD + 44 + value.length * 7, y + 13, 1.5, 18, c.primary);
  return o;
}
function chips(c, active, y = 134) {
  const labels = ['All', 'Favourites', 'On this device', 'Finished'];
  let x = PAD, o = '';
  for (const l of labels) {
    const on = l === active;
    const w = 22 + l.length * 6.6;
    o += rect(x, y, w, 36, on ? c.primaryTint : 'none', R);
    o += `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="35" rx="${R}" fill="none" stroke="${on ? c.primary : c.border}"/>`;
    o += text(x + w / 2, y + 23, l, { size: 12, fill: on ? c.primary : c.fgMuted, anchor: 'middle' });
    x += w + 8;
  }
  return o;
}

screens['all-library'] = (() => {
  const c = D, tw = 106;
  let o = libraryHeader(c, 'grid') + searchField(c, 'design') + chips(c, 'All');
  const picks = ['Thinking,', 'The Design of', 'Convex Backend', 'Designing Data', 'Sapiens', 'Annual Report', 'The Pragmatic', 'Kubernetes', 'Domain-Driven'];
  picks.forEach((t, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = PAD + col * (tw + 12), y = 192 + row * (tileH(tw) + 18);
    o += tile(doc(t), x, y, c, { w: tw, dim: i === 4, glyph: i === 4 ? 'cloudDown' : null, meta: i === 4 ? 'In your account' : null });
  });
  return svg(o, { h: 900, bg: c.bg });
})();

screens['collection'] = (() => {
  const c = D, tw = 106;
  let o = icon('chevronLeft', PAD - 8, 34, 22, c.fg, 2);
  o += text(PAD + 22, 50, 'Backend', { size: 20, fill: c.fg, weight: 700 });
  o += text(PAD + 22, 68, '12 documents · 4 on this device', { size: 12, fill: c.fgSubtle });
  o += icon('more', W - PAD - 20, 34, 20, c.fg, 2);
  o += rect(PAD, 92, W - PAD * 2, 44, 'none', R);
  o += `<rect x="${PAD + 0.5}" y="92.5" width="${W - PAD * 2 - 1}" height="43" rx="${R}" fill="none" stroke="${c.border}"/>`;
  o += icon('plus', W / 2 - 56, 105, 17, c.fg, 2);
  o += text(W / 2 + 12, 120, 'Add documents', { size: 14, fill: c.fg, weight: 500, anchor: 'middle' });
  ['Convex Backend', 'Designing Data', 'Kubernetes', 'Domain-Driven', 'The Pragmatic', 'Thinking,'].forEach((t, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    o += tile(doc(t), PAD + col * (tw + 12), 164 + row * (tileH(tw) + 18), c, { w: tw });
  });
  return svg(o, { h: 700, bg: c.bg });
})();

screens['offline'] = (() => {
  const c = D;
  let o = header(c) + searchTrigger(c);
  o += rect(0, 148, W, 1, c.hairline) + rect(0, 149, W, 40, c.surface) + rect(0, 189, W, 1, c.hairline);
  o += icon('cloudOff', PAD, 161, 14, c.fgSubtle, 2);
  o += text(PAD + 22, 174, 'Showing your library as of 2 hours ago', { size: 12, fill: c.fgSubtle });
  o += icon('rotate', W - PAD - 14, 161, 14, c.fgSubtle, 2);
  o += rail('Continue reading', 208, c, [
    (x, y) => tile(doc('Thinking,'), x, y, c, { progress: true, meta: '42% · page 216 of 499' }),
    (x, y) => tile(doc('The Design of'), x, y, c, { progress: true, meta: '71% · page 261 of 368' }),
    (x, y) => tile(doc('Convex Backend'), x, y, c, { progress: true, meta: '18% · page 15 of 84' }),
  ]);
  o += rail('On this device', 208 + 32 + tileH(COVER_W, true) + 26, c, [
    (x, y) => tile(doc('Annual Report'), x, y, c),
    (x, y) => tile(doc('Lease Agreement'), x, y, c),
    (x, y) => tile(doc('Convex Backend'), x, y, c),
  ]);
  return svg(o, { h: 800, bg: c.bg });
})();

function importScreen(variant) {
  const c = D;
  const large = variant === 'large';
  const d = large ? doc('Designing Data') : doc('Thinking,');
  const size = large ? '317 MB' : '4.1 MB';
  let o = text(PAD, 40, 'Cancel', { size: 14, fill: c.fgMuted });
  o += text(W / 2, 40, 'Add to library', { size: 16, fill: c.fg, weight: 600, anchor: 'middle' });
  o += pageCover(d, W / 2 - 66, 66, 132, c);
  let y = 66 + 187 + 20;
  for (const [label, value, muted] of [['TITLE', d.t, false], ['AUTHOR', d.a ?? 'Optional', d.a === null]]) {
    o += text(PAD, y, label, { size: 11, fill: c.fgSubtle, weight: 600, ls: 0.6 });
    o += rect(PAD, y + 8, W - PAD * 2, 44, 'none', R);
    o += `<rect x="${PAD + 0.5}" y="${y + 8.5}" width="${W - PAD * 2 - 1}" height="43" rx="${R}" fill="none" stroke="${c.border}"/>`;
    o += block(PAD + 12, y + 35, value, { size: 14, fill: muted ? c.fgSubtle : c.fg, width: W - PAD * 2 - 24, lines: 1, lh: 16 });
    y += 70;
  }
  o += icon('info', PAD, y - 4, 12, c.fgSubtle, 2);
  o += text(PAD + 18, y + 6, `PDF · ${size}${large ? '' : ' · 499 pages'}`, { size: 12, fill: c.fgSubtle });
  y += 24;
  o += rect(PAD, y, W - PAD * 2, 1, c.hairline);
  y += 18;
  o += icon(large ? 'phone' : 'cloudUp', PAD, y, 19, large ? c.fgDisabled : c.fgMuted);
  o += text(PAD + 34, y + 14, 'Available on all devices', { size: 15, fill: large ? c.fgDisabled : c.fg });
  wrap(large
    ? 'Over the 100 MB limit for syncing, so this one stays on this phone. It still opens here with no connection.'
    : 'Keeps a copy in your account so your other phones can download it.', 12, 250, 3)
    .forEach((l, i) => { o += text(PAD + 34, y + 34 + i * 17, l, { size: 12, fill: c.fgSubtle }); });
  const tx = W - PAD - 44;
  o += `<rect x="${tx}" y="${y + 2}" width="44" height="26" rx="13" fill="${large ? c.border : c.primary}"${large ? ' opacity="0.5"' : ''}/>`;
  o += `<circle cx="${large ? tx + 13 : tx + 31}" cy="${y + 15}" r="10" fill="${large ? c.fgDisabled : '#ffffff'}"/>`;
  o += rect(PAD, H - 82, W - PAD * 2, 48, c.primary, R);
  o += text(W / 2, H - 52, 'Add to library', { size: 15, fill: c.onPrimary, weight: 500, anchor: 'middle' });
  return svg(o, { bg: c.bg });
}
screens['import'] = importScreen('normal');
screens['import-too-large'] = importScreen('large');

/**
 * Home a second after an import.
 *
 * The row is written before the probe runs, so the document is in Recently
 * added with its real title and its real place in the rail while its cover is
 * still being rendered.
 */
screens['home-processing'] = (() => {
  const c = D;
  const d = doc('Kubernetes');
  const bone = (x, y, w, h) => rect(x, y, w, h, c.hover, R);
  const probing = (x, y) => {
    let o = bone(x, y, COVER_W, COVER_H);
    o += block(x, y + COVER_H + 19, d.t, { size: 12, fill: c.fg, width: COVER_W, lines: 2, lh: 16 });
    o += text(x, y + COVER_H + 8 + 32 + 11, 'Preparing…', { size: 10, fill: c.fgSubtle });
    return o;
  };

  let o = header(c) + searchTrigger(c);
  o += rail('Recently added', 152, c, [
    probing,
    (x, y) => tile(doc('Annual Report'), x, y, c),
    (x, y) => tile(doc('Lease Agreement'), x, y, c),
  ]);
  o += rail('Continue reading', 152 + 32 + tileH() + 28, c, [
    (x, y) => tile(doc('Thinking,'), x, y, c, { progress: true, meta: '42% · page 216 of 499' }),
    (x, y) => tile(doc('The Design of'), x, y, c, { progress: true, meta: '71% · page 261 of 368' }),
    (x, y) => tile(doc('Convex Backend'), x, y, c, { progress: true, meta: '18% · page 15 of 84' }),
  ]);

  const ny = 152 + 32 + tileH() + 28 + 32 + tileH(COVER_W, true) + 24;
  o += icon('info', PAD, ny - 2, 13, c.fgSubtle, 2);
  wrap('Kubernetes Up and Running is being read. Its cover, page count and contents land in a second or two; it is already openable.', 12, 300, 3)
    .forEach((l, i) => { o += text(PAD + 20, ny + 9 + i * 17, l, { size: 12, fill: c.fgSubtle }); });
  return svg(o, { bg: c.bg });
})();

/**
 * The document's own table of contents.
 *
 * Read out of the PDF on the same load that produced the cover, so it costs
 * nothing extra and every document that carries one gets it.
 */
screens['contents'] = (() => {
  const c = D;
  const d = doc('Thinking,');
  const entries = [
    ['Part I · Two Systems', 19, 0], ['The Characters of the Story', 30, 1],
    ['Attention and Effort', 39, 1], ['The Lazy Controller', 50, 1],
    ['Part II · Heuristics and Biases', 117, 0], ['The Law of Small Numbers', 142, 1],
    ['Anchors', 152, 1], ['The Science of Availability', 168, 1],
    ['Part III · Overconfidence', 235, 0],
  ];
  const sheetH = 70 + 74 + entries.length * 44 + 34;
  const top = H - sheetH;

  // The page underneath, dimmed by the backdrop the sheet carries.
  let o = rect(0, 0, W, H, c.page);
  o += text(40, 84, 'PART II · HEURISTICS AND BIASES', { size: 9, fill: '#8f8d88', ls: 1.1 });
  o += text(40, 116, 'The Law of Small Numbers', { size: 15, fill: c.pageInk, weight: 700 });
  for (let i = 0; i < 14; i++) {
    o += rect(40, 142 + i * 14, (i % 7 === 6 ? 160 : W - 80), 2, c.pageRule, 1);
  }
  o += rect(0, 0, W, H, 'rgba(0,0,0,.62)');

  o += rect(0, top, W, sheetH, c.elevated, R);
  o += rect(0, top + sheetH - 12, W, 12, c.elevated);
  o += rect(W / 2 - 18, top + 10, 36, 4, c.borderStrong, 2);

  let y = top + 26;
  o += icon('listTree', PAD, y + 8, 18, c.fgMuted);
  o += text(PAD + 30, y + 16, 'Contents', { size: 15, fill: c.fg, weight: 600 });
  o += text(PAD + 30, y + 36, d.t, { size: 12, fill: c.fgSubtle });
  o += text(W - PAD, y + 16, '38 entries', { size: 12, fill: c.fgSubtle, anchor: 'end' });
  y += 74;
  o += rect(0, y - 8, W, 1, c.hairline);

  for (const [title, page, depth] of entries) {
    const current = page === 142;
    if (current) o += rect(0, y, W, 44, c.hover);
    o += block(PAD + depth * 18, y + 27, title, {
      size: depth === 0 ? 15 : 14,
      fill: depth === 0 ? c.fg : c.fgMuted,
      weight: depth === 0 ? 600 : 400,
      width: W - PAD * 2 - depth * 18 - 40, lines: 1, lh: 18,
    });
    o += text(W - PAD, y + 27, String(page), { size: 12, fill: current ? c.primary : c.fgSubtle, anchor: 'end' });
    y += 44;
  }
  return svg(o, { bg: c.bg });
})();

/**
 * How it reads.
 *
 * The sheet the three modes live in. Two pages is shown refused rather than
 * hidden, because a control that vanishes on a small screen reads as a bug to
 * somebody who has seen it on their tablet.
 */
screens['reader-modes'] = (() => {
  const c = D;
  const d = doc('Thinking,');
  let o = rect(0, 0, W, H, c.page);
  o += text(40, 78, 'PART II · HEURISTICS AND BIASES', { size: 9, fill: '#8f8d88', ls: 1.2, op: 0.5 });
  o += text(40, 116, 'The Law of Small Numbers', { size: 15, fill: c.pageInk, weight: 700, op: 0.5 });
  for (let i = 0; i < 24; i++) {
    const w = i % 7 === 6 ? 160 : i % 5 === 4 ? 270 : 310;
    o += rect(40, 140 + i * 14, w, 2, c.pageRule, 0, ' opacity=".5"');
  }
  o += rect(0, 0, W, H, 'rgba(0,0,0,.62)');

  const sheetH = 378;
  const top = H - sheetH;
  o += rect(0, top, W, sheetH, c.elevated, R) + rect(0, top + sheetH - 12, W, 12, c.elevated);
  o += rect(W / 2 - 18, top + 10, 36, 4, c.borderStrong, 2);
  o += icon('book', PAD, top + 30, 18, c.fgMuted);
  o += text(PAD + 30, top + 42, 'How it reads', { size: 15, fill: c.fg, weight: 600 });
  o += text(PAD + 30, top + 60, d.t, { size: 12, fill: c.fgSubtle });
  o += rect(0, top + 74, W, 1, c.hairline);

  const rows = [
    ['rows3', 'Continuous', 'One long scroll, fit to the width of the screen.', true, false],
    ['rectangleVertical', 'One page at a time', 'Swipe sideways. The whole page is always on screen.', false, false],
    ['columns2', 'Two pages', 'Needs a wider screen. Turn a tablet sideways.', false, true],
  ];
  let y = top + 84;
  for (const [ic, label, note, checked, off] of rows) {
    const fg = off ? c.fgDisabled : c.fg;
    o += icon(ic, PAD, y + 12, 19, off ? c.fgDisabled : c.fgMuted);
    o += text(PAD + 34, y + 26, label, { size: 15, fill: fg });
    o += block(PAD + 34, y + 44, note, { size: 12, fill: c.fgSubtle, width: 250, lines: 2, lh: 16 });
    if (checked) o += icon('check', W - PAD - 18, y + 13, 18, c.primary, 2);
    y += 70;
  }
  o += rect(PAD, y + 2, W - PAD * 2, 1, c.hairline);
  o += icon('maximize', PAD, y + 24, 19, c.fgMuted);
  o += text(PAD + 34, y + 38, 'Fit', { size: 15, fill: c.fg });
  o += text(W - PAD, y + 38, 'Width', { size: 13, fill: c.fgSubtle, anchor: 'end' });
  return svg(o, { bg: c.bg });
})();

/**
 * Getting to a page directly.
 *
 * The number, the track and the strip are three ways into one goToPage. The
 * ticks are the document's own contents, so dragging past a chapter is
 * something a reader can feel.
 */
screens['reader-jump'] = (() => {
  const c = D;
  const d = doc('Thinking,');
  let o = rect(0, 0, W, H, c.page);
  o += text(40, 78, 'PART II · HEURISTICS AND BIASES', { size: 9, fill: '#8f8d88', ls: 1.2, op: 0.5 });
  o += text(40, 116, 'The Law of Small Numbers', { size: 15, fill: c.pageInk, weight: 700, op: 0.5 });
  for (let i = 0; i < 24; i++) {
    const w = i % 7 === 6 ? 160 : i % 5 === 4 ? 270 : 310;
    o += rect(40, 140 + i * 14, w, 2, c.pageRule, 0, ' opacity=".5"');
  }
  o += rect(0, 0, W, H, 'rgba(0,0,0,.62)');

  const sheetH = 452;
  const top = H - sheetH;
  o += rect(0, top, W, sheetH, c.elevated, R) + rect(0, top + sheetH - 12, W, 12, c.elevated);
  o += rect(W / 2 - 18, top + 10, 36, 4, c.borderStrong, 2);
  o += icon('target', PAD, top + 30, 18, c.fgMuted);
  o += text(PAD + 30, top + 42, 'Go to page', { size: 15, fill: c.fg, weight: 600 });
  o += text(PAD + 30, top + 60, d.t, { size: 12, fill: c.fgSubtle });
  o += text(W - PAD, top + 48, `of ${d.p}`, { size: 12, fill: c.fgSubtle, anchor: 'end' });
  o += rect(0, top + 74, W, 1, c.hairline);

  o += rect(PAD, top + 92, W - PAD * 2, 48, c.elevated, R, ` stroke="${c.primary}"`);
  o += text(W / 2, top + 124, '438', { size: 20, fill: c.fg, weight: 600, anchor: 'middle' });

  const trackY = top + 172, trackW = W - PAD * 2, at = 0.88;
  o += rect(PAD, trackY, trackW, 4, c.border, 2);
  o += rect(PAD, trackY, Math.round(trackW * at), 4, c.primary, 2);
  for (const t of [0.12, 0.24, 0.47, 0.63, 0.81]) {
    o += rect(PAD + Math.round(trackW * t), trackY - 7, 1, 5, c.borderStrong);
  }
  o += `<circle cx="${PAD + Math.round(trackW * at)}" cy="${trackY + 2}" r="9" fill="${c.primary}"/>`;
  o += text(PAD, trackY + 26, '1', { size: 11, fill: c.fgSubtle });
  o += text(W / 2, trackY + 26, 'ticks are chapters', { size: 11, fill: c.fgSubtle, anchor: 'middle' });
  o += text(W - PAD, trackY + 26, String(d.p), { size: 11, fill: c.fgSubtle, anchor: 'end' });

  // Runs off the right edge on purpose: a strip that stops flush with the
  // screen looks like the whole of it.
  let x = PAD;
  for (const n of [436, 437, 438, 439, 440, 441]) {
    const here = n === 438;
    o += rect(x, trackY + 48, 54, 76, c.page, R, ` stroke="${here ? c.primary : c.border}" stroke-width="${here ? 2 : 1}"`);
    for (let i = 0; i < 5; i++) o += rect(x + 7, trackY + 58 + i * 7, i % 4 === 3 ? 22 : 40, 1.5, c.pageRule);
    o += text(x + 27, trackY + 140, String(n), { size: 10, fill: here ? c.primary : c.fgSubtle, anchor: 'middle' });
    x += 64;
  }
  o += rect(PAD, trackY + 164, W - PAD * 2, 48, c.primary, R);
  o += text(W / 2, trackY + 194, 'Go to page 438', { size: 15, fill: c.onPrimary, weight: 500, anchor: 'middle' });
  return svg(o, { bg: c.bg });
})();

/**
 * Two pages, on a screen wide enough to mean it.
 *
 * Two renderers side by side, because react-native-pdf has no spread of its
 * own. That cost is the reason the mode is gated on width.
 */
screens['reader-spread'] = (() => {
  const c = D;
  const d = doc('Thinking,');
  const SW = 1024, SH = 768;
  let o = rect(0, 0, SW, SH, c.bg);

  o += rect(0, 55, SW, 1, c.hairline);
  o += icon('arrowLeft', PAD, 17, 21, c.fg, 2);
  o += text(PAD + 32, 26, d.t, { size: 14, fill: c.fg, weight: 600 });
  o += text(PAD + 32, 43, 'Daniel Kahneman', { size: 11, fill: c.fgSubtle });
  o += rect(SW - 292, 13, 108, 30, c.bg, R, ` stroke="${c.border}"`);
  o += icon('columns2', SW - 282, 21, 14, c.primary, 2);
  o += text(SW - 262, 33, 'Two pages', { size: 12, fill: c.fg });
  o += icon('listTree', SW - 160, 18, 19, c.fg, 2);
  o += icon('search', SW - 116, 18, 19, c.fg, 2);
  o += icon('more', SW - 44, 18, 19, c.fg, 2);

  const pageW = (SW - PAD * 2 - 10) / 2, pageTop = 70, pageH = SH - 70 - 76;
  for (const [i, n] of [142, 143].entries()) {
    const px = PAD + i * (pageW + 10);
    o += rect(px, pageTop, pageW, pageH, c.page);
    if (i === 0) {
      o += text(px + 46, pageTop + 46, 'PART II · HEURISTICS AND BIASES', { size: 9, fill: '#8f8d88', ls: 1.2 });
      o += text(px + 46, pageTop + 84, 'The Law of Small Numbers', { size: 15, fill: c.pageInk, weight: 700 });
    }
    const from = i === 0 ? pageTop + 108 : pageTop + 46;
    const count = i === 0 ? 37 : 41;
    for (let k = 0; k < count; k++) {
      const w = k % 7 === 6 ? 200 : k % 5 === 4 ? 340 : 390;
      o += rect(px + 46, from + k * 13, w, 2, c.pageRule);
    }
    o += text(px + pageW / 2, pageTop + pageH - 18, String(n), { size: 10, fill: '#8f8d88', anchor: 'middle' });
  }

  o += rect(0, SH - 76, SW, 1, c.hairline);
  o += text(PAD, SH - 40, `142–143 of ${d.p}`, { size: 12, fill: c.fgMuted });
  let sx = PAD + 130;
  for (let n = 138; n <= 149; n++) {
    const here = n === 142 || n === 143;
    o += rect(sx, SH - 66, 40, 56, c.page, R, ` stroke="${here ? c.primary : c.border}" stroke-width="${here ? 2 : 1}"`);
    for (let i = 0; i < 4; i++) o += rect(sx + 5, SH - 58 + i * 6, i % 4 === 3 ? 16 : 30, 1.5, c.pageRule);
    sx += 48;
  }
  o += text(SW - PAD, SH - 40, '29%', { size: 12, fill: c.fgSubtle, anchor: 'end' });
  return svg(o, { w: SW, h: SH, bg: c.bg });
})();

/**
 * Finding a word without leaving the page.
 *
 * The bar takes the top chrome's place — same strip of screen, and somebody
 * searching a document is not also reading its title. The snippet under the
 * field is why this beats a hit count: enough to know whether to go.
 */
screens['reader-find'] = (() => {
  const c = D;
  let o = rect(0, 0, W, H, c.page);
  o += text(40, 178, 'PART II · HEURISTICS AND BIASES', { size: 9, fill: '#8f8d88', ls: 1.2 });
  o += text(40, 216, 'The Law of Small Numbers', { size: 15, fill: c.pageInk, weight: 700 });
  for (let i = 0; i < 36; i++) {
    const w = i % 7 === 6 ? 160 : i % 5 === 4 ? 270 : 310;
    o += rect(40, 240 + i * 14, w, 2, c.pageRule);
  }

  o += rect(0, 0, W, 132, c.bg) + rect(0, 132, W, 1, c.hairline);
  o += rect(PAD - 8, 44, 208, 40, c.bg, R, ` stroke="${c.primary}"`);
  o += text(PAD + 4, 69, 'anchoring', { size: 14, fill: c.fg });
  o += text(258, 69, '3 of 17', { size: 12, fill: c.fgSubtle });
  o += icon('chevronUp', 300, 55, 18, c.fg, 2);
  o += icon('chevronDown', 328, 55, 18, c.fg, 2);
  o += icon('x', 356, 55, 18, c.fg, 2);
  o += text(PAD, 110, 'p.142', { size: 12, fill: c.fgMuted });
  o += text(PAD + 42, 110, '…the law of small numbers and', { size: 12, fill: c.fgSubtle });
  o += text(PAD + 232, 110, 'anchoring', { size: 12, fill: c.fg });
  o += text(PAD + 296, 110, ' effects…', { size: 12, fill: c.fgSubtle });

  o += rect(0, H - 88, W, 1, c.hairline) + rect(0, H - 87, W, 87, c.bg);
  o += text(PAD, H - 56, '142 of 499', { size: 12, fill: c.fgMuted });
  o += text(W - PAD - 26, H - 56, '28%', { size: 12, fill: c.fgSubtle, anchor: 'end' });
  o += icon('rows3', W - PAD - 16, H - 66, 16, c.fgMuted);
  o += rect(PAD, H - 44, W - PAD * 2, 2, c.border, 1) + rect(PAD, H - 44, Math.round((W - PAD * 2) * 0.28), 2, c.primary, 1);
  return svg(o, { bg: c.page });
})();

mkdirSync(new URL('../docs/screens/', import.meta.url), { recursive: true });
for (const [name, body] of Object.entries(screens)) {
  writeFileSync(new URL(`../docs/screens/${name}.svg`, import.meta.url), body);
}
console.log('wrote', Object.keys(screens).length, 'screens:', Object.keys(screens).join(', '));
