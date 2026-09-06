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
  fileX: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m14.5 12.5-5 5"/><path d="m9.5 12.5 5 5"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  listTree: '<path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/>',
  textSearch: '<path d="M21 6H3"/><path d="M10 12H3"/><path d="M10 18H3"/><circle cx="17" cy="15" r="3"/><path d="m21 19-1.9-1.9"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  share2: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/>',
  scanText: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8h8"/><path d="M7 12h10"/><path d="M7 16h6"/>',
  /* Reader. The three modes are drawn as what they lay out, not as verbs. */
  rows3: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M21 9H3"/><path d="M21 15H3"/>',
  rectangleVertical: '<rect width="12" height="20" x="6" y="2" rx="2"/>',
  columns2: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  externalLink: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  quote: '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
  notebookPen: '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9"/>',
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
function tile(doc, { dark = true, showProgress = false, offline = false, finished = false, w = COVER_W, real = false, processing = null } = {}) {
  const c = dark ? DARK : LIGHT;
  const pct = doc.page && doc.p ? Math.round((doc.page / doc.p) * 100) : 0;
  const meta = processing !== null
    ? { probing: 'Preparing…', partial: `No cover · ${doc.p ?? '—'} pages`, failed: "Couldn't read this one" }[processing]
    : finished
    ? `Finished · ${doc.p} pages`
    : offline
      ? 'Not on this device'
      : doc.p
        ? `PDF · ${doc.p} pages`
        : `PDF · ${doc.size}`;
  return `<div style="width:${w}px;flex:0 0 auto">
      ${processing === 'probing'
        ? `<div class="bones" style="width:${w}px;height:${Math.round(w * (COVER_H / COVER_W))}px;border-radius:${R};background:${c.hover}"></div>`
        : real
          ? (offline ? `<div style="opacity:.4">${pageCover(doc, { w })}</div>` : pageCover(doc, { w }))
          : cover(doc, { dark, dim: offline, w, h: Math.round(w * (COVER_H / COVER_W)) })}
      <div style="margin-top:8px;font-size:12px;line-height:16px;letter-spacing:-.006em;color:${offline ? c.fgDisabled : c.fg};" class="c2">${doc.t}</div>
      ${showProgress ? `<div style="margin-top:7px;height:2px;border-radius:${R};background:${c.border};overflow:hidden"><div style="width:${pct}%;height:100%;border-radius:${R};background:${c.primary}"></div></div>` : ''}
      <div style="margin-top:${showProgress ? 5 : 4}px;display:flex;align-items:center;gap:5px;font-size:10px;line-height:13px;color:${offline ? c.fgDisabled : c.fgSubtle}">
        ${processing === 'failed' ? icon('alert', 11, c.fgSubtle, 2) : offline ? icon('cloudOff', 11, c.fgDisabled, 2) : ''}${showProgress && processing === null ? `${pct}% · page ${doc.page} of ${doc.p}` : meta}
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
  const probing = variant === 'choosing';
  const uploading = variant === 'uploading';
  const large = variant === 'large';
  const duplicate = variant === 'duplicate';

  const field = (label, value, muted = false) => `<div style="margin-top:18px">
      <div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">${label}</div>
      <div style="margin-top:7px;height:44px;display:flex;align-items:center;padding:0 12px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}">
        <span style="font-size:14px;color:${muted ? c.fgSubtle : c.fg}">${value}</span>
      </div>
    </div>`;

  const track = large ? c.border : c.primary;
  const knob = large ? 'left:3px' : 'right:3px';

  /* The one pass over the file yields the cover, the page count and the
     outline together, so the status line names all three rather than the
     spinner standing in for an unexplained wait. */
  const info = probing
    ? 'Checking this PDF…'
    : `PDF · ${size} · ${doc.p} pages${duplicate ? '' : ' · 14 chapters'}`;

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
      ${probing
        ? `<div style="width:132px;height:187px;border-radius:${R};background:${c.hover};display:flex;align-items:center;justify-content:center">
             <div style="width:22px;height:22px;border-radius:9999px;box-shadow:inset 0 0 0 2px ${c.border};border-top:2px solid ${c.primary}"></div>
           </div>`
        : pageCover(doc, { w: 132 })}
    </div>

    ${duplicate
      ? `<div style="margin-top:20px;display:flex;align-items:flex-start;gap:12px;padding:14px 0;border-top:1px solid ${c.hairline};border-bottom:1px solid ${c.hairline}">
           ${icon('copy', 17, c.fgMuted)}
           <div style="flex:1">
             <div style="font-size:14px;color:${c.fg}">You already have this one</div>
             <div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Added 3 weeks ago, same size and same first and last pages. Adding it again makes a second copy on this phone.</div>
           </div>
         </div>`
      : ''}

    ${field('Title', doc.t)}
    ${field('Author', doc.a ?? 'Optional', doc.a === null)}

    <div style="margin-top:14px;display:flex;align-items:center;gap:6px">
      ${icon('info', 12, c.fgSubtle, 2)}
      <span style="font-size:12px;color:${c.fgSubtle}">${info}</span>
    </div>

    ${duplicate ? '' : `<div style="margin-top:22px;height:1px;background:${c.hairline}"></div>

    <div style="display:flex;align-items:flex-start;gap:14px;padding:18px 0">
      ${icon(large ? 'phone' : 'cloudUp', 19, large ? c.fgDisabled : c.fgMuted)}
      <div style="flex:1">
        <div style="font-size:15px;color:${large ? c.fgDisabled : c.fg}">Available on all devices</div>
        <div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${
          large
            ? 'Over the 100 MB limit for syncing, so this one stays on this phone. It still opens here with no connection.'
            : 'Keeps a copy in your account so your other phones can download it, and lets Pidom search inside it.'
        }</div>
      </div>
      <div style="width:44px;height:26px;border-radius:9999px;background:${track};position:relative;flex:0 0 auto;margin-top:2px;${large ? 'opacity:.5' : ''}">
        <div style="position:absolute;${knob};top:3px;width:20px;height:20px;border-radius:9999px;background:${large ? c.fgDisabled : '#ffffff'}"></div>
      </div>
    </div>`}

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
    <div style="height:48px;display:flex;align-items:center;justify-content:center;border-radius:${R};background:${probing ? c.hover : c.primary}">
      <span style="font-size:15px;font-weight:500;color:${probing ? c.fgDisabled : c.onPrimary}">${duplicate ? 'Open the one you have' : 'Add to library'}</span>
    </div>
    ${duplicate
      ? `<div style="margin-top:14px;text-align:center"><span style="font-size:14px;color:${c.fgMuted}">Add it anyway</span></div>`
      : ''}
  </div>
</div>`,
  });
}

/**
 * The two files Pidom will not take.
 *
 * A refusal is its own screen rather than a toast over the form, because there
 * is nothing on the form left to decide — the title and the sync toggle both
 * describe a document that is not going to exist.
 */
function importRefusal(kind) {
  const c = DARK;
  const protectedPdf = kind === 'protected';

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="height:844px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:20px ${PAD}px 0">
    <span style="font-size:14px;color:${c.fgMuted}">Cancel</span>
    <span style="font-size:16px;font-weight:600;letter-spacing:-.01em;color:${c.fg}">Add to library</span>
    <span style="font-size:14px;color:transparent">Cancel</span>
  </div>

  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 40px;text-align:center">
    ${icon(protectedPdf ? 'lock' : 'fileX', 38, c.fgSubtle, 1.5)}
    <div style="margin-top:20px;font-size:20px;line-height:26px;font-weight:700;letter-spacing:-.018em;color:${c.fg}">${
      protectedPdf ? 'This PDF has a password' : 'That is not a PDF'
    }</div>
    <div style="margin-top:8px;max-width:290px;font-size:14px;line-height:21px;color:${c.fgMuted}" class="pretty">${
      protectedPdf
        ? 'Pidom cannot open it, so it would sit in your library as a document that never renders. Remove the password in whatever made it, then add it again.'
        : 'The name ends in .pdf but the file does not start like one. It was probably renamed, or the download did not finish.'
    }</div>
    <div style="margin-top:10px;font-size:12px;color:${c.fgSubtle}">Nothing was added.</div>
  </div>

  <div style="padding:0 ${PAD}px 34px">
    <div style="height:48px;display:flex;align-items:center;justify-content:center;border-radius:${R};background:${c.primary}">
      <span style="font-size:15px;font-weight:500;color:${c.onPrimary}">Choose another file</span>
    </div>
    <div style="margin-top:14px;text-align:center"><span style="font-size:14px;color:${c.fgMuted}">Cancel</span></div>
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

/* ------------------------------ reader ---------------------------- */

/**
 * The colours of a printed page.
 *
 * Deliberately not tokens. Everything else on these artboards is themed,
 * because everything else is Pidom; a PDF page is somebody else's document and
 * renders as it was authored whatever the reader's theme is set to. Dark mode
 * changes what surrounds the page, never the page.
 */
const PAPER = { bg: '#fdfdfc', ink: '#1a1a1a', rule: '#c9c6c0', meta: '#8f8d88', hint: '#b0aea9' };

/**
 * A page of the book, at reading size.
 *
 * Ruled body type, a running head and a folio — the shape of a page rather than
 * a picture of one. Every reader artboard draws the same page, so what differs
 * between them is only the chrome around it.
 */
function readerPage({ lines = 26, top = 64, side = 40, head = true } = {}) {
  let body = '';
  for (let i = 0; i < lines; i++) {
    const w = i % 7 === 6 ? 52 : i % 5 === 4 ? 88 : 100;
    body += `<div style="height:2px;border-radius:1px;background:${PAPER.rule};width:${w}%;margin-bottom:12px"></div>`;
  }
  return `<div style="padding:${top}px ${side}px 0">
    ${head
      ? `<div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:${PAPER.meta}">Part II · Heuristics and Biases</div>
         <div style="margin-top:26px;font-size:15px;line-height:1.5;font-weight:700;color:${PAPER.ink}">The Law of Small Numbers</div>`
      : ''}
    <div style="margin-top:${head ? 18 : 0}px">${body}</div>
  </div>`;
}

/** The folio, which is part of the document rather than part of the chrome. */
const folio = (page) =>
  `<div style="position:absolute;left:0;right:0;bottom:26px;text-align:center;font-size:10px;color:${PAPER.meta}">${page}</div>`;

/**
 * The top chrome.
 *
 * Overlays the page rather than pushing it down, so hiding it does not reflow
 * the document. 44px of that 96 is the status bar; the rest is a 52px bar.
 */
function readerTop(c, { title, trailing = ['listTree', 'more'] } = {}) {
  return `<div style="position:absolute;left:0;right:0;top:0;height:96px;background:${c.bg};box-shadow:0 1px 0 ${c.hairline}">
    <div style="display:flex;align-items:center;gap:6px;padding:44px ${PAD}px 0">
      ${icon('arrowLeft', 22, c.fg, 2)}
      <div style="flex:1;margin-left:6px;min-width:0">
        <div style="font-size:14px;font-weight:600;letter-spacing:-.01em;color:${c.fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</div>
      </div>
      ${trailing.map((n) => icon(n, 20, c.fg, 2)).join('')}
    </div>
  </div>`;
}

/**
 * The bottom chrome.
 *
 * The page count is a control rather than a label — tapping it is the way to
 * page 438 of 499 — so it carries a hit area and the track under it is
 * draggable. `scrubbing` is what that looks like mid-drag.
 */
function readerBottom(c, { page, total, scrubbing = false } = {}) {
  const pct = Math.round((page / total) * 100);
  return `<div style="position:absolute;left:0;right:0;bottom:0;height:${scrubbing ? 132 : 88}px;background:${c.bg};box-shadow:0 -1px 0 ${c.hairline}">
    ${scrubbing
      ? `<div style="position:absolute;left:0;right:0;top:-92px;display:flex;justify-content:center">
           <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:${R};background:${c.elevated};box-shadow:inset 0 0 0 1px ${c.border}">
             <div style="width:38px;height:54px;border-radius:${R};background:${PAPER.bg};box-shadow:inset 0 0 0 1px ${c.border};padding:7px 6px 0">
               ${[92, 92, 58, 92, 78].map((w) => `<div style="height:1.5px;border-radius:1px;background:${PAPER.rule};width:${w}%;margin-bottom:4px"></div>`).join('')}
             </div>
             <div>
               <div style="font-size:13px;font-weight:600;color:${c.fg}" class="tnum">Page ${page}</div>
               <div style="margin-top:2px;font-size:11px;color:${c.fgSubtle}">The Law of Small Numbers</div>
             </div>
           </div>
         </div>`
      : ''}
    <div style="padding:16px ${PAD}px 0">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:12px;color:${scrubbing ? c.fg : c.fgMuted}" class="tnum">${page} of ${total}</span>
        <span style="font-size:12px;color:${c.fgSubtle}" class="tnum">${pct}%</span>
      </div>
      <div style="position:relative;margin-top:${scrubbing ? 16 : 10}px;height:${scrubbing ? 4 : 2}px;border-radius:${R};background:${c.border}">
        <div style="width:${pct}%;height:100%;border-radius:${R};background:${c.primary}"></div>
        ${scrubbing
          ? `<div style="position:absolute;left:${pct}%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:9999px;background:${c.primary};box-shadow:0 0 0 4px ${c.bg}"></div>`
          : ''}
        ${scrubbing
          ? [12, 24, 47, 63, 81].map((t) => `<div style="position:absolute;left:${t}%;top:-7px;width:1px;height:5px;background:${c.borderStrong}"></div>`).join('')
          : ''}
      </div>
      ${scrubbing
        ? `<div style="margin-top:14px;text-align:center;font-size:11px;color:${c.fgSubtle}">Release to go there</div>`
        : ''}
    </div>
  </div>`;
}

/** A page under a dimmed overlay, which is what every reader sheet sits on. */
function dimmedPage({ page = 142, dim = 0.62 } = {}) {
  return `<div style="position:absolute;inset:0;background:${PAPER.bg}">
      <div style="opacity:.5">${readerPage()}</div>
      ${folio(page)}
    </div>
    <div style="position:absolute;inset:0;background:rgba(0,0,0,${dim})"></div>`;
}

/** The Actionsheet shell every reader sheet shares with `DocumentActions`. */
function readerSheet(c, { glyph, title, subtitle, trailing = '', body }) {
  return `<div style="position:absolute;left:0;right:0;bottom:0;background:${c.elevated};border-radius:${R} ${R} 0 0;box-shadow:0 -1px 0 ${c.border};padding-bottom:28px">
    <div style="display:flex;justify-content:center;padding:8px 0 4px"><div style="width:36px;height:4px;border-radius:${R};background:${c.borderStrong}"></div></div>
    <div style="display:flex;align-items:center;gap:12px;padding:10px ${PAD}px 14px">
      ${icon(glyph, 18, c.fgMuted)}
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:600;letter-spacing:-.01em;color:${c.fg}">${title}</div>
        <div style="margin-top:2px;font-size:12px;color:${c.fgSubtle};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${subtitle}</div>
      </div>
      ${trailing}
    </div>
    <div style="height:1px;background:${c.hairline}"></div>
    ${body}
  </div>`;
}

/** One row of a reader sheet: an icon, a label, and what it is currently set to. */
function readerRow(c, { glyph, label, detail = '', checked = false, disabled = false, note = '' }) {
  const fg = disabled ? c.fgDisabled : c.fg;
  return `<div style="min-height:52px;display:flex;align-items:center;gap:14px;padding:9px ${PAD}px">
    ${icon(glyph, 19, disabled ? c.fgDisabled : c.fgMuted)}
    <div style="flex:1;min-width:0">
      <div style="font-size:15px;color:${fg}">${label}</div>
      ${note ? `<div style="margin-top:2px;font-size:12px;line-height:16px;color:${c.fgSubtle}" class="pretty">${note}</div>` : ''}
    </div>
    ${detail ? `<span style="font-size:13px;color:${c.fgSubtle}">${detail}</span>` : ''}
    ${checked ? icon('check', 18, c.primary, 2) : ''}
  </div>`;
}

/**
 * Reading a document, with and without the chrome.
 *
 * The page is the whole screen and the controls are transient: they fade rather
 * than unmount, so the document never reflows to make room for them.
 */
function reader(withChrome) {
  const c = DARK;
  const doc = byTitle('Thinking,');
  const page = 142;

  // The chrome overlays the page, so the text has to start below it — the
  // running head used to sit underneath the top bar. Without the chrome the
  // page starts where a page starts, and runs further down.
  const top = withChrome ? 116 : 64;
  const lines = withChrome ? 41 : 50;

  return dc({
    w: 390, h: 844, bg: PAPER.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${PAPER.bg}">
  ${readerPage({ top, lines })}
  ${folio(page)}
  ${withChrome
    ? readerTop(c, { title: doc.t }) + readerBottom(c, { page, total: doc.p })
    : `<div style="position:absolute;left:0;right:0;bottom:26px;display:flex;justify-content:center">
         <div style="font-size:10px;color:${PAPER.hint}">tap to show controls</div>
       </div>`}
</div>`,
  });
}

/**
 * Opening a document.
 *
 * The cover the import already rendered stands in for the page while the native
 * renderer loads, so the screen a reader waits on is a picture of the book
 * rather than an empty rectangle. The bar is real progress from
 * `onLoadProgress`, not a spinner pretending to be one.
 */
function readerOpening() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  <div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center">
    <div style="opacity:.45">${pageCover(doc, { w: 132 })}</div>
    <div style="margin-top:26px;width:132px;height:2px;border-radius:${R};background:${c.border}">
      <div style="width:38%;height:100%;border-radius:${R};background:${c.primary}"></div>
    </div>
    <div style="margin-top:14px;font-size:13px;color:${c.fgMuted}">Opening…</div>
    <div style="margin-top:4px;font-size:11px;color:${c.fgSubtle}">499 pages · from this device</div>
  </div>
  ${readerTop(c, { title: doc.t, trailing: [] })}
</div>`,
  });
}

/**
 * Continuous, which is the default on a phone.
 *
 * One long scroll: the page below is already on screen, separated by the app's
 * own background rather than by a gap in the document. Fit-to-width, so the
 * measure is the same on every page whatever the page's own proportions are.
 */
function readerContinuous() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  <div style="background:${PAPER.bg};height:604px;overflow:hidden;position:relative">
    ${readerPage({ lines: 20, top: 40 })}
    ${`<div style="position:absolute;left:0;right:0;bottom:14px;text-align:center;font-size:10px;color:${PAPER.meta}">142</div>`}
  </div>
  <div style="height:8px"></div>
  <div style="background:${PAPER.bg};height:232px;overflow:hidden">
    ${readerPage({ lines: 10, top: 34, head: false })}
  </div>
</div>`,
  });
}

/**
 * One page at a time.
 *
 * Swiped horizontally, one page per swipe, fit so the whole page is on screen
 * at once — the app's background is what fills whatever the page's proportions
 * leave over, which is why that background has to be the theme's and not the
 * renderer's grey default.
 */
function readerSinglePage() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg};display:flex;align-items:center">
  <div style="width:100%;height:756px;background:${PAPER.bg};position:relative;overflow:hidden">
    ${readerPage({ lines: 24, top: 52 })}
    <div style="position:absolute;left:0;right:0;bottom:20px;text-align:center;font-size:10px;color:${PAPER.meta}">142</div>
  </div>
  <div style="position:absolute;left:0;right:0;bottom:26px;display:flex;justify-content:center;gap:6px">
    ${[0, 1, 2].map((i) => `<div style="width:4px;height:4px;border-radius:9999px;background:${i === 1 ? c.fgMuted : c.fgDisabled}"></div>`).join('')}
  </div>
</div>`,
  });
}

/**
 * Getting to a page directly.
 *
 * Three ways into the same `goToPage`: type the number, drag the track, or pick
 * a page off the strip. The ticks on the track are the document's own contents,
 * so dragging past a chapter is something a reader can feel.
 */
function readerPageJump() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${PAPER.bg}">
  ${dimmedPage()}
  ${readerSheet(c, {
    glyph: 'target',
    title: 'Go to page',
    subtitle: doc.t,
    trailing: `<span style="font-size:12px;color:${c.fgSubtle}" class="tnum">of ${doc.p}</span>`,
    body: `<div style="padding:18px ${PAD}px 0">
      <div style="height:48px;display:flex;align-items:center;justify-content:center;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.primary}">
        <span style="font-size:20px;font-weight:600;letter-spacing:-.02em;color:${c.fg}" class="tnum">438</span>
      </div>
      <div style="position:relative;margin-top:26px;height:4px;border-radius:${R};background:${c.border}">
        <div style="width:88%;height:100%;border-radius:${R};background:${c.primary}"></div>
        <div style="position:absolute;left:88%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:9999px;background:${c.primary};box-shadow:0 0 0 4px ${c.elevated}"></div>
        ${[12, 24, 47, 63, 81].map((t) => `<div style="position:absolute;left:${t}%;top:-7px;width:1px;height:5px;background:${c.borderStrong}"></div>`).join('')}
      </div>
      <div style="margin-top:9px;display:flex;justify-content:space-between">
        <span style="font-size:11px;color:${c.fgSubtle}" class="tnum">1</span>
        <span style="font-size:11px;color:${c.fgSubtle}">ticks are chapters</span>
        <span style="font-size:11px;color:${c.fgSubtle}" class="tnum">${doc.p}</span>
      </div>
      <div style="margin-top:22px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:${R};background:${c.primary}">
        <span style="font-size:15px;font-weight:500;color:${c.onPrimary}">Go to page 438</span>
      </div>
    </div>`,
  })}
</div>`,
  });
}

/**
 * Mid-drag.
 *
 * The bubble and the page under it both follow the thumb on the UI thread; the
 * document only moves on release, because turning 300 pages one at a time to
 * get somewhere is work the renderer should never be asked to do.
 */
function readerScrubbing() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  return dc({
    w: 390, h: 844, bg: PAPER.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${PAPER.bg}">
  ${readerPage()}
  ${folio(142)}
  ${readerTop(c, { title: doc.t })}
  ${readerBottom(c, { page: 438, total: doc.p, scrubbing: true })}
</div>`,
  });
}

/**
 * How it reads.
 *
 * Three modes, and the one a phone cannot do says why rather than being absent
 * — a control that disappears on a small screen reads as a bug, and a reader
 * who saw it on their tablet will go looking for it.
 */
function readerModes() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${PAPER.bg}">
  ${dimmedPage()}
  ${readerSheet(c, {
    glyph: 'bookOpen',
    title: 'How it reads',
    subtitle: doc.t,
    body: `<div style="padding-top:4px">
      ${readerRow(c, { glyph: 'rows3', label: 'Continuous', detail: '', checked: true, note: 'One long scroll, fit to the width of the screen.' })}
      ${readerRow(c, { glyph: 'rectangleVertical', label: 'One page at a time', note: 'Swipe sideways. The whole page is always on screen.' })}
      ${readerRow(c, { glyph: 'columns2', label: 'Two pages', disabled: true, note: 'Needs a wider screen. Turn a tablet sideways, or rotate this phone.' })}
      <div style="height:1px;margin:6px ${PAD}px;background:${c.hairline}"></div>
      ${readerRow(c, { glyph: 'maximize', label: 'Fit', detail: 'Width' })}
    </div>`,
  })}
</div>`,
  });
}

/**
 * Reader settings.
 *
 * Everything here is about this phone rather than about the document, which is
 * what the last line says — the mode syncs because it is a way of reading a
 * particular book, and the rest does not because it is about a particular
 * screen in a particular room.
 */
function readerSettings() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  const toggle = (on) =>
    `<div style="width:44px;height:26px;border-radius:9999px;background:${on ? c.primary : c.border};position:relative;flex:0 0 auto">
       <div style="position:absolute;${on ? 'right:3px' : 'left:3px'};top:3px;width:20px;height:20px;border-radius:9999px;background:${on ? c.onPrimary : c.fgSubtle}"></div>
     </div>`;
  const switchRow = (glyph, label, note, on) =>
    `<div style="min-height:52px;display:flex;align-items:center;gap:14px;padding:11px ${PAD}px">
       ${icon(glyph, 19, c.fgMuted)}
       <div style="flex:1;min-width:0">
         <div style="font-size:15px;color:${c.fg}">${label}</div>
         <div style="margin-top:2px;font-size:12px;line-height:16px;color:${c.fgSubtle}" class="pretty">${note}</div>
       </div>
       ${toggle(on)}
     </div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${PAPER.bg}">
  ${dimmedPage()}
  ${readerSheet(c, {
    glyph: 'settings',
    title: 'Reader',
    subtitle: doc.t,
    body: `<div style="padding-top:4px">
      ${readerRow(c, { glyph: 'rows3', label: 'How it reads', detail: 'Continuous' })}
      ${readerRow(c, { glyph: 'maximize', label: 'Fit', detail: 'Width' })}
      <div style="height:1px;margin:6px ${PAD}px;background:${c.hairline}"></div>
      ${switchRow('eye', 'Keep the screen awake', 'While this document is open, and only while it is.', true)}
      ${switchRow('sun', 'Follow the document', 'Pages render as they were authored. Dark mode changes what is around them.', true)}
      <div style="padding:14px ${PAD}px 4px">
        <div style="font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">How it reads follows the document to your other devices. Everything else stays on this phone.</div>
      </div>
    </div>`,
  })}
</div>`,
  });
}

/**
 * A PDF with a password.
 *
 * The import refuses these outright, so a document only reaches this screen if
 * it was encrypted after it was added or arrived from another device. The
 * renderer takes the password itself; nothing here sends it anywhere.
 */
function readerPassword() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  <div style="position:absolute;inset:0;background:rgba(0,0,0,.62)"></div>
  <div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);padding:0 ${PAD}px">
    <div style="border-radius:${R};background:${c.elevated};box-shadow:inset 0 0 0 1px ${c.border};padding:20px">
      ${icon('lock', 22, c.fgMuted)}
      <div style="margin-top:14px;font-size:17px;font-weight:700;letter-spacing:-.015em;color:${c.fg}">This PDF has a password</div>
      <div style="margin-top:8px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">Enter it to read the document. Pidom never sends it anywhere — it goes straight to the viewer on this phone.</div>
      <div style="margin-top:16px;height:44px;display:flex;align-items:center;padding:0 12px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.primary}">
        <span style="font-size:15px;letter-spacing:.22em;color:${c.fg}">••••••••</span>
      </div>
      <div style="margin-top:14px;display:flex;align-items:center;gap:12px">
        <div style="width:44px;height:26px;border-radius:9999px;background:${c.border};position:relative;flex:0 0 auto">
          <div style="position:absolute;left:3px;top:3px;width:20px;height:20px;border-radius:9999px;background:${c.fgSubtle}"></div>
        </div>
        <div style="flex:1;font-size:13px;color:${c.fgMuted}">Remember on this device</div>
      </div>
      <div style="margin-top:20px;display:flex;justify-content:flex-end;gap:8px">
        <div style="height:36px;display:flex;align-items:center;padding:0 14px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}">
          <span style="font-size:14px;font-weight:500;color:${c.fg}">Cancel</span>
        </div>
        <div style="height:36px;display:flex;align-items:center;padding:0 14px;border-radius:${R};background:${c.primary}">
          <span style="font-size:14px;font-weight:500;color:${c.onPrimary}">Open</span>
        </div>
      </div>
    </div>
  </div>
</div>`,
  });
}

/**
 * A document that will not render.
 *
 * Flat, and it says which of the two things went wrong — a file that is damaged
 * is a different problem from one that is missing, and the second has a fix the
 * reader can act on.
 */
function readerFailed() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  <div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);padding:0 40px;text-align:center">
    <div style="display:flex;justify-content:center">${icon('fileX', 34, c.fgSubtle, 1.5)}</div>
    <div style="margin-top:18px;font-size:17px;font-weight:700;letter-spacing:-.015em;color:${c.fg}">This file will not open</div>
    <div style="margin-top:8px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">The copy on this phone is damaged. There is a copy in your account, so downloading it again should fix it.</div>
    <div style="margin-top:24px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:${R};background:${c.primary}">
      <span style="font-size:15px;font-weight:500;color:${c.onPrimary}">Download it again</span>
    </div>
    <div style="margin-top:16px;font-size:14px;color:${c.primary}">Back to your library</div>
  </div>
  ${readerTop(c, { title: byTitle('Thinking,').t, trailing: [] })}
</div>`,
  });
}

/**
 * A link inside the document.
 *
 * A PDF is a file somebody else wrote, and it does not get to open a URL
 * without the reader seeing where it goes. The host is what the sentence leads
 * with, because the host is the part that decides whether this is safe.
 */
function readerLink() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: PAPER.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${PAPER.bg}">
  ${dimmedPage()}
  <div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);padding:0 ${PAD}px">
    <div style="border-radius:${R};background:${c.elevated};box-shadow:inset 0 0 0 1px ${c.border};padding:20px">
      ${icon('externalLink', 22, c.fgMuted)}
      <div style="margin-top:14px;font-size:17px;font-weight:700;letter-spacing:-.015em;color:${c.fg}">Leave Pidom?</div>
      <div style="margin-top:12px;padding:10px 12px;border-radius:${R};background:${c.sunken};box-shadow:inset 0 0 0 1px ${c.hairline}">
        <div style="font-size:14px;font-weight:600;color:${c.fg}">psycnet.apa.org</div>
        <div style="margin-top:2px;font-size:11px;line-height:15px;color:${c.fgSubtle};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">https://psycnet.apa.org/record/1974-02325-001</div>
      </div>
      <div style="margin-top:12px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">This link is written into the document, not into Pidom. It opens in your browser.</div>
      <div style="margin-top:20px;display:flex;justify-content:flex-end;gap:8px">
        <div style="height:36px;display:flex;align-items:center;padding:0 14px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}">
          <span style="font-size:14px;font-weight:500;color:${c.fg}">Stay here</span>
        </div>
        <div style="height:36px;display:flex;align-items:center;padding:0 14px;border-radius:${R};background:${c.primary}">
          <span style="font-size:14px;font-weight:500;color:${c.onPrimary}">Open</span>
        </div>
      </div>
    </div>
  </div>
</div>`,
  });
}

/**
 * Finding a word without leaving the page.
 *
 * The bar takes the top chrome's place rather than stacking under it: they are
 * the same strip of screen, and somebody searching a document is not also
 * reading its title. The snippet under the field is why this beats a bare hit
 * count — enough to know whether to go, and going is one tap.
 *
 * No new backend behind it. The page text is already extracted for every synced
 * document and already mirrored into this phone's own index, both already
 * scoped by document, so this is the search that existed asked a narrower
 * question — and it answers with no connection.
 */
function readerFind() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: PAPER.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${PAPER.bg}">
  ${readerPage({ top: 132, lines: 38 })}
  ${folio(142)}

  <div style="position:absolute;left:0;right:0;top:0;background:${c.bg};box-shadow:0 1px 0 ${c.hairline};padding:44px ${PAD - 8}px 12px">
    <div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;height:40px;display:flex;align-items:center;padding:0 12px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.primary}">
        <span style="font-size:14px;color:${c.fg}">anchoring</span>
      </div>
      <span style="font-size:12px;color:${c.fgSubtle};flex:0 0 auto" class="tnum">3 of 17</span>
      ${icon('chevronUp', 18, c.fg, 2)}
      ${icon('chevronDown', 18, c.fg, 2)}
      ${icon('close', 18, c.fg, 2)}
    </div>
    <div style="margin-top:10px;display:flex;align-items:center;gap:10px;padding:0 8px">
      <span style="font-size:12px;color:${c.fgMuted};flex:0 0 auto" class="tnum">p.142</span>
      <span style="flex:1;min-width:0;font-size:12px;color:${c.fgSubtle};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">…the law of small numbers and <span style="color:${c.fg}">anchoring</span> effects both follow from…</span>
    </div>
  </div>
</div>`,
  });
}

/**
 * The navigator, which is one sheet with four ways of answering one question.
 *
 * Contents is the document's own outline, Bookmarks and Notes are the reader's
 * additions to it, and Pages is the document as pictures. All four end in the
 * same `goToPage`, so they belong behind one button rather than four.
 *
 * The segmented row scrolls. Four labels with two counts on them fit a 390pt
 * screen at the default type size and stop fitting a step or two up the
 * accessibility scale, and a control that reflows into two rows is worse than
 * one that slides.
 */
function navTabs(c, active, { bookmarks = 0, notes = 0 } = {}) {
  const tab = (key, label) =>
    `<div style="padding:6px 12px;border-radius:${R};flex:0 0 auto;${active === key ? `background:${c.primaryTint}` : ''}">
       <span style="font-size:12px;white-space:nowrap;color:${active === key ? c.primary : c.fgMuted}">${label}</span>
     </div>`;
  return `<div style="display:flex;gap:6px;padding:0 ${PAD}px 12px">
      ${tab('contents', 'Contents')}${tab('bookmarks', bookmarks === 0 ? 'Bookmarks' : `Bookmarks · ${bookmarks}`)}${tab('notes', notes === 0 ? 'Notes' : `Notes · ${notes}`)}${tab('pages', 'Pages')}
    </div>`;
}

/**
 * The navigator's shell — a **screen**, not a sheet.
 *
 * It was a sheet, and using it on a device showed why that was wrong: a sheet is
 * as tall as its content, so moving from Contents (355 rows) to Bookmarks (one
 * row) shrank it by two thirds and took the segmented control down with it. The
 * next tap landed on the backdrop and dismissed the whole thing. A control does
 * not hang off a box whose height is the reader's data.
 */
function navigatorPage(c, { glyph, title, subtitle, trailing = '', active, counts, body }) {
  return `<div style="position:absolute;inset:0;background:${c.bg}">
    <div style="display:flex;align-items:center;padding:44px ${PAD}px 12px">
      ${icon('arrowLeft', 22, c.fg, 2)}
      <div style="margin-left:10px;flex:0 0 auto">${icon(glyph, 18, c.fgMuted)}</div>
      <div style="flex:1;min-width:0;margin-left:10px">
        <div style="font-size:15px;font-weight:600;letter-spacing:-.01em;color:${c.fg}">${title}</div>
        <div style="margin-top:2px;font-size:12px;color:${c.fgSubtle};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${subtitle}</div>
      </div>
      ${trailing}
    </div>
    ${navTabs(c, active, counts)}
    <div style="height:1px;background:${c.hairline}"></div>
    ${body}
  </div>`;
}

/**
 * The pages this reader marked.
 *
 * Unlike Contents, this list is the reader's own, so a row can be removed from
 * it — and named. `documentBookmarks.label` has been in the schema and honoured
 * by `addBookmark` since bookmarks landed, while the only writer never sent
 * one, so every row in the app read `Page 142` however deliberate the mark was.
 * A long press is what names one.
 */
function readerBookmarks() {
  const c = DARK;
  const doc = byTitle('Thinking,');

  const row = (label, page, current) =>
    `<div style="display:flex;align-items:center;${current ? `background:${c.hover}` : ''}">
       <div style="flex:1;min-width:0;display:flex;align-items:center;gap:12px;padding:12px 0 12px ${PAD}px">
         <div style="flex:1;min-width:0;font-size:15px;color:${current ? c.fg : c.fgMuted};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</div>
         <span style="font-size:12px;color:${current ? c.primary : c.fgSubtle};flex:0 0 auto" class="tnum">${page}</span>
       </div>
       <div style="width:48px;display:flex;align-items:center;justify-content:center">${icon('trash', 15, c.fgSubtle)}</div>
     </div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${navigatorPage(c, {
    glyph: 'bookmark', title: 'Bookmarks', subtitle: doc.t,
    trailing: `<span style="font-size:12px;color:${c.fgSubtle}" class="tnum">5</span>`,
    active: 'bookmarks', counts: { bookmarks: 5, notes: 3 },
    body: `<div style="padding-top:4px">
      ${row('Anchors', 152, false)}
      ${row('The two-systems diagram', 24, false)}
      ${row('Page 142', 142, true)}
      ${row('Prospect theory', 279, false)}
      ${row('Page 438', 438, false)}
    </div>`,
  })}
</div>`,
  });
}

/**
 * Passages and notes, which is as far as an annotation goes on this renderer.
 *
 * `react-native-pdf` reports selected text and no rectangles — `onPageSingleTap`
 * hands back `MotionEvent.getX()`, which is where a finger touched the view and
 * not where the words are on the page. So there is nothing to draw a highlight
 * over, and a list that pretended otherwise would be drawing a mark the reader
 * would then go looking for on the page and not find.
 *
 * What it is instead: the passage in the reader's own words-of-the-document,
 * the note they wrote about it, and the page. The rule down the left is the
 * only mark, and it is in this list rather than on the page.
 */
function readerNotes() {
  const c = DARK;
  const doc = byTitle('Thinking,');

  const row = (quote, note, page, current = false) =>
    `<div style="display:flex;align-items:stretch;${current ? `background:${c.hover}` : ''}">
       <div style="flex:1;min-width:0;display:flex;gap:12px;padding:12px 0 12px ${PAD}px">
         <div style="width:2px;border-radius:1px;background:${c.primary};flex:0 0 auto"></div>
         <div style="flex:1;min-width:0">
           <div style="font-size:14px;line-height:19px;color:${quote ? c.fg : c.fgMuted}" class="c2 pretty">${quote ?? note}</div>
           ${quote && note ? `<div style="margin-top:3px;font-size:12px;line-height:16px;color:${c.fgSubtle}" class="c2 pretty">${note}</div>` : ''}
         </div>
         <span style="font-size:12px;color:${current ? c.primary : c.fgSubtle};flex:0 0 auto" class="tnum">${page}</span>
       </div>
       <div style="width:48px;display:flex;align-items:center;justify-content:center">${icon('trash', 15, c.fgSubtle)}</div>
     </div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${navigatorPage(c, {
    glyph: 'highlighter', title: 'Notes', subtitle: doc.t,
    trailing: `<span style="font-size:12px;color:${c.fgSubtle}" class="tnum">3</span>`,
    active: 'notes', counts: { bookmarks: 5, notes: 3 },
    body: `<div style="padding-top:4px">
      ${row('&ldquo;System 1 operates automatically and quickly, with little or no effort and no sense of voluntary control.&rdquo;', 'His own summary. Quote this one.', 20)}
      ${row(null, 'The small-numbers argument starts here, not in the chapter that is named after it.', 142, true)}
      ${row('&ldquo;&hellip;an anchoring index of 55%, which is about what most of these experiments produce.&rdquo;', null, 152)}
    </div>`,
  })}
</div>`,
  });
}

/**
 * Nothing kept yet.
 *
 * It says what to do rather than what is absent, and it says both halves —
 * selecting text is iOS-only because the renderer's selection is, so a screen
 * that only offered that would be an empty state with no exit on Android.
 */
function readerNotesEmpty() {
  const c = DARK;
  const doc = byTitle('Thinking,');

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${navigatorPage(c, {
    glyph: 'highlighter', title: 'Notes', subtitle: doc.t,
    active: 'notes', counts: { bookmarks: 5, notes: 0 },
    body: `<div style="padding:44px ${PAD}px 24px;text-align:center">
      ${icon('quote', 26, c.fgDisabled)}
      <div style="margin-top:14px;font-size:15px;font-weight:600;color:${c.fg}">Nothing kept yet</div>
      <div style="margin-top:6px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">Select a passage in the document to keep it, or write a note about the page you are on.</div>
      <div style="margin-top:18px;display:flex;justify-content:center">
        <div style="height:36px;display:flex;align-items:center;gap:7px;padding:0 14px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}">
          ${icon('notebookPen', 15, c.fg)}<span style="font-size:14px;font-weight:500;color:${c.fg}">Write a note</span>
        </div>
      </div>
    </div>`,
  })}
</div>`,
  });
}

/**
 * Every page at once.
 *
 * A cell is a live `<Pdf singlePage>`, the same component the scrubber mounts
 * while a finger is down — there is no library that turns a PDF page into an
 * image on React Native 0.86, so the renderer that is already here draws them.
 * That is what the virtualised grid is for: a screen holds nine of these, not
 * four hundred, and the list recycles the rest.
 *
 * It is also why `THUMBNAIL_PAGE_MAX` gates the segment. Past 1,200 pages the
 * grid is a long scroll past pages nobody is looking for, and the scrubber
 * reaches any page in one drag regardless of length — so the segment is absent
 * rather than present and slow.
 */
function readerThumbnails() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  const W = 98, H = 139;

  const cell = (page, current) =>
    `<div style="flex:0 0 auto;width:${W}px">
       <div style="width:${W}px;height:${H}px;border-radius:${R};overflow:hidden;background:${PAPER.bg};box-shadow:inset 0 0 0 ${current ? 2 : 1}px ${current ? c.primary : c.border};padding:11px 9px 0">
         ${[100, 100, 88, 100, 52, 100, 100, 88, 100, 100, 52].map((w) => `<div style="height:1.5px;border-radius:1px;background:${PAPER.rule};width:${w}%;margin-bottom:5px"></div>`).join('')}
       </div>
       <div style="margin-top:5px;text-align:center;font-size:11px;color:${current ? c.primary : c.fgSubtle}" class="tnum">${page}</div>
     </div>`;

  const row = (pages) =>
    `<div style="display:flex;gap:12px;padding:0 ${PAD}px 14px">${pages.map(([p, cur]) => cell(p, cur)).join('')}</div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${navigatorPage(c, {
    glyph: 'grid', title: 'Pages', subtitle: doc.t,
    trailing: `<span style="font-size:12px;color:${c.fgSubtle}" class="tnum">142 of ${doc.p}</span>`,
    active: 'pages', counts: { bookmarks: 5, notes: 3 },
    body: `<div style="padding-top:14px">
      ${row([[140, false], [141, false], [142, true]])}
      ${row([[143, false], [144, false], [145, false]])}
    </div>`,
  })}
</div>`,
  });
}

/**
 * Writing a note.
 *
 * A **screen**, not a dialog. A dialog holding a keyboard on a phone is a box
 * with about four visible lines in it, and a note is prose — so the field gets
 * the room, and Keep sits in the header where a screen's primary action goes.
 *
 * The passage is shown and is not editable: `text` is the document's own words,
 * and a field that let a reader rewrite them would turn a quotation into a
 * paraphrase nothing downstream could tell apart from one. When the note is
 * written from the overflow rather than from a selection — which is the whole
 * of the Android path, since that renderer has no selection — the quote is
 * absent and the page number is the anchor.
 */
function readerNoteCompose() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  <div style="display:flex;align-items:center;padding:44px ${PAD}px 12px">
    ${icon('arrowLeft', 22, c.fg, 2)}
    <div style="flex:1;min-width:0;margin-left:10px">
      <div style="font-size:15px;font-weight:600;letter-spacing:-.01em;color:${c.fg}">Write a note</div>
      <div style="margin-top:2px;font-size:12px;color:${c.fgSubtle}" class="tnum">Page 142</div>
    </div>
    <div style="height:34px;display:flex;align-items:center;padding:0 14px;border-radius:${R};background:${c.primary};flex:0 0 auto">
      <span style="font-size:14px;font-weight:500;color:${c.onPrimary}">Keep</span>
    </div>
  </div>

  <div style="padding:8px ${PAD}px 0">
    <div style="font-size:12px;color:${c.fgSubtle}">From the page</div>
    <div style="margin-top:8px;display:flex;gap:10px">
      <div style="width:2px;border-radius:1px;background:${c.borderStrong};flex:0 0 auto"></div>
      <div style="flex:1;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">&ldquo;System 1 operates automatically and quickly, with little or no effort and no sense of voluntary control.&rdquo;</div>
    </div>

    <div style="margin-top:20px;font-size:12px;color:${c.fgSubtle}">Note</div>
    <div style="margin-top:8px;min-height:160px;padding:11px 12px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.primary}">
      <span style="font-size:15px;line-height:22px;color:${c.fg}">His own summary. Quote this one.</span>
    </div>
  </div>
</div>`,
  });
}

/**
 * Naming a bookmark.
 *
 * The same screen, with one line instead of several. `maxLength` is
 * `BOOKMARK_LABEL_MAX` so the keyboard stops a long name rather than a round
 * trip coming back as an error, and clearing the field is how a reader takes a
 * name back off — which is the line under it.
 */
function readerBookmarkName() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  <div style="display:flex;align-items:center;padding:44px ${PAD}px 12px">
    ${icon('arrowLeft', 22, c.fg, 2)}
    <div style="flex:1;min-width:0;margin-left:10px">
      <div style="font-size:15px;font-weight:600;letter-spacing:-.01em;color:${c.fg}">Name this bookmark</div>
      <div style="margin-top:2px;font-size:12px;color:${c.fgSubtle}" class="tnum">Page 152</div>
    </div>
    <div style="height:34px;display:flex;align-items:center;padding:0 14px;border-radius:${R};background:${c.primary};flex:0 0 auto">
      <span style="font-size:14px;font-weight:500;color:${c.onPrimary}">Save</span>
    </div>
  </div>

  <div style="padding:8px ${PAD}px 0">
    <div style="font-size:12px;color:${c.fgSubtle}">Name</div>
    <div style="margin-top:8px;height:44px;display:flex;align-items:center;padding:0 12px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.primary}">
      <span style="font-size:15px;color:${c.fg}">Anchors</span>
    </div>
    <div style="margin-top:8px;font-size:12px;color:${c.fgSubtle}">Clearing this takes the name off again.</div>
  </div>
</div>`,
  });
}

function readerTint() {
  const c = DARK;
  const doc = byTitle('Thinking,');

  const toggle = (on) =>
    `<div style="width:44px;height:26px;border-radius:9999px;background:${on ? c.primary : c.border};position:relative;flex:0 0 auto">
       <div style="position:absolute;${on ? 'right:3px' : 'left:3px'};top:3px;width:20px;height:20px;border-radius:9999px;background:${on ? c.onPrimary : c.fgSubtle}"></div>
     </div>`;
  const chip = (label, on) =>
    `<div style="padding:6px 10px;border-radius:${R};${on ? `background:${c.primaryTint}` : ''}">
       <span style="font-size:12px;color:${on ? c.primary : c.fgMuted}">${label}</span>
     </div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${PAPER.bg}">
  <div>${readerPage({ top: 64, lines: 30 })}</div>
  <div style="position:absolute;inset:0;background:rgba(0,0,0,.35)"></div>
  <div style="position:absolute;inset:0;background:rgba(0,0,0,.62)"></div>

  ${readerSheet(c, {
    glyph: 'settings',
    title: 'Reader',
    subtitle: doc.t,
    body: `<div style="padding-top:4px">
      ${readerRow(c, { glyph: 'rows3', label: 'How it reads', detail: 'Continuous' })}
      ${readerRow(c, { glyph: 'maximize', label: 'Fit', detail: 'Width' })}
      <div style="height:1px;margin:6px ${PAD}px;background:${c.hairline}"></div>
      <div style="min-height:52px;display:flex;align-items:center;gap:14px;padding:11px ${PAD}px">
        ${icon('eye', 19, c.fgMuted)}
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;color:${c.fg}">Keep the screen awake</div>
          <div style="margin-top:2px;font-size:12px;line-height:16px;color:${c.fgSubtle}" class="pretty">While this document is open, and only while it is.</div>
        </div>
        ${toggle(true)}
      </div>
      <div style="min-height:52px;display:flex;align-items:center;gap:14px;padding:11px ${PAD}px">
        ${icon('sun', 19, c.fgMuted)}
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;color:${c.fg}">Follow the document</div>
          <div style="margin-top:2px;font-size:12px;line-height:16px;color:${c.fgSubtle}" class="pretty">Pages render as they were authored. Dark mode changes what is around them.</div>
        </div>
        ${toggle(false)}
      </div>
      <div style="display:flex;align-items:center;gap:14px;padding:4px ${PAD}px 14px">
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;color:${c.fgMuted}">Over the page</div>
          <div style="margin-top:2px;font-size:12px;line-height:16px;color:${c.fgSubtle}" class="pretty">A layer over the page, not a change to it — the document is not inverted.</div>
        </div>
        <div style="display:flex;gap:6px;flex:0 0 auto">${chip('Dim', true)}${chip('Warm', false)}</div>
      </div>
    </div>`,
  })}
</div>`,
  });
}

/**
 * Text somebody selected.
 *
 * `enableTextSelection` has been on the whole time — it is the package's
 * default — so an iOS reader could already select text and reach the system
 * menu while nothing here knew. This is that callback given somewhere to go.
 * iOS only, because the renderer's selection is; on Android there is no bar
 * rather than a button that cannot work.
 */
function readerSelection() {
  const c = DARK;
  const doc = byTitle('Thinking,');

  // A run of ruled lines with three of them highlighted, which is what a
  // selection looks like at this scale.
  let body = '';
  for (let i = 0; i < 30; i++) {
    const w = i % 7 === 6 ? 52 : i % 5 === 4 ? 88 : 100;
    const picked = i >= 11 && i <= 13;
    body += `<div style="height:2px;border-radius:1px;background:${picked ? '#a8b4e8' : PAPER.rule};width:${w}%;margin-bottom:12px;${picked ? 'box-shadow:0 0 0 3px rgba(106,89,232,.22)' : ''}"></div>`;
  }

  return dc({
    w: 390, h: 844, bg: PAPER.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${PAPER.bg}">
  <div style="padding:116px 40px 0">
    <div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:${PAPER.meta}">Part II · Heuristics and Biases</div>
    <div style="margin-top:26px;font-size:15px;line-height:1.5;font-weight:700;color:${PAPER.ink}">The Law of Small Numbers</div>
    <div style="margin-top:18px">${body}</div>
  </div>
  ${folio(142)}

  <div style="position:absolute;left:0;right:0;bottom:196px;display:flex;justify-content:center">
    <div style="display:flex;gap:2px;padding:4px 6px;border-radius:${R};background:${c.elevated};box-shadow:inset 0 0 0 1px ${c.border}">
      ${['copy:Copy', 'highlighter:Keep', 'notebookPen:Note', 'search:Find']
        .map((pair) => {
          const [glyph, label] = pair.split(':');
          return `<div style="display:flex;align-items:center;gap:5px;padding:8px 10px;border-radius:${R}">
        ${icon(glyph, 15, c.fg)}<span style="font-size:14px;white-space:nowrap;color:${c.fg}">${label}</span>
      </div>`;
        })
        .join('')}
    </div>
  </div>

  ${readerTop(c, { title: doc.t })}
  ${readerBottom(c, { page: 142, total: doc.p })}
</div>`,
  });
}

/**
 * Two pages, on a screen wide enough to mean it.
 *
 * `react-native-pdf` has no spread of its own, so this is two renderers side by
 * side, each showing one page and neither scrolling. That is the reason the
 * mode is gated on width rather than offered everywhere: it costs a second
 * native view holding a second copy of the document open, which is a fair trade
 * on a tablet and a bad one on a phone.
 */
function readerSpread() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  const W = 1024, H = 768;

  const page = (n, head) =>
    `<div style="flex:1;height:100%;background:${PAPER.bg};position:relative;overflow:hidden">
       <div style="padding:44px 46px 0">
         ${head ? `<div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:${PAPER.meta}">Part II · Heuristics and Biases</div>
                   <div style="margin-top:20px;font-size:15px;line-height:1.5;font-weight:700;color:${PAPER.ink}">The Law of Small Numbers</div>` : ''}
         <div style="margin-top:${head ? 16 : 0}px">
           ${Array.from({ length: head ? 40 : 45 }, (_, i) => {
             const w = i % 7 === 6 ? 52 : i % 5 === 4 ? 88 : 100;
             return `<div style="height:2px;border-radius:1px;background:${PAPER.rule};width:${w}%;margin-bottom:11px"></div>`;
           }).join('')}
         </div>
       </div>
       <div style="position:absolute;left:0;right:0;bottom:18px;text-align:center;font-size:10px;color:${PAPER.meta}">${n}</div>
     </div>`;

  const strip = [138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149]
    .map((n) => {
      const here = n === 142 || n === 143;
      return `<div style="flex:0 0 auto;width:40px">
        <div style="width:40px;height:56px;border-radius:${R};background:${PAPER.bg};box-shadow:inset 0 0 0 ${here ? 2 : 1}px ${here ? c.primary : c.border};padding:7px 5px 0">
          ${[100, 88, 100, 52].map((w) => `<div style="height:1.5px;border-radius:1px;background:${PAPER.rule};width:${w}%;margin-bottom:4px"></div>`).join('')}
        </div>
        <div style="margin-top:4px;text-align:center;font-size:9px;color:${here ? c.primary : c.fgSubtle}" class="tnum">${n}</div>
      </div>`;
    })
    .join('');

  return dc({
    w: W, h: H, bg: c.bg,
    body: `<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${c.bg};display:flex;flex-direction:column">
  <div style="height:56px;flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:0 ${PAD}px;box-shadow:0 1px 0 ${c.hairline}">
    ${icon('arrowLeft', 21, c.fg, 2)}
    <div style="flex:1;margin-left:6px;min-width:0">
      <div style="font-size:14px;font-weight:600;letter-spacing:-.01em;color:${c.fg}">${doc.t}</div>
      <div style="margin-top:1px;font-size:11px;color:${c.fgSubtle}">Daniel Kahneman</div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;height:30px;padding:0 10px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}">
      ${icon('columns2', 14, c.primary, 2)}<span style="font-size:12px;color:${c.fg}">Two pages</span>
    </div>
    <div style="width:14px"></div>
    ${icon('listTree', 19, c.fg, 2)}<div style="width:16px"></div>${icon('textSearch', 19, c.fg, 2)}<div style="width:16px"></div>${icon('more', 19, c.fg, 2)}
  </div>

  <div style="flex:1;display:flex;gap:10px;padding:14px ${PAD}px;min-height:0">
    ${page(142, true)}
    ${page(143, false)}
  </div>

  <div style="flex:0 0 auto;box-shadow:0 -1px 0 ${c.hairline};padding:12px ${PAD}px 14px">
    <div style="display:flex;align-items:center;gap:10px">
      <span style="font-size:12px;color:${c.fgMuted};flex:0 0 auto" class="tnum">142–143 of ${doc.p}</span>
      <div style="flex:1;display:flex;gap:8px;overflow:hidden">${strip}</div>
      <span style="font-size:12px;color:${c.fgSubtle};flex:0 0 auto" class="tnum">29%</span>
    </div>
  </div>
</div>`,
  });
}

/**
 * What the reader is made of.
 *
 * The measurements, the four states a document can be in while it is open, and
 * the one place every feature goes through to move the page. Drawn rather than
 * written down because the numbers are the sort that drift.
 */
function readerAnatomy() {
  const c = DARK;
  const W = 900, H = 1180;

  const label = (t) =>
    `<div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">${t}</div>`;

  const measure = (t) =>
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
       <div style="width:18px;height:1px;background:${c.borderStrong};flex:0 0 auto"></div>
       <span style="font-size:12px;color:${c.fgMuted}" class="tnum">${t}</span>
     </div>`;

  const state = (glyph, title, body) =>
    `<div style="flex:1;min-width:0">
       ${icon(glyph, 19, c.fgMuted)}
       <div style="margin-top:10px;font-size:14px;font-weight:600;color:${c.fg}">${title}</div>
       <div style="margin-top:5px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${body}</div>
     </div>`;

  const command = (name, body) =>
    `<div style="display:flex;gap:14px;padding:9px 0;box-shadow:0 1px 0 ${c.hairline}">
       <span style="flex:0 0 168px;font-size:12.5px;color:${c.fg};font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${name}</span>
       <span style="flex:1;font-size:12.5px;line-height:17px;color:${c.fgSubtle}" class="pretty">${body}</span>
     </div>`;

  return dc({
    w: W, h: H, bg: c.bg,
    body: `<div style="width:${W}px;min-height:${H}px;background:${c.bg};padding:40px">
  <div style="font-size:22px;font-weight:700;letter-spacing:-.02em;color:${c.fg}">The reader</div>
  <div style="margin-top:7px;max-width:600px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">React Native owns the controls, the navigation and the reading state. The native renderer owns the page, the zoom and the panning. Nothing crosses that line — in particular there is no second zoom engine over a renderer that already has pinch and double tap.</div>

  <div style="margin-top:34px;display:flex;gap:40px">
    <div style="flex:0 0 300px">
      <div style="position:relative;width:300px;height:649px;border-radius:${R};overflow:hidden;background:${PAPER.bg};box-shadow:inset 0 0 0 1px ${c.border}">
        <div style="padding:52px 32px 0">
          <div style="font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:${PAPER.meta}">Part II · Heuristics and Biases</div>
          <div style="margin-top:20px;font-size:13px;line-height:1.5;font-weight:700;color:${PAPER.ink}">The Law of Small Numbers</div>
          <div style="margin-top:14px">
            ${Array.from({ length: 18 }, (_, i) => {
              const w = i % 7 === 6 ? 52 : i % 5 === 4 ? 88 : 100;
              return `<div style="height:2px;border-radius:1px;background:${PAPER.rule};width:${w}%;margin-bottom:11px"></div>`;
            }).join('')}
          </div>
        </div>
        <div style="position:absolute;left:0;right:0;top:0;height:74px;background:${c.bg};box-shadow:0 1px 0 ${c.hairline}">
          <div style="display:flex;align-items:center;gap:6px;padding:34px 18px 0">
            ${icon('arrowLeft', 18, c.fg, 2)}
            <div style="flex:1;margin-left:4px;font-size:12px;font-weight:600;color:${c.fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Thinking, Fast and Slow</div>
            ${icon('listTree', 16, c.fg, 2)}${icon('more', 16, c.fg, 2)}
          </div>
        </div>
        <div style="position:absolute;left:0;right:0;bottom:0;height:68px;background:${c.bg};box-shadow:0 -1px 0 ${c.hairline};padding:13px 18px 0">
          <div style="display:flex;justify-content:space-between">
            <span style="font-size:11px;color:${c.fgMuted}" class="tnum">142 of 499</span>
            <span style="font-size:11px;color:${c.fgSubtle}" class="tnum">28%</span>
          </div>
          <div style="margin-top:8px;height:2px;border-radius:${R};background:${c.border}"><div style="width:28%;height:100%;border-radius:${R};background:${c.primary}"></div></div>
        </div>
      </div>
    </div>

    <div style="flex:1;min-width:0">
      ${label('Chrome')}
      <div style="margin-top:12px">
        ${measure('96 top bar — 44 status bar plus 52 of controls, from useSafeAreaInsets rather than a constant')}
        ${measure('88 bottom bar, growing to 132 while the track is being dragged')}
        ${measure('22 back arrow, 20 everything else, stroke 2')}
        ${measure('14 / 600 title, ellipsised — one line, never two')}
        ${measure('2 progress track, 4 while dragging')}
        ${measure('6 corner radius, as everywhere')}
        ${measure('Both bars overlay the page. Hiding them never reflows the document.')}
      </div>

      <div style="margin-top:26px">${label('While it is open')}</div>
      <div style="margin-top:14px;display:flex;gap:22px">
        ${state('cloudDown', 'Opening', 'The cover stands in for the page and onLoadProgress drives a real bar.')}
        ${state('bookOpen', 'Ready', 'The saved position is restored once, and after that the reader owns the page.')}
      </div>
      <div style="margin-top:20px;display:flex;gap:22px">
        ${state('lock', 'Locked', 'The renderer takes the password itself. Nothing here sends it anywhere.')}
        ${state('fileX', 'Failed', 'A flat state with a way out, not a blank screen and a log line.')}
      </div>

      <div style="margin-top:26px">${label('What is over the page')}</div>
      <div style="margin-top:12px;font-size:12.5px;line-height:19px;color:${c.fgMuted}" class="pretty">One <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${c.fg}">activeOverlay</span>, not a boolean per sheet. Nine independent flags meant two sheets could be open at once and every hand-off between them had to be remembered; a single value makes that impossible instead of careful.</div>

      <div style="margin-top:26px">${label('Where the page comes from')}</div>
      <div style="margin-top:12px;font-size:12.5px;line-height:19px;color:${c.fgMuted}" class="pretty">Documents/library/&lt;profile&gt;/&lt;document&gt;.pdf, straight into the renderer. Convex is never asked for a file to open one, which is why a 600-page textbook opens in airplane mode.</div>
    </div>
  </div>

  <div style="margin-top:34px">${label('One way to move the page')}</div>
  <div style="margin-top:6px;max-width:820px;font-size:12.5px;line-height:18px;color:${c.fgMuted}" class="pretty">Contents, find results, the scrubber, the page field and a swipe-to-adjust all call the same function. Five features talking to the renderer directly is five places to fix when a sixth arrives.</div>
  <div style="margin-top:16px;max-width:820px">
    ${command('goToLocation(loc)', 'The primitive. An outline entry, a find hit, a bookmark and a note all speak one { page } — so the app never grows four ways of saying take me there.')}
    ${command('goToPage(n)', 'goToLocation({ page: n }), kept for the callers that only have a number. Clamped, pair-snapped in a spread, announced to assistive tech, recorded as deliberate.')}
    ${command('nextPage() / previousPage()', 'One page, or two when two are on screen. What a swipe-to-adjust routes to.')}
    ${command('setMode(mode)', 'Remounts the canvas and restores the page. Syncs to the document.')}
    ${command('setFit(policy)', 'Offered only in continuous; the other two modes size the page themselves.')}
    ${command('toggleBookmark()', 'Marks or unmarks the page on screen. Optimistic, because the icon filling half a second after the tap reads as a miss.')}
    ${command('toggleControls()', 'What a tap on the page does, and what pinching in and back out does.')}
    ${command('openNavigator(segment)', 'Contents, Bookmarks, Notes or Pages — one sheet, four answers to one question, all landing back on goToLocation.')}
    ${command('openSearch() / openPageJump()', 'The find bar over the chrome, and the field that takes a page number.')}
    ${command('closeReader()', 'Leaving writes the position, releases the wake lock and returns to portrait.')}
  </div>
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
    w: 390, h: 1044, bg: c.bg,
    body: `<div style="position:relative;height:1044px;overflow:hidden">
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
      ${row('listTree', 'Contents', false, '38 chapters, read out of the PDF itself')}
      ${row('check2', 'Mark as finished')}
      ${row('folderPlus', 'Add to collection')}
      ${row('folder', 'New collection with this')}
      ${row('heart', 'Remove from favourites')}
      ${row('cloudCheck', 'Keep on this device only', false, 'Removes the copy in your account')}
      ${row('phone', 'Remove from this device', false, 'Keeps it in your account — 4.1 MB freed')}
      ${row('pencil', 'Rename')}
      ${row('refresh', 'Reprocess', false, 'Reads the file again for its cover, pages and contents')}
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
/* ---------------------- processing and contents ------------------- */

/**
 * Home a second after an import.
 *
 * The document is already in Recently added with a real title and a real
 * position in the rail; only its cover is missing. Waiting for the whole probe
 * before showing anything is the version of this screen where a reader taps
 * Add and nothing happens for two seconds.
 */
function homeProcessing() {
  const c = DARK;
  const t = (title, opts) => tile(byTitle(title), { dark: true, ...opts });
  return dc({
    w: 390, h: 844, bg: c.bg,
    helmet: `    @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }\n    .bones { animation: pulse 2s cubic-bezier(.4,0,.6,1) infinite }\n`,
    body: `${header(c)}
${searchTrigger(c)}
${rail('Recently added', [
    t('Kubernetes', { processing: 'probing' }),
    t('Annual Report', { real: true }),
    t('Lease Agreement', { real: true }),
    t('Sapiens', { real: true }),
  ], c)}
${rail('Continue reading', [
    t('Thinking,', { showProgress: true, real: true }),
    t('The Design of', { showProgress: true, real: true }),
    t('Convex Backend', { showProgress: true }),
    t('Designing Data', { showProgress: true, real: true }),
  ], c)}
<div style="margin:26px ${PAD}px 0;display:flex;align-items:flex-start;gap:10px">
  ${icon('info', 13, c.fgSubtle, 2)}
  <span style="font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Kubernetes Up and Running is being read. Its cover, page count and contents land in a second or two; it is already openable.</span>
</div>`,
  });
}

/**
 * The four states a tile can be in while the probe runs, and after it fails.
 *
 * `failed` and `partial` exist because a cover that never rendered used to be
 * indistinguishable from a document that never had one, with nothing the reader
 * could do about either.
 */
function tileProcessing() {
  const c = DARK;
  const state = (label, node, note) => `<div style="width:${COVER_W}px"><div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle};margin-bottom:11px">${label}</div>${node}<div style="margin-top:10px;font-size:11px;line-height:15px;color:${c.fgSubtle}" class="pretty">${note}</div></div>`;
  const doc = byTitle('Kubernetes');
  return dc({
    w: 900, h: 720, bg: c.bg,
    helmet: `    @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }\n    .bones { animation: pulse 2s cubic-bezier(.4,0,.6,1) infinite }\n`,
    body: `<div style="padding:36px 40px">
  <div style="font-size:22px;font-weight:700;letter-spacing:-.02em;color:${c.fg}">Processing</div>
  <div style="margin-top:6px;max-width:660px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">One <span style="color:${c.fg}">&lt;Pdf&gt;</span> mount yields the page count, the table of contents and the cover together. The row is written before any of it, so the document is in the library and openable while the probe is still running.</div>
  <div style="margin-top:34px;display:flex;gap:${GAP + 24}px;align-items:flex-start">
    ${state('probing', tile(doc, { processing: 'probing' }), 'The row exists, the file is on disk, the probe is reading it. Tapping opens it — and if the probe never reports, the library picks the document up and reads it again.')}
    ${state('ready', tile(doc, { real: true }), 'Cover, page count and contents all landed. The state every document ends in.')}
    ${state('partial', tile(doc, { processing: 'partial' }), 'The page count came back and the snapshot did not. The tinted cover stands in, and Reprocess is offered.')}
    ${state('failed', tile(doc, { processing: 'failed' }), 'The viewer could not read the file at all. Nothing is hidden — the document stays, and says so.')}
  </div>
  <div style="margin-top:44px;height:1px;background:${c.hairline}"></div>
  <div style="margin-top:24px;display:flex;gap:40px">
    <div style="max-width:380px">
      <div style="font-size:13px;font-weight:600;color:${c.fg}">Probing is not a dead end</div>
      <div style="margin-top:6px;font-size:12px;line-height:18px;color:${c.fgMuted}" class="pretty">Add to library is live before the probe finishes, so committing early is the ordinary case rather than an edge one. The document lands as <span style="color:${c.fg}">probing</span> and home reads it again, one at a time. That is also what recovers a probe the app killed by going to the background.</div>
    </div>
    <div style="max-width:380px">
      <div style="font-size:13px;font-weight:600;color:${c.fg}">Why not a progress bar</div>
      <div style="margin-top:6px;font-size:12px;line-height:18px;color:${c.fgMuted}" class="pretty">The 2px track under a tile already carries reading position, and during a transfer it carries bytes sent. A third meaning in the same two pixels is a bar nobody can read.</div>
    </div>
    <div style="max-width:380px">
      <div style="font-size:13px;font-weight:600;color:${c.fg}">Text is a separate state</div>
      <div style="margin-top:6px;font-size:12px;line-height:18px;color:${c.fgMuted}" class="pretty">Only a synced document has text, because only a synced document exists somewhere the server can read it. It never appears on the tile — it belongs in Details, beside the thing it qualifies.</div>
    </div>
  </div>
</div>`,
  });
}

/**
 * The document's own table of contents.
 *
 * It arrives free: `onLoadComplete` hands back `tableContents` on the same load
 * that produced the cover. Depth is rendered as indentation and capped at three,
 * because a fourth level in a 390px sheet is four characters of title.
 */
function contentsSheet(hasOutline) {
  const c = DARK;
  const doc = byTitle('Thinking,');
  const entry = (title, page, depth, current = false) =>
    `<div style="min-height:44px;display:flex;align-items:center;gap:12px;padding:6px ${PAD}px 6px ${PAD + depth * 18}px;${current ? `background:${c.hover}` : ''}">
      <div style="flex:1;font-size:${depth === 0 ? 15 : 14}px;line-height:19px;${depth === 0 ? `font-weight:600;color:${c.fg}` : `color:${c.fgMuted}`};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</div>
      <span style="font-size:12px;color:${current ? c.primary : c.fgSubtle};flex:0 0 auto" class="tnum">${page}</span>
    </div>`;

  const list = hasOutline
    ? `${entry('Part I · Two Systems', 19, 0)}
      ${entry('The Characters of the Story', 30, 1)}
      ${entry('Attention and Effort', 39, 1)}
      ${entry('The Lazy Controller', 50, 1)}
      ${entry('Part II · Heuristics and Biases', 117, 0)}
      ${entry('The Law of Small Numbers', 142, 1, true)}
      ${entry('Anchors', 152, 1)}
      ${entry('The Science of Availability', 168, 1)}
      ${entry('Part III · Overconfidence', 235, 0)}
      ${entry('The Illusion of Understanding', 236, 1)}`
    : `<div style="padding:44px 40px 52px;text-align:center;display:flex;flex-direction:column;align-items:center">
         ${icon('listTree', 32, c.fgSubtle, 1.5)}
         <div style="margin-top:16px;font-size:16px;font-weight:600;letter-spacing:-.01em;color:${c.fg}">No contents in this PDF</div>
         <div style="margin-top:7px;max-width:280px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">Nothing was built into the file — most scans and exports carry none. Searching inside it still works.</div>
         <div style="margin-top:20px;height:40px;display:flex;align-items:center;gap:8px;padding:0 16px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}">
           ${icon('textSearch', 16, c.fg, 2)}
           <span style="font-size:14px;color:${c.fg}">Search inside</span>
         </div>
       </div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:#fdfdfc">
  <div style="padding:64px 40px 0;opacity:.5">
    <div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#8f8d88">Part II · Heuristics and Biases</div>
    <div style="margin-top:26px;font-size:15px;line-height:1.5;font-weight:700;color:#1a1a1a">The Law of Small Numbers</div>
  </div>
  <div style="position:absolute;inset:0;background:rgba(0,0,0,.62)"></div>
  <div style="position:absolute;left:0;right:0;bottom:0;background:${c.elevated};border-radius:${R} ${R} 0 0;box-shadow:0 -1px 0 ${c.border};padding-bottom:28px">
    <div style="display:flex;justify-content:center;padding:8px 0 4px"><div style="width:36px;height:4px;border-radius:${R};background:${c.borderStrong}"></div></div>
    <div style="display:flex;align-items:center;gap:12px;padding:10px ${PAD}px 14px">
      ${icon('listTree', 18, c.fgMuted)}
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:600;letter-spacing:-.01em;color:${c.fg}">Contents</div>
        <div style="margin-top:2px;font-size:12px;color:${c.fgSubtle};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${doc.t}</div>
      </div>
      ${hasOutline ? `<span style="font-size:12px;color:${c.fgSubtle}" class="tnum">38 entries</span>` : ''}
    </div>
    <div style="height:1px;background:${c.hairline}"></div>
    <div style="padding-top:4px">${list}</div>
  </div>
</div>`,
  });
}

/**
 * Searching inside documents, which only synced documents can answer.
 *
 * The results are pages, not documents, so each row carries a page number and
 * the line the term was found on. A document with no text layer says so in the
 * same list rather than being silently absent from it.
 */
function searchInside() {
  const c = DARK;
  const hit = (title, page, before, term, after) =>
    `<div style="padding:14px ${PAD}px;border-bottom:1px solid ${c.hairline}">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="flex:1;font-size:13px;font-weight:600;letter-spacing:-.008em;color:${c.fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</div>
        <span style="font-size:11px;color:${c.fgSubtle};flex:0 0 auto" class="tnum">page ${page}</span>
      </div>
      <div style="margin-top:5px;font-size:12px;line-height:18px;color:${c.fgMuted}" class="c2">${before}<span style="color:${c.fg};background:${c.primaryTint};border-radius:3px;padding:0 3px">${term}</span>${after}</div>
    </div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="height:844px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;gap:10px;padding:52px ${PAD}px 0">
    ${icon('arrowLeft', 22, c.fg, 2)}
    <div style="flex:1;height:40px;display:flex;align-items:center;gap:10px;padding:0 12px;border-radius:${R};background:${c.surface};box-shadow:inset 0 0 0 1px ${c.hairline}">
      ${icon('search', 16, c.fgSubtle)}
      <span style="font-size:14px;color:${c.fg}">anchoring</span>
    </div>
  </div>

  <div style="display:flex;gap:8px;padding:16px ${PAD}px 0">
    <div style="height:32px;display:flex;align-items:center;padding:0 13px;border-radius:${R};background:${c.fg}"><span style="font-size:13px;font-weight:500;color:${c.bg}">Inside documents</span></div>
    <div style="height:32px;display:flex;align-items:center;padding:0 13px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}"><span style="font-size:13px;color:${c.fgMuted}">Titles</span></div>
  </div>

  <div style="padding:16px ${PAD}px 10px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">7 pages in 2 documents</div>

  <div style="flex:1;border-top:1px solid ${c.hairline};overflow:hidden">
    ${hit('Thinking, Fast and Slow', 152, 'The phenomenon we were studying is so common and so important in the everyday world that you should know its name: it is an ', 'anchoring', ' effect.')}
    ${hit('Thinking, Fast and Slow', 153, 'Any number that you are asked to consider as a possible solution to an estimation problem will induce an ', 'anchoring', ' effect.')}
    ${hit('Thinking, Fast and Slow', 156, 'The main moral of priming research is that our thoughts and our behavior are influenced by ', 'anchors', ' we are not aware of.')}
    ${hit('The Design of Everyday Things', 88, 'Designers rely on the same ', 'anchoring', ' that makes a price tag work: the first number seen sets the scale for every one after it.')}

    <div style="display:flex;align-items:flex-start;gap:12px;padding:16px ${PAD}px">
      ${icon('scanText', 17, c.fgSubtle)}
      <div style="flex:1">
        <div style="font-size:13px;color:${c.fgMuted}">Annual Report 2025 was not searched</div>
        <div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">It is a scan with no text in it. Nothing to search until it is run through OCR.</div>
      </div>
    </div>

    <div style="display:flex;align-items:flex-start;gap:12px;padding:0 ${PAD}px 16px">
      ${icon('phone', 17, c.fgSubtle)}
      <div style="flex:1">
        <div style="font-size:13px;color:${c.fgMuted}">4 documents are on this phone only</div>
        <div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Searching inside a document reads the copy in your account. Turn on “Available on all devices” for one and it joins these results.</div>
      </div>
    </div>
  </div>
</div>`,
  });
}

/**
 * What was made from this document, and what was not.
 *
 * Four independent facts that used to be one silent boolean. Each one names its
 * own state, and the two that can be retried say so.
 */
function processingDetail() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  const line = (ic, label, value, tone = 'ok', note = null) => {
    const colour = tone === 'ok' ? c.fg : tone === 'wait' ? c.fgMuted : c.fgSubtle;
    return `<div style="display:flex;align-items:flex-start;gap:14px;padding:13px ${PAD}px">
      ${icon(ic, 18, tone === 'ok' ? c.fgMuted : c.fgSubtle)}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:baseline;gap:8px">
          <div style="flex:1;font-size:14px;color:${c.fg}">${label}</div>
          <span style="font-size:13px;color:${colour}" class="tnum">${value}</span>
        </div>
        ${note === null ? '' : `<div style="margin-top:3px;font-size:11px;line-height:16px;color:${c.fgSubtle}" class="pretty">${note}</div>`}
      </div>
    </div>`;
  };

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden">
  <div style="position:absolute;inset:0;background:rgba(0,0,0,.62)"></div>
  <div style="position:absolute;left:0;right:0;bottom:0;background:${c.elevated};border-radius:${R} ${R} 0 0;box-shadow:0 -1px 0 ${c.border};padding-bottom:28px">
    <div style="display:flex;justify-content:center;padding:8px 0 4px"><div style="width:36px;height:4px;border-radius:${R};background:${c.borderStrong}"></div></div>
    <div style="display:flex;gap:14px;align-items:center;padding:10px ${PAD}px 14px">
      ${pageCover(doc, { w: 44 })}
      <div style="min-width:0">
        <div style="font-size:15px;line-height:19px;font-weight:600;letter-spacing:-.01em;color:${c.fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${doc.t}</div>
        <div style="margin-top:3px;font-size:12px;color:${c.fgSubtle}">Daniel Kahneman · 4.1 MB</div>
      </div>
    </div>
    <div style="height:1px;background:${c.hairline}"></div>

    <div style="padding:10px ${PAD}px 4px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">On this device</div>
    ${line('filePlus', 'Pages', '499')}
    ${line('bookOpen', 'Cover', 'Page 1, rendered')}
    ${line('listTree', 'Contents', '38 entries')}

    <div style="height:1px;background:${c.hairline};margin-top:8px"></div>
    <div style="padding:12px ${PAD}px 4px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">In your account</div>
    ${line('cloudCheck', 'Copy', 'Synced 3 weeks ago')}
    ${line('scanText', 'Searchable text', 'Extracting · 218 of 499', 'wait', 'Read from the copy in your account, a page at a time. It resumes on its own if it is interrupted.')}

    <div style="height:1px;background:${c.hairline};margin-top:8px"></div>
    <div style="min-height:52px;display:flex;align-items:center;gap:14px;padding:8px ${PAD}px 4px">
      ${icon('refresh', 19, c.fgMuted)}
      <div style="flex:1">
        <div style="font-size:16px;color:${c.fg}">Reprocess</div>
        <div style="margin-top:2px;font-size:11px;color:${c.fgSubtle}">Reads the file again — the cover, the page count and the contents</div>
      </div>
    </div>
  </div>
</div>`,
  });
}

/**
 * Searching inside documents with no connection.
 *
 * Answered by the phone's own FTS5 index rather than by Convex, which is why
 * the caveat is above the results and not under them: this list is drawn from
 * what has been downloaded, and a reader owed an explanation for a short answer
 * should get it before they read the answer.
 */
function searchOffline() {
  const c = DARK;
  const hit = (title, page, before, term, after) =>
    `<div style="padding:14px ${PAD}px;border-bottom:1px solid ${c.hairline}">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="flex:1;font-size:13px;font-weight:600;letter-spacing:-.008em;color:${c.fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</div>
        <span style="font-size:11px;color:${c.fgSubtle};flex:0 0 auto" class="tnum">page ${page}</span>
      </div>
      <div style="margin-top:5px;font-size:12px;line-height:18px;color:${c.fgMuted}" class="c2">${before}<span style="color:${c.fg};background:${c.primaryTint};border-radius:3px;padding:0 3px">${term}</span>${after}</div>
    </div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="height:844px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;gap:10px;padding:52px ${PAD}px 0">
    ${icon('arrowLeft', 22, c.fg, 2)}
    <div style="flex:1;height:40px;display:flex;align-items:center;gap:10px;padding:0 12px;border-radius:${R};background:${c.surface};box-shadow:inset 0 0 0 1px ${c.hairline}">
      ${icon('search', 16, c.fgSubtle)}
      <span style="font-size:14px;color:${c.fg}">anchoring</span>
    </div>
  </div>

  <div style="display:flex;align-items:flex-start;gap:10px;padding:16px ${PAD}px 0">
    ${icon('cloudOff', 15, c.fgSubtle, 2)}
    <span style="flex:1;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Searching the copy on this phone. Documents whose text has not been downloaded yet are not in these results.</span>
  </div>

  <div style="padding:16px ${PAD}px 10px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">3 pages in 1 document</div>

  <div style="flex:1;border-top:1px solid ${c.hairline};overflow:hidden">
    ${hit('Thinking, Fast and Slow', 152, '…you should know its name: it is an ', 'anchoring', ' effect.')}
    ${hit('Thinking, Fast and Slow', 153, '…as a possible solution to an estimation problem will induce an ', 'anchoring', ' effect.')}
    ${hit('Thinking, Fast and Slow', 156, '…our thoughts and our behavior are influenced by ', 'anchors', ' we are not aware of.')}
  </div>
</div>`,
  });
}

/**
 * A PDF handed over by another app.
 *
 * The same screen the picker leads to — the file was chosen elsewhere, so the
 * only difference is the line saying where it came from. It goes through the
 * same header check: another app's idea of a PDF is exactly as trustworthy as a
 * filename.
 */
function importIncoming() {
  const c = DARK;
  const doc = byTitle('Lease Agreement');

  const field = (label, value, muted = false) => `<div style="margin-top:18px">
      <div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">${label}</div>
      <div style="margin-top:7px;height:44px;display:flex;align-items:center;padding:0 12px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}">
        <span style="font-size:14px;color:${muted ? c.fgSubtle : c.fg}">${value}</span>
      </div>
    </div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="height:844px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:20px ${PAD}px 0">
    <span style="font-size:14px;color:${c.fgMuted}">Cancel</span>
    <span style="font-size:16px;font-weight:600;letter-spacing:-.01em;color:${c.fg}">Add to library</span>
    <span style="font-size:14px;color:transparent">Cancel</span>
  </div>

  <div style="flex:1;padding:0 ${PAD}px;overflow:hidden">
    <div style="display:flex;justify-content:center;margin-top:26px">${pageCover(doc, { w: 132 })}</div>

    <div style="margin-top:20px;display:flex;align-items:center;gap:10px;justify-content:center">
      ${icon('share2', 13, c.fgSubtle, 2)}
      <span style="font-size:12px;color:${c.fgSubtle}">Opened from Files</span>
    </div>

    ${field('Title', doc.t)}
    ${field('Author', 'Optional', true)}

    <div style="margin-top:14px;display:flex;align-items:center;gap:6px">
      ${icon('info', 12, c.fgSubtle, 2)}
      <span style="font-size:12px;color:${c.fgSubtle}">PDF · 210 KB · 9 pages</span>
    </div>

    <div style="margin-top:22px;height:1px;background:${c.hairline}"></div>

    <div style="display:flex;align-items:flex-start;gap:14px;padding:18px 0">
      ${icon('cloudUp', 19, c.fgMuted)}
      <div style="flex:1">
        <div style="font-size:15px;color:${c.fg}">Available on all devices</div>
        <div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Keeps a copy in your account so your other phones can download it, and lets Pidom search inside it.</div>
      </div>
      <div style="width:44px;height:26px;border-radius:9999px;background:${c.primary};position:relative;flex:0 0 auto;margin-top:2px">
        <div style="position:absolute;right:3px;top:3px;width:20px;height:20px;border-radius:9999px;background:#ffffff"></div>
      </div>
    </div>
  </div>

  <div style="padding:0 ${PAD}px 34px">
    <div style="height:48px;display:flex;align-items:center;justify-content:center;border-radius:${R};background:${c.primary}">
      <span style="font-size:15px;font-weight:500;color:${c.onPrimary}">Add to library</span>
    </div>
  </div>
</div>`,
  });
}

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
  'ImportDuplicate.dc.html': importScreen('duplicate'),
  'ImportNotAPdf.dc.html': importRefusal('notapdf'),
  'ImportProtected.dc.html': importRefusal('protected'),
  'HomeProcessing.dc.html': homeProcessing(),
  'Contents.dc.html': contentsSheet(true),
  'ContentsEmpty.dc.html': contentsSheet(false),
  'SearchInside.dc.html': searchInside(),
  'ProcessingDetail.dc.html': processingDetail(),
  'TileProcessing.dc.html': tileProcessing(),
  'SearchOffline.dc.html': searchOffline(),
  'ImportIncoming.dc.html': importIncoming(),
  'OfflineStates.dc.html': offlineStates(),
  'SyncStates.dc.html': syncStates(),
  'Reader.dc.html': reader(true),
  'ReaderPlain.dc.html': reader(false),
  'ReaderOpening.dc.html': readerOpening(),
  'ReaderContinuous.dc.html': readerContinuous(),
  'ReaderSinglePage.dc.html': readerSinglePage(),
  'ReaderPageJump.dc.html': readerPageJump(),
  'ReaderScrubbing.dc.html': readerScrubbing(),
  'ReaderModes.dc.html': readerModes(),
  'ReaderSettings.dc.html': readerSettings(),
  'ReaderPassword.dc.html': readerPassword(),
  'ReaderFailed.dc.html': readerFailed(),
  'ReaderLink.dc.html': readerLink(),
  'ReaderFind.dc.html': readerFind(),
  'ReaderBookmarks.dc.html': readerBookmarks(),
  'ReaderNotes.dc.html': readerNotes(),
  'ReaderNotesEmpty.dc.html': readerNotesEmpty(),
  'ReaderThumbnails.dc.html': readerThumbnails(),
  'ReaderNoteCompose.dc.html': readerNoteCompose(),
  'ReaderBookmarkName.dc.html': readerBookmarkName(),
  'ReaderTint.dc.html': readerTint(),
  'ReaderSelection.dc.html': readerSelection(),
  'ReaderSpread.dc.html': readerSpread(),
  'ReaderAnatomy.dc.html': readerAnatomy(),
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
    { file: 'DocumentActionsFull.dc.html', title: 'Document actions — all of them', x: 4410, y: 3044, w: 390, h: 1044 },
    { file: 'SyncStates.dc.html', title: 'Where a document is', x: 0, y: 4344, w: 900, h: 560 },
    { file: 'TileAnatomy.dc.html', title: 'Document tile — anatomy and states', x: 0, y: 5024, w: 900, h: 1100 },
    { file: 'CoverSystem.dc.html', title: 'Generated covers', x: 1000, y: 5024, w: 1360, h: 640 },
    { file: 'HomeProcessing.dc.html', title: 'Home — a document still processing', x: 0, y: 6264, w: 390, h: 844 },
    { file: 'ImportDuplicate.dc.html', title: 'Import — already in the library', x: 490, y: 6264, w: 390, h: 844 },
    { file: 'ImportNotAPdf.dc.html', title: 'Import — not a PDF', x: 980, y: 6264, w: 390, h: 844 },
    { file: 'ImportProtected.dc.html', title: 'Import — password protected', x: 1470, y: 6264, w: 390, h: 844 },
    { file: 'Contents.dc.html', title: 'Contents — the PDF\u2019s own outline', x: 1960, y: 6264, w: 390, h: 844 },
    { file: 'ContentsEmpty.dc.html', title: 'Contents — none in the file', x: 2450, y: 6264, w: 390, h: 844 },
    { file: 'SearchInside.dc.html', title: 'Search inside documents', x: 2940, y: 6264, w: 390, h: 844 },
    { file: 'ProcessingDetail.dc.html', title: 'Details — what was made from it', x: 3430, y: 6264, w: 390, h: 844 },
    { file: 'SearchOffline.dc.html', title: 'Search inside — with no connection', x: 3920, y: 6264, w: 390, h: 844 },
    { file: 'ImportIncoming.dc.html', title: 'Import — opened from another app', x: 4410, y: 6264, w: 390, h: 844 },
    { file: 'TileProcessing.dc.html', title: 'Document tile — processing states', x: 0, y: 7228, w: 900, h: 720 },
    { file: 'ReaderOpening.dc.html', title: 'Reader — opening', x: 0, y: 8068, w: 390, h: 844 },
    { file: 'ReaderContinuous.dc.html', title: 'Reader — continuous scroll', x: 490, y: 8068, w: 390, h: 844 },
    { file: 'ReaderSinglePage.dc.html', title: 'Reader — one page at a time', x: 980, y: 8068, w: 390, h: 844 },
    { file: 'ReaderPageJump.dc.html', title: 'Reader — jump to a page', x: 1470, y: 8068, w: 390, h: 844 },
    { file: 'ReaderScrubbing.dc.html', title: 'Reader — dragging to a page', x: 1960, y: 8068, w: 390, h: 844 },
    { file: 'ReaderModes.dc.html', title: 'Reader — how it reads', x: 2450, y: 8068, w: 390, h: 844 },
    { file: 'ReaderSettings.dc.html', title: 'Reader — settings', x: 2940, y: 8068, w: 390, h: 844 },
    { file: 'ReaderPassword.dc.html', title: 'Reader — this PDF has a password', x: 3430, y: 8068, w: 390, h: 844 },
    { file: 'ReaderFailed.dc.html', title: 'Reader — this file will not open', x: 3920, y: 8068, w: 390, h: 844 },
    { file: 'ReaderLink.dc.html', title: 'Reader — a link in the document', x: 4410, y: 8068, w: 390, h: 844 },
    { file: 'ReaderFind.dc.html', title: 'Reader — find in this document', x: 0, y: 10332, w: 390, h: 844 },
    { file: 'ReaderBookmarks.dc.html', title: 'Navigator — the pages you marked', x: 490, y: 10332, w: 390, h: 844 },
    { file: 'ReaderTint.dc.html', title: 'Reader — a layer over the page', x: 980, y: 10332, w: 390, h: 844 },
    { file: 'ReaderSelection.dc.html', title: 'Reader — text you selected', x: 1470, y: 10332, w: 390, h: 844 },
    { file: 'ReaderNotes.dc.html', title: 'Navigator — passages and notes you kept', x: 0, y: 11296, w: 390, h: 844 },
    { file: 'ReaderNotesEmpty.dc.html', title: 'Navigator — nothing kept yet', x: 490, y: 11296, w: 390, h: 844 },
    { file: 'ReaderThumbnails.dc.html', title: 'Navigator — every page at once', x: 980, y: 11296, w: 390, h: 844 },
    { file: 'ReaderNoteCompose.dc.html', title: 'Reader — writing a note', x: 1470, y: 11296, w: 390, h: 844 },
    { file: 'ReaderBookmarkName.dc.html', title: 'Reader — naming a bookmark', x: 1960, y: 11296, w: 390, h: 844 },
    { file: 'ReaderAnatomy.dc.html', title: 'Reader — chrome, lifecycle, commands', x: 0, y: 9032, w: 900, h: 1180 },
    { file: 'ReaderSpread.dc.html', title: 'Reader — two pages, landscape', x: 1000, y: 9032, w: 1024, h: 768 },
  ],
  annotations: [
    { id: 'note-boundary', x: 0, y: -150, w: 880, text: 'Convex owns metadata, the device owns the PDF.\nRendering this screen never touches a file. Every rail below is one query and one index scan; "On this device" is answered by the filesystem, not the server.' },
    { id: 'note-norails', x: 1960, y: 2080, w: 300, text: 'A rail with nothing in it renders nothing — a new account falls through to the empty state rather than showing six empty headings.' },
    { id: 'note-processing', x: 0, y: 6114, w: 880, text: 'One <Pdf> mount answers three questions at once: how many pages, what the contents are, and what the first page looks like. The row is written before any of them, so the document is in the library and openable while the probe is still running.' },
    { id: 'note-text', x: 2940, y: 6114, w: 380, text: 'Searching inside a document reads the copy in your account, not the file on this phone \u2014 it is the one thing the server can see. A local-only document is absent from these results and says so.' },
    { id: 'note-find', x: 0, y: 10182, w: 880, text: 'Finding inside a document is the search that already existed, asked a narrower question.\nThe page text is extracted for every synced document and mirrored into the phone\u2019s own index, and both were already scoped by document \u2014 so find works with no connection, and the reader never leaves the page to use it.' },
    { id: 'note-reader', x: 0, y: 7918, w: 880, text: 'The renderer owns the page; the app owns everything around it.\nZoom, panning and page rendering are native and are left alone — a second zoom engine over a renderer that already has one is two gesture recognisers fighting. What React Native adds is the chrome, the modes, and one goToPage every feature calls.' },
    { id: 'note-kept', x: 0, y: 11146, w: 880, text: 'Four answers to one question, on a screen rather than in a sheet.\nA sheet is as tall as its content, so moving from Contents (355 rows) to Bookmarks (one) shrank it by two thirds and took the segmented control down with it \u2014 the next tap landed on the backdrop and dismissed it. A control does not hang off a box whose height is the reader\u2019s data.\nAnd nothing is drawn on the page: react-native-pdf reports selected text and no rectangles, so the mark lives in this list where it can be accurate.' },
    { id: 'note-pages', x: 980, y: 11146, w: 380, text: 'Each cell is an image, not a renderer. Nine live <Pdf> views over one file took eight seconds to paint a screen, measured on a device. A page is rendered once by a single off-screen viewer, kept on disk, and read back \u2014 so the same screen fills in about two seconds and the second visit is immediate. Past 1,200 pages the segment is absent rather than slow.' },
    { id: 'note-covers', x: 1960, y: 2360, w: 300, text: 'No cards anywhere. The cover is the only filled shape on the surface; sections are separated by whitespace, and the one rule on the screen sits above View all library.' },
  ],
  launch: { view: 'canvas' },
};
writeFileSync(new URL('./canvas.json', import.meta.url), JSON.stringify(canvas, null, 2));
console.log('wrote', Object.keys(out).length, 'artboards + canvas.json');
