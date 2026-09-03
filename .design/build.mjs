import { writeFileSync } from 'node:fs';

/* ------------------------------------------------------------------ *
 * Values lifted verbatim from src/design/global.css and the vendored
 * gluestack components. Nothing here is invented or rounded.
 * ------------------------------------------------------------------ */
const DARK = {
  bg: '#000000', surface: '#0d0d0d', elevated: '#141414', sunken: '#080808', hover: '#1a1a1a',
  hairline: '#1c1b1a', border: '#262523', borderStrong: '#3d3b38',
  fg: '#e8e6e3', fgMuted: '#8f8d88', fgSubtle: '#6e6c68', fgDisabled: '#4e4d4a',
  primary: '#6a59e8', primaryTint: '#1a1633', destructive: '#eb5757', ok: '#3dc280',
  onPrimary: '#ffffff', inset: 'rgba(255,255,255,.05)',
};
const LIGHT = {
  bg: '#ffffff', surface: '#fafaf9', elevated: '#ffffff', sunken: '#f4f3f1', hover: '#f0efec',
  hairline: '#eceae6', border: '#e2e0dc', borderStrong: '#c6c3be',
  fg: '#171615', fgMuted: '#6e6c68', fgSubtle: '#8f8d88', fgDisabled: '#b0aea9',
  primary: '#6a59e8', primaryTint: '#f0eefd', destructive: '#d0282c', ok: '#168f59',
  onPrimary: '#ffffff', inset: 'rgba(0,0,0,.06)',
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const R = '6px';                       // every corner, per global.css
const PAD = 24;                        // Screen px-6
const GAP = 14;                        // rail gap
const COVER_W = 120, COVER_H = 170;    // 1 : 1.417, a page

/* Deterministic cover tint: the same hash the implementation will use.
   12 buckets 30 degrees apart, anchored on the brand purple's hue. */
const BASE_HUE = 282;
function hashOf(s) { let h = 0; for (const c of s) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0; return h; }
function hueOf(s, base = BASE_HUE) { return (base + (hashOf(s) % 12) * 30) % 360; }
const coverBg = (h, dark) => dark ? `oklch(0.295 0.062 ${h})` : `oklch(0.925 0.045 ${h})`;
const coverFg = (h, dark) => dark ? `oklch(0.900 0.045 ${h})` : `oklch(0.400 0.105 ${h})`;

/* ------------------------------------------------------------------ */
const icons = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  folderPlus: '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
  bookOpen: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  bookOpenText: '<path d="M12 7v14"/><path d="M16 12h2"/><path d="M16 8h2"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/><path d="M8 12h2"/><path d="M8 8h2"/>',
  cloudOff: '<path d="m2 2 20 20"/><path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"/><path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07"/>',
  cloudUp: '<path d="M12 13v8"/><path d="m8 17 4-4 4 4"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>',
  cloudDown: '<path d="M12 13v8"/><path d="m8 17 4 4 4-4"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>',
  cloudCheck: '<path d="m17 15-5.5 5.5L9 18"/><path d="M5 17.743A7 7 0 1 1 15.71 10h1.79a4.5 4.5 0 0 1 1.5 8.742"/>',
  phone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  check2: '<path d="M20 6 9 17l-5-5"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  sort: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  logOut: '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  filePlus: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3-3 3 3"/>',
};
const icon = (name, size, color, sw = 1.75) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto;display:block">${icons[name]}</svg>`;

/* ------------------------------------------------------------------ */
const DOCS = [
  { t: 'Thinking, Fast and Slow', a: 'Daniel Kahneman', p: 499, page: 216, size: '4.1 MB' },
  { t: 'The Design of Everyday Things', a: 'Don Norman', p: 368, page: 261, size: '9.7 MB' },
  { t: 'Convex Backend Architecture', a: null, p: 84, page: 15, size: '1.2 MB' },
  { t: 'Designing Data-Intensive Applications', a: 'Martin Kleppmann', p: 613, page: 88, size: '12.4 MB' },
  { t: 'Sapiens: A Brief History of Humankind', a: 'Yuval Noah Harari', p: null, size: '6.8 MB' },
  { t: 'React Native Performance Notes', a: null, p: null, size: '380 KB' },
  { t: 'Annual Report 2025', a: 'Kilimani Housing Co-op', p: null, size: '2.4 MB' },
  { t: 'The Pragmatic Programmer', a: 'Hunt & Thomas', p: 352, size: '3.3 MB' },
  { t: 'Domain-Driven Design', a: 'Eric Evans', p: 560, page: 560, size: '8.1 MB' },
  { t: 'Lease Agreement — 14 Kilimani Road', a: null, p: 9, size: '210 KB' },
  { t: 'Structure and Interpretation of Computer Programs', a: 'Abelson & Sussman', p: 657, page: 657, size: '5.6 MB' },
  { t: 'Kubernetes Up and Running', a: 'Burns, Beda & Hightower', p: 278, page: 34, size: '7.2 MB' },
];
const byTitle = (t) => DOCS.find((d) => d.t.startsWith(t));

/* -------------------------- building blocks ----------------------- */
function cover(doc, { w = COVER_W, h = COVER_H, dark = true, dim = false, base = BASE_HUE } = {}) {
  const hue = hueOf(doc.t, base);
  const scale = w / COVER_W;
  const fs = Math.max(7, 12.5 * scale);
  return `<div style="position:relative;width:${w}px;height:${h}px;flex:0 0 auto;border-radius:${R};overflow:hidden;background:${coverBg(hue, dark)};box-shadow:inset 0 0 0 1px ${dark ? DARK.inset : LIGHT.inset};${dim ? 'opacity:.4;' : ''}">
      <div style="position:absolute;left:${10 * scale}px;right:${10 * scale}px;top:${10 * scale}px;font-size:${fs.toFixed(1)}px;line-height:1.26;font-weight:600;letter-spacing:-.01em;color:${coverFg(hue, dark)};" class="c5 pretty">${doc.t}</div>
      ${w >= 70 ? `<div style="position:absolute;right:${8 * scale}px;bottom:${7 * scale}px;font-size:${(8 * scale).toFixed(1)}px;font-weight:600;letter-spacing:.09em;opacity:.48;color:${coverFg(hue, dark)}">PDF</div>` : ''}
    </div>`;
}

/** The one document component. Every rail and both library modes draw this. */
function tile(doc, { dark = true, showProgress = false, offline = false, finished = false, w = COVER_W, real = false } = {}) {
  const c = dark ? DARK : LIGHT;
  const pct = doc.page && doc.p ? Math.round((doc.page / doc.p) * 100) : 0;
  const meta = finished
    ? `Finished · ${doc.p} pages`
    : offline
      ? 'Not on this device'
      : doc.p
        ? `PDF · ${doc.p} pages`
        : `PDF · ${doc.size}`;
  return `<div style="width:${w}px;flex:0 0 auto">
      ${real
        ? (offline ? `<div style="opacity:.4">${pageCover(doc, { w })}</div>` : pageCover(doc, { w }))
        : cover(doc, { dark, dim: offline, w, h: Math.round(w * (COVER_H / COVER_W)) })}
      <div style="margin-top:8px;font-size:12px;line-height:16px;letter-spacing:-.006em;color:${offline ? c.fgDisabled : c.fg};" class="c2">${doc.t}</div>
      ${showProgress ? `<div style="margin-top:7px;height:2px;border-radius:${R};background:${c.border};overflow:hidden"><div style="width:${pct}%;height:100%;border-radius:${R};background:${c.primary}"></div></div>` : ''}
      <div style="margin-top:${showProgress ? 5 : 4}px;display:flex;align-items:center;gap:5px;font-size:10px;line-height:13px;color:${offline ? c.fgDisabled : c.fgSubtle}">
        ${offline ? icon('cloudOff', 11, c.fgDisabled, 2) : ''}${showProgress ? `${pct}% · page ${doc.page} of ${doc.p}` : meta}
      </div>
    </div>`;
}

function railHeading(text, c) {
  return `<div style="padding:0 ${PAD}px;font-size:16px;line-height:20px;font-weight:700;letter-spacing:-.014em;color:${c.fg}">${text}</div>`;
}
function rail(text, items, c) {
  return `<section style="margin-top:28px">
      ${railHeading(text, c)}
      <div style="margin-top:12px;display:flex;gap:${GAP}px;padding:0 ${PAD}px;overflow:hidden">${items.join('')}</div>
    </section>`;
}

function collectionTile(name, count, titles, c, dark) {
  return `<div style="width:148px;flex:0 0 auto">
      <div style="display:flex;gap:4px">${titles.map((t) => cover(byTitle(t), { dark, w: 34, h: 48 })).join('')}</div>
      <div style="margin-top:9px;font-size:13px;line-height:17px;letter-spacing:-.008em;color:${c.fg}">${name}</div>
      <div style="margin-top:3px;font-size:10px;color:${c.fgSubtle}">${count} documents</div>
    </div>`;
}

function header(c, { greeting = 'Good evening', name = 'Emmanuel' } = {}) {
  return `<div style="padding:20px ${PAD}px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:16px">
      <div>
        <div style="font-size:12px;line-height:16px;color:${c.fgSubtle}">${greeting}</div>
        <div style="margin-top:2px;font-size:24px;line-height:30px;font-weight:700;letter-spacing:-.02em;color:${c.fg}">${name}</div>
      </div>
      ${avatar(c, 36)}
    </div>`;
}
function avatar(c, size) {
  return `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${c.primary};display:flex;align-items:center;justify-content:center;flex:0 0 auto;font-size:${Math.round(size * 0.36)}px;font-weight:600;color:${c.onPrimary};letter-spacing:.01em">EG</div>`;
}
function searchTrigger(c) {
  return `<div style="margin:20px ${PAD}px 0;height:44px;display:flex;align-items:center;gap:10px;padding:0 12px;border-radius:${R};background:${c.surface};box-shadow:inset 0 0 0 1px ${c.hairline}">
      ${icon('search', 18, c.fgSubtle)}
      <span style="font-size:14px;color:${c.fgSubtle}">Search your library</span>
    </div>`;
}
function viewAll(c) {
  return `<div style="margin-top:24px;padding-top:1px;background:${c.hairline}">
      <div style="background:${c.bg};display:flex;align-items:center;justify-content:center;gap:6px;height:56px">
        <span style="font-size:14px;font-weight:500;color:${c.primary}">View all library</span>
        ${icon('chevronRight', 16, c.primary, 2)}
      </div>
      <div style="height:1px;background:${c.hairline}"></div>
      <div style="background:${c.bg};display:flex;align-items:center;justify-content:center;gap:8px;height:56px">
        ${icon('filePlus', 16, c.fgMuted)}
        <span style="font-size:14px;color:${c.fgMuted}">Import PDF</span>
      </div>
    </div>`;
}

/**
 * A rendered first page.
 *
 * The tinted covers elsewhere are the fallback; this is what
 * react-native-pdf + view-shot produces, so it is drawn as a real page: white,
 * a title block, and ruled body text.
 */
function pageCover(doc, { w = COVER_W } = {}) {
  const h = Math.round(w * (COVER_H / COVER_W));
  const s = w / COVER_W;
  const rule = (width, top) =>
    `<div style="position:absolute;left:${14 * s}px;top:${top * s}px;width:${width * s}px;height:${1.6 * s}px;background:#c9c6c0"></div>`;
  let body = '';
  for (let i = 0; i < 9; i++) {
    body += rule(i % 4 === 3 ? 58 : 92, 78 + i * 9);
  }
  return `<div style="position:relative;width:${w}px;height:${h}px;flex:0 0 auto;border-radius:${R};overflow:hidden;background:#fdfdfc;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)">
      <div style="position:absolute;left:${14 * s}px;right:${14 * s}px;top:${28 * s}px;font-size:${11 * s}px;line-height:1.2;font-weight:700;letter-spacing:-.01em;color:#1a1a1a" class="c2">${doc.t}</div>
      <div style="position:absolute;left:${14 * s}px;top:${58 * s}px;font-size:${7 * s}px;color:#6e6c68">${doc.a ?? ''}</div>
      ${body}
    </div>`;
}

/* ------------------------------ shell ----------------------------- */
function dc({ w, h, bg, body, helmet = '', script = '' }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
    body { margin: 0; font-family: ${FONT}; -webkit-font-smoothing: antialiased; }
    * { box-sizing: border-box; }
    a { color: #6a59e8; } a:hover { color: #7a6af0; }
    .c2, .c5 { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
    .c2 { -webkit-line-clamp: 2; } .c5 { -webkit-line-clamp: 5; }
    .pretty { text-wrap: pretty; }
    .tnum { font-variant-numeric: tabular-nums; }
${helmet}  </style>
</helmet>
<div style="width:${w}px;min-height:${h}px;background:${bg};overflow:hidden">
${body}
</div>
</x-dc>
${script}
</body>
</html>
`;
}

/* ============================ ARTBOARDS =========================== */

function home(dark) {
  const c = dark ? DARK : LIGHT;
  const t = (title, opts) => tile(byTitle(title), { dark, ...opts });
  const body = `${header(c)}
${searchTrigger(c)}
${rail('Continue reading', [
    t('Thinking,', { showProgress: true, real: true }),
    t('The Design of', { showProgress: true, real: true }),
    t('Convex Backend', { showProgress: true }),
    t('Designing Data', { showProgress: true, real: true }),
  ], c)}
${rail('Recently added', [
    t('Annual Report', { real: true }),
    t('Lease Agreement', { real: true }),
    t('Sapiens', { offline: true, real: true }),
    t('React Native Performance'),
  ], c)}
${rail('Favourites', [t('The Design of'), t('The Pragmatic'), t('Designing Data'), t('Thinking,')], c)}
${rail('On this device', [t('Annual Report'), t('Lease Agreement'), t('Convex Backend'), t('The Pragmatic')], c)}
<section style="margin-top:28px">
  ${railHeading('Collections', c)}
  <div style="margin-top:12px;display:flex;gap:${GAP}px;padding:0 ${PAD}px;overflow:hidden">
    ${collectionTile('Behavioural science', 7, ['Thinking,', 'The Design of', 'Sapiens', 'The Pragmatic'], c, dark)}
    ${collectionTile('Backend', 12, ['Convex Backend', 'Designing Data', 'Kubernetes', 'Domain-Driven'], c, dark)}
    ${collectionTile('Household', 3, ['Lease Agreement', 'Annual Report', 'React Native Performance', 'Sapiens'], c, dark)}
  </div>
</section>
${rail('Finished', [
    t('Domain-Driven', { finished: true }),
    t('Structure and', { finished: true }),
    t('Lease Agreement', { finished: true }),
    t('React Native Performance', { finished: true }),
  ], c)}
${viewAll(c)}`;
  return dc({ w: 390, h: 1960, bg: c.bg, body });
}

function empty() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `${header(c)}
${searchTrigger(c)}
<div style="height:520px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 40px;text-align:center">
  ${icon('bookOpenText', 40, c.fgSubtle, 1.5)}
  <div style="margin-top:20px;font-size:20px;line-height:26px;font-weight:700;letter-spacing:-.018em;color:${c.fg}">Nothing here yet</div>
  <div style="margin-top:8px;max-width:286px;font-size:14px;line-height:21px;color:${c.fgMuted}" class="pretty">Import a PDF and it stays on this device — readable with no connection, and your place is kept on every device you sign in to.</div>
  <div style="margin-top:24px;height:44px;display:flex;align-items:center;gap:8px;padding:0 20px;border-radius:${R};background:${c.primary}">
    ${icon('filePlus', 18, c.onPrimary, 2)}
    <span style="font-size:14px;font-weight:500;color:${c.onPrimary}">Import PDF</span>
  </div>
</div>`,
  });
}

function loading() {
  const c = DARK;
  const bone = (w, h, mt = 0) => `<div style="width:${w};height:${h}px;border-radius:${R};background:${c.hover};${mt ? `margin-top:${mt}px` : ''}"></div>`;
  const boneTile = () => `<div style="width:${COVER_W}px;flex:0 0 auto">${bone(COVER_W + 'px', COVER_H)}${bone('100%', 12, 10)}${bone('68%', 12, 6)}${bone('44%', 10, 8)}</div>`;
  const boneRail = (label) => `<section style="margin-top:28px">${railHeading(label, c)}<div style="margin-top:12px;display:flex;gap:${GAP}px;padding:0 ${PAD}px;overflow:hidden">${boneTile()}${boneTile()}${boneTile()}${boneTile()}</div></section>`;
  return dc({
    w: 390, h: 844, bg: c.bg,
    helmet: `    @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }\n    .bones { animation: pulse 2s cubic-bezier(.4,0,.6,1) infinite }\n`,
    body: `${header(c)}
${searchTrigger(c)}
<div class="bones">${boneRail('Continue reading')}${boneRail('Recently added')}</div>`,
  });
}

function accountMenu() {
  const c = DARK;
  const item = (ic, label, color, danger = false) => `<div style="height:44px;display:flex;align-items:center;gap:10px;padding:0 14px">${icon(ic, 17, danger ? c.destructive : c.fgMuted)}<span style="font-size:14px;color:${danger ? c.destructive : c.fg}">${label}</span></div>`;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden">
${header(c)}
${searchTrigger(c)}
${rail('Continue reading', [
      tile(byTitle('Thinking,'), { showProgress: true }),
      tile(byTitle('The Design of'), { showProgress: true }),
      tile(byTitle('Convex Backend'), { showProgress: true }),
      tile(byTitle('Designing Data'), { showProgress: true }),
    ], c)}
${rail('Recently added', [tile(byTitle('Annual Report')), tile(byTitle('Lease Agreement')), tile(byTitle('Sapiens'), { offline: true }), tile(byTitle('React Native Performance'))], c)}
  <div style="position:absolute;inset:0;background:rgba(0,0,0,.45)"></div>
  <div style="position:absolute;right:${PAD}px;top:66px;width:198px;border-radius:${R};background:${c.elevated};box-shadow:inset 0 0 0 1px ${c.border}, 0 12px 32px rgba(0,0,0,.55);padding:5px 0">
    <div style="padding:9px 14px 7px">
      <div style="font-size:13px;font-weight:600;color:${c.fg}">Emmanuel Gichuhi</div>
      <div style="margin-top:2px;font-size:11px;color:${c.fgSubtle};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">egichuhi580@gmail.com</div>
    </div>
    <div style="height:1px;background:${c.hairline};margin:4px 0"></div>
    ${item('user', 'Account')}
    ${item('settings', 'Settings')}
    <div style="height:1px;background:${c.hairline};margin:4px 0"></div>
    ${item('logOut', 'Sign out', null, true)}
  </div>
</div>`,
  });
}

function documentActions() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  const row = (ic, label, danger = false) => `<div style="height:52px;display:flex;align-items:center;gap:14px;padding:0 ${PAD}px">${icon(ic, 19, danger ? c.destructive : c.fgMuted)}<span style="font-size:16px;color:${danger ? c.destructive : c.fg}">${label}</span></div>`;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden">
${header(c)}
${searchTrigger(c)}
${rail('Continue reading', [
      tile(doc, { showProgress: true }), tile(byTitle('The Design of'), { showProgress: true }),
      tile(byTitle('Convex Backend'), { showProgress: true }), tile(byTitle('Designing Data'), { showProgress: true }),
    ], c)}
${rail('Recently added', [tile(byTitle('Annual Report')), tile(byTitle('Lease Agreement')), tile(byTitle('Sapiens'), { offline: true }), tile(byTitle('React Native Performance'))], c)}
  <div style="position:absolute;inset:0;background:rgba(0,0,0,.62)"></div>
  <div style="position:absolute;left:0;right:0;bottom:0;background:${c.elevated};border-radius:${R} ${R} 0 0;box-shadow:0 -1px 0 ${c.border};padding-bottom:28px">
    <div style="display:flex;justify-content:center;padding:8px 0 4px"><div style="width:36px;height:4px;border-radius:${R};background:${c.borderStrong}"></div></div>
    <div style="display:flex;gap:14px;align-items:center;padding:10px ${PAD}px 14px">
      ${pageCover(doc, { w: 44 })}
      <div style="min-width:0">
        <div style="font-size:15px;line-height:19px;font-weight:600;letter-spacing:-.01em;color:${c.fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${doc.t}</div>
        <div style="margin-top:3px;font-size:12px;color:${c.fgSubtle}">Daniel Kahneman · 42% · page 216 of 499</div>
      </div>
    </div>
    <div style="height:1px;background:${c.hairline}"></div>
    <div style="padding-top:4px">
      ${row('bookOpen', 'Open')}
      ${row('folderPlus', 'Add to collection')}
      ${row('cloudCheck', 'Remove from all devices')}
      ${row('heart', 'Remove from favourites')}
      ${row('pencil', 'Rename')}
      ${row('share', 'Share a copy')}
      <div style="height:1px;background:${c.hairline};margin:4px 0"></div>
      ${row('trash', 'Delete', true)}
    </div>
  </div>
</div>`,
  });
}

function libraryHeader(c, mode) {
  const toggle = (ic, active) => `<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:${R};background:${active ? c.hover : 'transparent'}">${icon(ic, 17, active ? c.fg : c.fgSubtle)}</div>`;
  return `<div style="padding:20px ${PAD}px 0;display:flex;align-items:center;gap:6px">
      <div style="width:36px;height:36px;margin-left:-9px;display:flex;align-items:center;justify-content:center">${icon('chevronLeft', 22, c.fg, 2)}</div>
      <div style="flex:1;font-size:20px;line-height:26px;font-weight:700;letter-spacing:-.018em;color:${c.fg}">Library</div>
      <div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center">${icon('sort', 18, c.fg)}</div>
      <div style="display:flex;gap:2px;padding:2px;border-radius:${R};background:${c.surface}">${toggle('grid', mode === 'grid')}${toggle('list', mode === 'list')}</div>
    </div>`;
}
function searchField(c, value) {
  return `<div style="margin:16px ${PAD}px 0;height:44px;display:flex;align-items:center;gap:10px;padding:0 12px;border-radius:${R};background:${c.surface};box-shadow:inset 0 0 0 1px ${c.primary}">
      ${icon('search', 18, c.fgMuted)}
      <span style="font-size:14px;color:${c.fg}">${value}</span><span style="width:1.5px;height:18px;background:${c.primary}"></span>
    </div>`;
}
function chips(c, active) {
  const chip = (label, on) => `<div style="height:36px;display:flex;align-items:center;padding:0 13px;flex:0 0 auto;border-radius:${R};background:${on ? c.primaryTint : 'transparent'};box-shadow:inset 0 0 0 1px ${on ? c.primary : c.border};font-size:12.5px;color:${on ? c.primary : c.fgMuted}">${label}</div>`;
  const all = ['All', 'Favourites', 'On this device', 'Finished'];
  return `<div style="margin-top:14px;height:44px;display:flex;align-items:center;gap:8px;padding:0 ${PAD}px;overflow:hidden">${all.map((l) => chip(l, l === active)).join('')}</div>`;
}

function allLibraryGrid() {
  const c = DARK, w = 106;
  const picks = ['Thinking,', 'The Design of', 'Convex Backend', 'Designing Data', 'Sapiens', 'Annual Report', 'The Pragmatic', 'Kubernetes', 'Domain-Driven'];
  const mi = (label, on) => `<div style="height:44px;display:flex;align-items:center;justify-content:space-between;padding:0 14px"><span style="font-size:14px;color:${on ? c.fg : c.fgMuted}">${label}</span>${on ? icon('check', 16, c.primary, 2) : ''}</div>`;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden">
${libraryHeader(c, 'grid')}
${searchField(c, 'design')}
${chips(c, 'All')}
<div style="margin-top:18px;padding:0 ${PAD}px;display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:18px 12px">
  ${picks.map((t, i) => tile(byTitle(t), { w, offline: i === 4, showProgress: i < 2 })).join('')}
</div>
  <div style="position:absolute;right:64px;top:56px;width:190px;border-radius:${R};background:${c.elevated};box-shadow:inset 0 0 0 1px ${c.border}, 0 12px 32px rgba(0,0,0,.55);padding:5px 0">
    <div style="padding:9px 14px 5px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">Sort by</div>
    ${mi('Recently added', true)}${mi('Recently opened', false)}${mi('Title', false)}
  </div>
</div>`,
  });
}

function allLibraryList() {
  const c = LIGHT;
  const row = (title, sub, { offline = false, pct = null } = {}) => {
    const d = byTitle(title);
    return `<div style="display:flex;align-items:center;gap:14px;padding:13px ${PAD}px">
      ${cover(d, { dark: false, w: 44, h: 62, dim: offline })}
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;line-height:18px;letter-spacing:-.008em;color:${offline ? c.fgDisabled : c.fg};" class="c2">${d.t}</div>
        <div style="margin-top:4px;display:flex;align-items:center;gap:5px;font-size:11px;color:${offline ? c.fgDisabled : c.fgSubtle}">${offline ? icon('cloudOff', 12, c.fgDisabled, 2) : ''}${sub}</div>
        ${pct === null ? '' : `<div style="margin-top:7px;height:2px;width:120px;border-radius:${R};background:${c.border};overflow:hidden"><div style="width:${pct}%;height:100%;border-radius:${R};background:${c.primary}"></div></div>`}
      </div>
      <div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center">${icon('more', 18, c.fgSubtle, 2)}</div>
    </div>`;
  };
  const rule = `<div style="height:1px;margin-left:${PAD + 58}px;background:${c.hairline}"></div>`;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `${libraryHeader(c, 'list')}
${searchField(c, 'design')}
${chips(c, 'On this device')}
<div style="margin-top:8px">
  ${row('Thinking,', 'Daniel Kahneman · 42% · page 216 of 499', { pct: 43 })}${rule}
  ${row('The Design of', 'Don Norman · 71% · page 261 of 368', { pct: 71 })}${rule}
  ${row('Convex Backend', 'PDF · 84 pages')}${rule}
  ${row('Sapiens', 'Not on this device', { offline: true })}${rule}
  ${row('Annual Report', 'PDF · 2.4 MB')}${rule}
  ${row('Lease Agreement', 'Finished · 9 pages')}
</div>`,
  });
}

function collectionScreen() {
  const c = DARK, w = 106;
  const picks = ['Convex Backend', 'Designing Data', 'Kubernetes', 'Domain-Driven', 'The Pragmatic', 'Structure and'];
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="padding:20px ${PAD}px 0;display:flex;align-items:flex-start;gap:6px">
  <div style="width:36px;height:36px;margin-left:-9px;display:flex;align-items:center;justify-content:center">${icon('chevronLeft', 22, c.fg, 2)}</div>
  <div style="flex:1;padding-top:3px">
    <div style="font-size:20px;line-height:26px;font-weight:700;letter-spacing:-.018em;color:${c.fg}">Backend</div>
    <div style="margin-top:3px;font-size:12px;color:${c.fgSubtle}">12 documents · 4 on this device</div>
  </div>
  <div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center">${icon('more', 19, c.fg, 2)}</div>
</div>
<div style="margin:20px ${PAD}px 0;height:44px;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}">
  ${icon('plus', 17, c.fg, 2)}<span style="font-size:14px;font-weight:500;color:${c.fg}">Add documents</span>
</div>
<div style="margin-top:22px;padding:0 ${PAD}px;display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:18px 12px">
  ${picks.map((t, i) => tile(byTitle(t), { w, showProgress: i < 2, finished: i === 3 })).join('')}
</div>`,
  });
}

function offlineStates() {
  const c = DARK;
  const notice = (glyph, text) => `<div style="margin-top:20px;display:flex;align-items:center;gap:8px;padding:10px ${PAD}px;background:${c.surface};box-shadow:inset 0 1px 0 ${c.hairline}, inset 0 -1px 0 ${c.hairline}">
      ${glyph}<span style="flex:1;font-size:12px;color:${c.fgSubtle}">${text}</span>${icon('refresh', 13, c.fgSubtle, 2)}
    </div>`;
  const t = (title, opts) => tile(byTitle(title), { dark: true, ...opts });
  return dc({
    w: 390, h: 1180, bg: c.bg,
    body: `${header(c)}
${searchTrigger(c)}
${notice(icon('cloudOff', 13, c.fgSubtle, 2), 'Showing your library as of 2 hours ago')}
${rail('Continue reading', [t('Thinking,', { showProgress: true }), t('The Design of', { showProgress: true }), t('Convex Backend', { showProgress: true }), t('Designing Data', { showProgress: true })], c)}
${rail('On this device', [t('Annual Report'), t('Lease Agreement'), t('Convex Backend'), t('The Pragmatic')], c)}
<div style="margin-top:40px;height:1px;background:${c.hairline}"></div>
<div style="padding:40px ${PAD}px 0;text-align:center">
  <div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">And with no cache to fall back on</div>
</div>
<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:36px 40px 0;text-align:center">
  ${icon('cloudOff', 40, c.fgSubtle, 1.5)}
  <div style="margin-top:20px;font-size:20px;line-height:26px;font-weight:700;letter-spacing:-.018em;color:${c.fg}">Can&#39;t reach Pidom</div>
  <div style="margin-top:8px;max-width:286px;font-size:14px;line-height:21px;color:${c.fgMuted}" class="pretty">Your documents are safe on this device. Their titles and your place live in your account, and that is what needs a connection.</div>
  <div style="margin-top:24px;height:44px;display:flex;align-items:center;padding:0 20px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}">
    <span style="font-size:14px;font-weight:500;color:${c.fg}">Try again</span>
  </div>
</div>`,
  });
}

/* --------------------------- import screen ------------------------ */

function importScreen(variant) {
  const c = DARK;
  const doc = variant === 'large' ? byTitle('Designing Data') : byTitle('Thinking,');
  const size = variant === 'large' ? '317 MB' : '4.1 MB';
  const uploading = variant === 'uploading';
  const large = variant === 'large';

  const field = (label, value, muted = false) => `<div style="margin-top:18px">
      <div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">${label}</div>
      <div style="margin-top:7px;height:44px;display:flex;align-items:center;padding:0 12px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}">
        <span style="font-size:14px;color:${muted ? c.fgSubtle : c.fg}">${value}</span>
      </div>
    </div>`;

  const track = large ? c.border : c.primary;
  const knob = large ? 'left:3px' : 'right:3px';

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="height:844px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:20px ${PAD}px 0">
    <span style="font-size:14px;color:${c.fgMuted}">Cancel</span>
    <span style="font-size:16px;font-weight:600;letter-spacing:-.01em;color:${c.fg}">Add to library</span>
    <span style="font-size:14px;color:transparent">Cancel</span>
  </div>

  <div style="flex:1;padding:0 ${PAD}px;overflow:hidden">
    <div style="display:flex;justify-content:center;margin-top:26px">
      ${variant === 'choosing'
        ? `<div style="width:132px;height:187px;border-radius:${R};background:${c.hover};display:flex;align-items:center;justify-content:center">
             <div style="width:22px;height:22px;border-radius:9999px;box-shadow:inset 0 0 0 2px ${c.border};border-top:2px solid ${c.primary}"></div>
           </div>`
        : pageCover(doc, { w: 132 })}
    </div>

    ${field('Title', doc.t)}
    ${field('Author', doc.a ?? 'Optional', doc.a === null)}

    <div style="margin-top:14px;display:flex;align-items:center;gap:6px">
      ${icon('info', 12, c.fgSubtle, 2)}
      <span style="font-size:12px;color:${c.fgSubtle}">PDF · ${size}${variant === 'choosing' ? '' : ` · ${doc.p} pages`}</span>
    </div>

    <div style="margin-top:22px;height:1px;background:${c.hairline}"></div>

    <div style="display:flex;align-items:flex-start;gap:14px;padding:18px 0">
      ${icon(large ? 'phone' : 'cloudUp', 19, large ? c.fgDisabled : c.fgMuted)}
      <div style="flex:1">
        <div style="font-size:15px;color:${large ? c.fgDisabled : c.fg}">Available on all devices</div>
        <div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${
          large
            ? 'Over the 100 MB limit for syncing, so this one stays on this phone. It still opens here with no connection.'
            : 'Keeps a copy in your account so your other phones can download it.'
        }</div>
      </div>
      <div style="width:44px;height:26px;border-radius:9999px;background:${track};position:relative;flex:0 0 auto;margin-top:2px;${large ? 'opacity:.5' : ''}">
        <div style="position:absolute;${knob};top:3px;width:20px;height:20px;border-radius:9999px;background:${large ? c.fgDisabled : '#ffffff'}"></div>
      </div>
    </div>

    ${uploading
      ? `<div style="margin-top:2px">
           <div style="display:flex;align-items:center;justify-content:space-between">
             <span style="font-size:12px;color:${c.fgMuted}">Uploading</span>
             <span style="font-size:12px;color:${c.fgSubtle}" class="tnum">2.1 of 4.1 MB</span>
           </div>
           <div style="margin-top:8px;height:2px;border-radius:${R};background:${c.border};overflow:hidden">
             <div style="width:51%;height:100%;border-radius:${R};background:${c.primary}"></div>
           </div>
         </div>`
      : ''}
  </div>

  <div style="padding:0 ${PAD}px 34px">
    <div style="height:48px;display:flex;align-items:center;justify-content:center;border-radius:${R};background:${variant === 'choosing' ? c.hover : c.primary}">
      <span style="font-size:15px;font-weight:500;color:${variant === 'choosing' ? c.fgDisabled : c.onPrimary}">Add to library</span>
    </div>
  </div>
</div>`,
  });
}

/* --------------------------- sync states -------------------------- */

function syncStates() {
  const c = DARK;

  const state = (label, node, note) => `<div style="width:${COVER_W}px">
      <div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle};margin-bottom:11px">${label}</div>
      ${node}
      <div style="margin-top:10px;font-size:11px;line-height:15px;color:${c.fgSubtle}" class="pretty">${note}</div>
    </div>`;

  // The four cloud-aware tiles, built from the same pieces as DocumentTile.
  const tileWith = (doc, { cover: coverNode, meta, glyph = null, bar = null, dim = false }) =>
    `<div style="width:${COVER_W}px">
      ${coverNode}
      <div style="margin-top:8px;font-size:12px;line-height:16px;letter-spacing:-.006em;color:${dim ? c.fgDisabled : c.fg}" class="c2">${doc.t}</div>
      ${bar === null ? '' : `<div style="margin-top:7px;height:2px;border-radius:${R};background:${c.border};overflow:hidden"><div style="width:${bar}%;height:100%;border-radius:${R};background:${c.primary}"></div></div>`}
      <div style="margin-top:${bar === null ? 4 : 5}px;display:flex;align-items:center;gap:5px;font-size:10px;line-height:13px;color:${dim ? c.fgDisabled : c.fgSubtle}">
        ${glyph ?? ''}<span>${meta}</span>
      </div>
    </div>`;

  return dc({
    w: 900, h: 560, bg: c.bg,
    body: `<div style="padding:36px 40px">
  <div style="font-size:22px;font-weight:700;letter-spacing:-.02em;color:${c.fg}">Where a document is</div>
  <div style="margin-top:6px;max-width:660px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">Four states, and the tile draws all four. A document can be on this phone, in the account but not here yet, arriving, or on this phone and nowhere else. The account and the device are separate facts, and the tile never conflates them.</div>

  <div style="margin-top:34px;display:flex;gap:52px">
    ${state('On this device',
      tileWith(byTitle('Thinking,'), {
        cover: pageCover(byTitle('Thinking,')),
        meta: '42% · page 216 of 499',
        bar: 43,
      }),
      'Synced and downloaded. Opens instantly, with or without a connection.')}

    ${state('In your account',
      tileWith(byTitle('Sapiens'), {
        cover: `<div style="opacity:.45">${pageCover(byTitle('Sapiens'))}</div>`,
        meta: 'In your account · 6.8 MB',
        glyph: icon('cloudDown', 11, c.fgMuted, 2),
        dim: true,
      }),
      'Imported on another phone. Tap to download it here.')}

    ${state('Arriving',
      tileWith(byTitle('Sapiens'), {
        cover: `<div style="opacity:.7">${pageCover(byTitle('Sapiens'))}</div>`,
        meta: '2.9 of 6.8 MB',
        bar: 43,
      }),
      'Downloading. The bar is the transfer, not the reading position.')}

    ${state('On this phone only',
      tileWith(byTitle('Designing Data'), {
        cover: pageCover(byTitle('Designing Data')),
        meta: 'On this phone only',
        glyph: icon('phone', 11, c.fgSubtle, 2),
      }),
      'Over the 100 MB sync limit, or the reader chose not to. Fully usable here.')}
  </div>

  <div style="margin-top:44px;height:1px;background:${c.hairline}"></div>
  <div style="margin-top:24px;max-width:700px;font-size:12px;line-height:18px;color:${c.fgSubtle}" class="pretty">Files live in Cloudflare R2, so the 100 MB limit is a product decision rather than a platform one. Downloads use a URL the server signs after checking ownership, valid for five minutes. The earlier limit was 20 MB and was Convex&#39;s: an HTTP action response is capped there on every plan, so anything larger would have uploaded and then never come back down.</div>
</div>`,
  });
}

/* ------------------------------ reader ---------------------------- */

function reader(withChrome) {
  const c = DARK;
  const doc = byTitle('Thinking,');
  const page = 142;
  const pct = Math.round((page / doc.p) * 100);

  // A page of the book, at reading size. Ruled body type, a running head,
  // a folio — the shape of a page rather than a picture of one.
  let body = '';
  for (let i = 0; i < 26; i++) {
    const w = i % 7 === 6 ? 52 : i % 5 === 4 ? 88 : 100;
    body += `<div style="height:2px;border-radius:1px;background:#c9c6c0;width:${w}%;margin-bottom:12px"></div>`;
  }

  return dc({
    w: 390, h: 844, bg: '#fdfdfc',
    body: `<div style="position:relative;height:844px;overflow:hidden;background:#fdfdfc">
  <div style="padding:64px 40px 0">
    <div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#8f8d88">Part II · Heuristics and Biases</div>
    <div style="margin-top:26px;font-size:15px;line-height:1.5;font-weight:700;color:#1a1a1a">The Law of Small Numbers</div>
    <div style="margin-top:18px">${body}</div>
  </div>
  <div style="position:absolute;left:0;right:0;bottom:26px;text-align:center;font-size:10px;color:#8f8d88">${page}</div>

  ${withChrome
    ? `<div style="position:absolute;left:0;right:0;top:0;height:96px;background:${c.bg};box-shadow:0 1px 0 ${c.hairline}">
         <div style="display:flex;align-items:center;gap:6px;padding:44px ${PAD}px 0">
           ${icon('arrowLeft', 22, c.fg, 2)}
           <div style="flex:1;margin-left:6px;min-width:0">
             <div style="font-size:14px;font-weight:600;letter-spacing:-.01em;color:${c.fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${doc.t}</div>
           </div>
           ${icon('more', 20, c.fg, 2)}
         </div>
       </div>
       <div style="position:absolute;left:0;right:0;bottom:0;height:88px;background:${c.bg};box-shadow:0 -1px 0 ${c.hairline}">
         <div style="padding:16px ${PAD}px 0">
           <div style="display:flex;align-items:center;justify-content:space-between">
             <span style="font-size:12px;color:${c.fgMuted}" class="tnum">${page} of ${doc.p}</span>
             <span style="font-size:12px;color:${c.fgSubtle}" class="tnum">${pct}%</span>
           </div>
           <div style="margin-top:10px;height:2px;border-radius:${R};background:${c.border};overflow:hidden">
             <div style="width:${pct}%;height:100%;border-radius:${R};background:${c.primary}"></div>
           </div>
         </div>
       </div>`
    : `<div style="position:absolute;left:0;right:0;bottom:26px;display:flex;justify-content:center">
         <div style="font-size:10px;color:#b0aea9">tap to show controls</div>
       </div>`}
</div>`,
  });
}

/* ------------------------ the full action sheet ------------------- */

function documentActionsFull() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  const row = (ic, label, danger = false, note = null) =>
    `<div style="min-height:52px;display:flex;align-items:center;gap:14px;padding:8px ${PAD}px">
      ${icon(ic, 19, danger ? c.destructive : c.fgMuted)}
      <div style="flex:1">
        <div style="font-size:16px;color:${danger ? c.destructive : c.fg}">${label}</div>
        ${note === null ? '' : `<div style="margin-top:2px;font-size:11px;color:${c.fgSubtle}">${note}</div>`}
      </div>
    </div>`;

  return dc({
    w: 390, h: 940, bg: c.bg,
    body: `<div style="position:relative;height:940px;overflow:hidden">
  <div style="position:absolute;inset:0;background:rgba(0,0,0,.62)"></div>
  <div style="position:absolute;left:0;right:0;bottom:0;background:${c.elevated};border-radius:${R} ${R} 0 0;box-shadow:0 -1px 0 ${c.border};padding-bottom:28px">
    <div style="display:flex;justify-content:center;padding:8px 0 4px"><div style="width:36px;height:4px;border-radius:${R};background:${c.borderStrong}"></div></div>
    <div style="display:flex;gap:14px;align-items:center;padding:10px ${PAD}px 14px">
      ${pageCover(doc, { w: 44 })}
      <div style="min-width:0">
        <div style="font-size:15px;line-height:19px;font-weight:600;letter-spacing:-.01em;color:${c.fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${doc.t}</div>
        <div style="margin-top:3px;font-size:12px;color:${c.fgSubtle}">Daniel Kahneman · 42% · page 216 of 499</div>
      </div>
    </div>
    <div style="height:1px;background:${c.hairline}"></div>
    <div style="padding-top:4px">
      ${row('bookOpen', 'Open')}
      ${row('check2', 'Mark as finished')}
      ${row('folderPlus', 'Add to collection')}
      ${row('folder', 'New collection with this')}
      ${row('heart', 'Remove from favourites')}
      ${row('cloudCheck', 'Keep on this device only', false, 'Removes the copy in your account')}
      ${row('phone', 'Remove from this device', false, 'Keeps it in your account — 4.1 MB freed')}
      ${row('pencil', 'Rename')}
      ${row('info', 'Details')}
      ${row('share', 'Share a copy')}
      <div style="height:1px;background:${c.hairline};margin:4px 0"></div>
      ${row('trash', 'Delete everywhere', true)}
    </div>
  </div>
</div>`,
  });
}

/* --------------------------- system sheets ------------------------ */
function tileAnatomy() {
  const c = DARK, doc = byTitle('Thinking,');
  const spec = (k, v) => `<tr><td style="padding:7px 26px 7px 0;font-size:13px;color:${c.fgMuted};white-space:nowrap">${k}</td><td style="padding:7px 0;font-size:13px;color:${c.fg};" class="tnum">${v}</td></tr>`;
  const state = (label, node, note) => `<div style="width:${COVER_W}px"><div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle};margin-bottom:11px">${label}</div>${node}<div style="margin-top:10px;font-size:11px;line-height:15px;color:${c.fgSubtle}" class="pretty">${note}</div></div>`;
  return dc({
    w: 900, h: 1100, bg: c.bg,
    body: `<div style="padding:36px 40px">
  <div style="font-size:22px;font-weight:700;letter-spacing:-.02em;color:${c.fg}">Document tile</div>
  <div style="margin-top:6px;max-width:640px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">One component draws every document in the app — both rails, the grid, the list row, and the sheet header. It takes <span style="color:${c.fg}">document</span>, <span style="color:${c.fg}">variant</span>, <span style="color:${c.fg}">showProgress</span> and <span style="color:${c.fg}">showAuthor</span>, and nothing else.</div>
  <div style="margin-top:32px;display:flex;gap:56px;align-items:flex-start">
    <div style="flex:0 0 auto;width:264px;height:480px;overflow:hidden"><div style="transform:scale(2);transform-origin:top left;width:${COVER_W}px">${tile(doc, { showProgress: true })}</div></div>
    <div style="margin-left:0">
      <table style="border-collapse:collapse">
        ${spec('Cover', `${COVER_W} × ${COVER_H} px — 1 : 1.417, a page`)}
        ${spec('Cover radius', '6 px, as everything else')}
        ${spec('Cover inset rule', '1 px rgba(255,255,255,.05)')}
        ${spec('Title', 'text-xs / 12 px · 16 px line · 2 lines, clipped')}
        ${spec('Meta', 'text-2xs / 10 px · fg-subtle #6e6c68')}
        ${spec('Progress bar', `2 px · track ${c.border} · fill ${c.primary}`)}
        ${spec('Gap, cover to title', '8 px')}
        ${spec('Gap between tiles', `${GAP} px`)}
        ${spec('Screen padding', `${PAD} px — Screen px-6`)}
        ${spec('Grid tile', '106 px wide · 3 columns · 12 px gutter')}
        ${spec('List row cover', '44 × 62 px')}
      </table>
      <div style="margin-top:22px;max-width:400px;font-size:12px;line-height:18px;color:${c.fgSubtle}" class="pretty">No badge, no overflow button, no hover chrome. Actions arrive on long press, so a rail of twelve documents carries twelve pieces of chrome fewer than it would otherwise.</div>
    </div>
  </div>
  <div style="margin-top:44px;height:1px;background:${c.hairline}"></div>
  <div style="margin-top:28px;display:flex;gap:52px">
    ${state('Reading', tile(doc, { showProgress: true }), 'Progress bar and exact page. The only state that gets a bar.')}
    ${state('Imported', tile(byTitle('Annual Report')), 'No page count until the reader opens it once, so the size stands in.')}
    ${state('Not on this device', tile(byTitle('Sapiens'), { offline: true }), 'Imported on another phone. Cover at 40%, and it does not open.')}
    ${state('Finished', tile(byTitle('Domain-Driven'), { finished: true }), 'Drops the bar rather than showing a full one.')}
  </div>
</div>`,
  });
}

function coverSystem() {
  const c = DARK;
  const swatch = `<div style="position:relative;width:96px;height:136px;flex:0 0 auto;border-radius:${R};overflow:hidden;background:{{c.bg}};box-shadow:inset 0 0 0 1px {{c.inset}}">
        <div style="position:absolute;left:8px;right:8px;top:8px;font-size:10px;line-height:1.26;font-weight:600;letter-spacing:-.01em;color:{{c.fg}}" class="c5 pretty">{{c.title}}</div>
        <div style="position:absolute;right:6px;bottom:6px;font-size:6.4px;font-weight:600;letter-spacing:.09em;opacity:.48;color:{{c.fg}}">PDF</div>
      </div>`;
  return dc({
    w: 1360, h: 640, bg: c.bg,
    helmet: `    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace }\n`,
    body: `<div style="padding:36px 40px">
  <div style="font-size:22px;font-weight:700;letter-spacing:-.02em;color:${c.fg}">Fallback covers</div>
  <div style="margin-top:6px;max-width:700px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">Import renders the real first page now, so this is the fallback: a document imported before that existed, one whose render failed, or one whose cover has not reached this device yet. The tint is a pure function of the document id — twelve buckets thirty degrees apart, anchored on the brand hue — so the same document is the same colour on every device, for as long as it exists.</div>
  <div class="mono" style="margin-top:14px;font-size:12px;color:${c.fgSubtle}">hue = ({{base}} + hash(id) % 12 × 30) mod 360 &nbsp;·&nbsp; dark oklch(.295 .062 h) &nbsp;·&nbsp; light oklch(.925 .045 h)</div>
  <div style="margin-top:28px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">Dark</div>
  <div style="margin-top:12px;display:flex;gap:10px">
    <sc-for list="{{darkCovers}}" as="c" hint-placeholder-count="12">${swatch}</sc-for>
  </div>
  <div style="margin-top:26px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">Light</div>
  <div style="margin-top:12px;padding:14px;border-radius:${R};background:${LIGHT.bg};display:flex;gap:10px">
    <sc-for list="{{lightCovers}}" as="c" hint-placeholder-count="12">${swatch}</sc-for>
  </div>
</div>`,
    script: `<script data-dc-script data-props='{"base":{"editor":"range","default":282,"min":0,"max":359,"step":1,"unit":"deg","section":"Cover tint"}}'>
class Component extends DCLogic {
  renderVals() {
    const base = this.props.base ?? 282;
    const titles = ${JSON.stringify(DOCS.map((d) => d.t))};
    const hash = (s) => { let h = 0; for (const ch of s) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0; return h; };
    const build = (dark) => titles.map((title) => {
      const h = (base + (hash(title) % 12) * 30) % 360;
      return {
        title: title,
        bg: dark ? 'oklch(0.295 0.062 ' + h + ')' : 'oklch(0.925 0.045 ' + h + ')',
        fg: dark ? 'oklch(0.900 0.045 ' + h + ')' : 'oklch(0.400 0.105 ' + h + ')',
        inset: dark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)',
      };
    });
    return { base: base, darkCovers: build(true), lightCovers: build(false) };
  }
}
</script>`,
  });
}

/* ------------------------------ emit ------------------------------ */
const out = {
  'Main.dc.html': home(true),
  'HomeLight.dc.html': home(false),
  'HomeEmpty.dc.html': empty(),
  'HomeLoading.dc.html': loading(),
  'AccountMenu.dc.html': accountMenu(),
  'DocumentActions.dc.html': documentActions(),
  'AllLibrary.dc.html': allLibraryGrid(),
  'AllLibraryList.dc.html': allLibraryList(),
  'Collection.dc.html': collectionScreen(),
  'ImportChoosing.dc.html': importScreen('choosing'),
  'ImportUploading.dc.html': importScreen('uploading'),
  'ImportTooLarge.dc.html': importScreen('large'),
  'OfflineStates.dc.html': offlineStates(),
  'SyncStates.dc.html': syncStates(),
  'Reader.dc.html': reader(true),
  'ReaderPlain.dc.html': reader(false),
  'DocumentActionsFull.dc.html': documentActionsFull(),
  'TileAnatomy.dc.html': tileAnatomy(),
  'CoverSystem.dc.html': coverSystem(),
};
for (const [name, html] of Object.entries(out)) { writeFileSync(new URL('./' + name, import.meta.url), html); }

const canvas = {
  artboards: [
    { file: 'Main.dc.html', title: 'Home — dark, full scroll', x: 0, y: 0, w: 390, h: 1960 },
    { file: 'HomeLight.dc.html', title: 'Home — light, full scroll', x: 490, y: 0, w: 390, h: 1960 },
    { file: 'HomeEmpty.dc.html', title: 'Home — empty', x: 0, y: 2080, w: 390, h: 844 },
    { file: 'HomeLoading.dc.html', title: 'Home — loading', x: 490, y: 2080, w: 390, h: 844 },
    { file: 'AccountMenu.dc.html', title: 'Account menu', x: 980, y: 2080, w: 390, h: 844 },
    { file: 'DocumentActions.dc.html', title: 'Document actions', x: 1470, y: 2080, w: 390, h: 844 },
    { file: 'AllLibrary.dc.html', title: 'All library — grid, sorting', x: 0, y: 3044, w: 390, h: 844 },
    { file: 'AllLibraryList.dc.html', title: 'All library — list, light', x: 490, y: 3044, w: 390, h: 844 },
    { file: 'Collection.dc.html', title: 'A collection', x: 980, y: 3044, w: 390, h: 844 },
    { file: 'OfflineStates.dc.html', title: 'Offline — cached, and not', x: 1470, y: 3044, w: 390, h: 1180 },
    { file: 'ImportChoosing.dc.html', title: 'Import — choosing', x: 1960, y: 3044, w: 390, h: 844 },
    { file: 'ImportUploading.dc.html', title: 'Import — uploading', x: 2450, y: 3044, w: 390, h: 844 },
    { file: 'ImportTooLarge.dc.html', title: 'Import — over the sync limit', x: 2940, y: 3044, w: 390, h: 844 },
    { file: 'Reader.dc.html', title: 'Reader — controls shown', x: 3430, y: 3044, w: 390, h: 844 },
    { file: 'ReaderPlain.dc.html', title: 'Reader — reading', x: 3920, y: 3044, w: 390, h: 844 },
    { file: 'DocumentActionsFull.dc.html', title: 'Document actions — all of them', x: 4410, y: 3044, w: 390, h: 940 },
    { file: 'SyncStates.dc.html', title: 'Where a document is', x: 0, y: 4344, w: 900, h: 560 },
    { file: 'TileAnatomy.dc.html', title: 'Document tile — anatomy and states', x: 0, y: 5024, w: 900, h: 1100 },
    { file: 'CoverSystem.dc.html', title: 'Generated covers', x: 1000, y: 5024, w: 1360, h: 640 },
  ],
  annotations: [
    { id: 'note-boundary', x: 0, y: -150, w: 880, text: 'Convex owns metadata, the device owns the PDF.\nRendering this screen never touches a file. Every rail below is one query and one index scan; "On this device" is answered by the filesystem, not the server.' },
    { id: 'note-norails', x: 1960, y: 2080, w: 300, text: 'A rail with nothing in it renders nothing — a new account falls through to the empty state rather than showing six empty headings.' },
    { id: 'note-covers', x: 1960, y: 2360, w: 300, text: 'No cards anywhere. The cover is the only filled shape on the surface; sections are separated by whitespace, and the one rule on the screen sits above View all library.' },
  ],
  launch: { view: 'canvas' },
};
writeFileSync(new URL('./canvas.json', import.meta.url), JSON.stringify(canvas, null, 2));
console.log('wrote', Object.keys(out).length, 'artboards + canvas.json');
