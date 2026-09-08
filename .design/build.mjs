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
  wifiOff: '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  hardDrive: '<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01"/><path d="M10 16h.01"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  /* Sharing. People, permission, and the two ways a notification can be. */
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
  userCheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
  shieldCheck: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  bellOff: '<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  mailOpen: '<path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0z"/><path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  messageSquare: '<path d="M22 17a2 2 0 0 1-2 2H6l-4 4V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
  atSign: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/>',
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
${notice(icon('cloudOff', 13, c.fgSubtle, 2), 'Your account has not answered for 2 hours. Everything here is on this device.')}
${rail('Continue reading', [t('Thinking,', { showProgress: true }), t('The Design of', { showProgress: true }), t('Convex Backend', { showProgress: true }), t('Designing Data', { showProgress: true })], c)}
${rail('On this device', [t('Annual Report'), t('Lease Agreement'), t('Convex Backend'), t('The Pragmatic')], c)}
<div style="margin-top:40px;height:1px;background:${c.hairline}"></div>
<div style="padding:40px ${PAD}px 0;text-align:center">
  <div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">And on a phone that has nothing yet</div>
</div>
<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:36px 40px 0;text-align:center">
  ${icon('cloudOff', 40, c.fgSubtle, 1.5)}
  <div style="margin-top:20px;font-size:20px;line-height:26px;font-weight:700;letter-spacing:-.018em;color:${c.fg}">Can&#39;t reach Pidom</div>
  <div style="margin-top:8px;max-width:286px;font-size:14px;line-height:21px;color:${c.fgMuted}" class="pretty">This phone has not finished its first sync, so there is nothing here to show yet. Your library is safe in your account and arrives when this device can reach it.</div>
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
    w: 1024, h: 600, bg: c.bg,
    body: `<div style="padding:36px 40px">
  <div style="font-size:22px;font-weight:700;letter-spacing:-.02em;color:${c.fg}">Where a document is</div>
  <div style="margin-top:6px;max-width:760px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">Five states, and the tile draws all five. A document can be on this phone, in the account but not here yet, arriving, on this phone and nowhere else, or here and unreadable. The account and the device are separate facts, and the tile never conflates them — every one of these comes from the filesystem and from checking the bytes, never from a flag the account set.</div>

  <div style="margin-top:34px;display:flex;gap:38px">
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

    ${state('Would not open',
      tileWith(byTitle('Kubernetes'), {
        cover: `<div style="opacity:.45">${pageCover(byTitle('Kubernetes'))}</div>`,
        meta: 'Try again',
        glyph: icon('alert', 11, c.fgMuted, 2),
        dim: true,
      }),
      'It arrived, and it is not the document. Offers to fetch it again rather than opening to nothing.')}
  </div>

  <div style="margin-top:44px;height:1px;background:${c.hairline}"></div>
  <div style="margin-top:24px;max-width:820px;font-size:12px;line-height:18px;color:${c.fgSubtle}" class="pretty">Files live in Cloudflare R2, so the 100 MB limit is a product decision rather than a platform one. Downloads use a URL the server signs after checking ownership, valid for five minutes. The earlier limit was 20 MB and was Convex&#39;s: an HTTP action response is capped there on every plan, so anything larger would have uploaded and then never come back down.</div>
  <div style="margin-top:14px;max-width:820px;font-size:12px;line-height:18px;color:${c.fgSubtle}" class="pretty">A transfer that finished is not the same fact as a document that opens, which is what the fifth state is for. Bytes that arrive are checked against the size the account recorded, the first five bytes of a PDF, and the fingerprint taken at import — and a file that fails any of the three is deleted rather than left under a name the library reads as ready. Two further states, <span style="color:${c.fg}">deleting</span> and <span style="color:${c.fg}">deleted</span>, exist so a half-finished removal can be finished; neither is ever drawn.</div>
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

/* ------------------------- offline-first ------------------------- */

/**
 * The strip that says the library is running on a remembered account.
 *
 * Deliberately the same shape as the stale notice beside it: full bleed, two
 * hairlines, one sentence. A reader who launched in a tunnel is having an
 * ordinary morning, not an incident.
 */
function identityNotice(c, glyph, text, trailing = true) {
  return `<div style="margin-top:20px;display:flex;align-items:center;gap:8px;padding:10px ${PAD}px;background:${c.surface};box-shadow:inset 0 1px 0 ${c.hairline}, inset 0 -1px 0 ${c.hairline}">
      ${glyph}<span style="flex:1;font-size:12px;color:${c.fgSubtle}" class="pretty">${text}</span>${trailing ? icon('refresh', 13, c.fgSubtle, 2) : ''}
    </div>`;
}

function offlineIdentity() {
  const c = DARK;
  const t = (title, opts) => tile(byTitle(title), { dark: true, ...opts });
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `${header(c)}
${searchTrigger(c)}
${identityNotice(c, icon('wifiOff', 13, c.fgSubtle, 2), 'Opened with no connection. Everything here is on this device; your account catches up when there is one.', false)}
${rail('Continue reading', [t('Thinking,', { showProgress: true }), t('The Design of', { showProgress: true }), t('Convex Backend', { showProgress: true }), t('Designing Data', { showProgress: true })], c)}
${rail('On this device', [t('Annual Report'), t('Lease Agreement'), t('Convex Backend'), t('The Pragmatic')], c)}
${rail('Recently added', [t('React Native Performance'), t('The Pragmatic'), t('Kubernetes'), t('Domain-Driven')], c)}`,
  });
}

/** A row in the sync screen: what changed, and what it belongs to. */
function syncRow(c, { title, detail, glyph, trailing = '' }) {
  return `<div style="display:flex;align-items:flex-start;gap:12px;padding:14px ${PAD}px;border-bottom:1px solid ${c.hairline}">
      <div style="margin-top:2px">${glyph}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;letter-spacing:-.008em;color:${c.fg}" class="c2">${title}</div>
        <div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${detail}</div>
      </div>
      ${trailing}
    </div>`;
}

function syncLabel(c, text, top = 26) {
  return `<div style="padding:${top}px ${PAD}px 9px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">${text}</div>`;
}

function syncScreenShell(c, { status, body }) {
  return `<div style="height:844px;display:flex;flex-direction:column;overflow:hidden">
  <div style="display:flex;align-items:center;gap:10px;padding:44px ${PAD}px 12px">
    ${icon('arrowLeft', 22, c.fg, 2)}
    <span style="font-size:16px;font-weight:600;letter-spacing:-.01em;color:${c.fg}">Sync</span>
  </div>
  ${status}
  <div style="flex:1;overflow:hidden">${body}</div>
</div>`;
}

function syncActivity() {
  const c = DARK;

  const status = `<div style="display:flex;align-items:flex-start;gap:12px;padding:6px ${PAD}px 18px">
      ${icon('cloudUp', 19, c.primary)}
      <div style="flex:1">
        <div style="font-size:15px;color:${c.fg}">Sending 4 changes</div>
        <div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Everything below is already saved on this device. This is only your account catching up.</div>
      </div>
    </div>`;

  const bar = (pct, label) => `<div style="width:104px;flex:0 0 auto">
      <div style="font-size:11px;color:${c.fgSubtle};text-align:right" class="tnum">${label}</div>
      <div style="margin-top:6px;height:2px;border-radius:${R};background:${c.border};overflow:hidden"><div style="width:${pct}%;height:100%;border-radius:${R};background:${c.primary}"></div></div>
    </div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: syncScreenShell(c, {
      status,
      body: `${syncLabel(c, 'Waiting', 0)}
${syncRow(c, {
        glyph: icon('bookOpen', 15, c.fgMuted, 2),
        title: 'Where you are in Thinking, Fast and Slow',
        detail: 'Page 216. Two hundred page turns became one change to send.',
      })}
${syncRow(c, {
        glyph: icon('notebookPen', 15, c.fgMuted, 2),
        title: 'A note in Designing Data-Intensive Applications',
        detail: 'Written on page 88, on the train.',
      })}
${syncRow(c, {
        glyph: icon('heart', 15, c.fgMuted, 2),
        title: 'Annual Report 2025 added to favourites',
        detail: 'And renamed. Both go in one message.',
      })}
${syncRow(c, {
        glyph: icon('filePlus', 15, c.fgMuted, 2),
        title: 'Lease Agreement — 14 Kilimani Road',
        detail: 'Imported here with no connection. Your account has not met it yet.',
      })}
${syncLabel(c, 'Moving now')}
${syncRow(c, {
        glyph: icon('cloudDown', 15, c.fgMuted, 2),
        title: 'Sapiens: A Brief History of Humankind',
        detail: 'Downloading to this device.',
        trailing: bar(43, '2.9 of 6.8 MB'),
      })}
<div style="display:flex;align-items:center;gap:8px;padding:22px ${PAD}px 0">
  ${icon('clock', 13, c.fgSubtle, 2)}
  <span style="font-size:12px;color:${c.fgSubtle}">Last synced 2 minutes ago</span>
</div>`,
    }),
  });
}

function syncActivityFailed() {
  const c = DARK;

  const action = (label, danger = false) => `<div style="height:32px;display:flex;align-items:center;padding:0 12px;border-radius:${R};box-shadow:inset 0 0 0 1px ${danger ? c.border : c.border}">
      <span style="font-size:13px;font-weight:500;color:${danger ? c.fgMuted : c.fg}">${label}</span>
    </div>`;

  const status = `<div style="display:flex;align-items:flex-start;gap:12px;padding:6px ${PAD}px 18px">
      ${icon('alert', 19, c.fgMuted)}
      <div style="flex:1">
        <div style="font-size:15px;color:${c.fg}">One change would not go</div>
        <div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">It is still here and still yours. Your account is the only thing that has not been told.</div>
      </div>
    </div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: syncScreenShell(c, {
      status,
      body: `${syncLabel(c, 'Would not go through', 0)}
<div style="padding:14px ${PAD}px;border-bottom:1px solid ${c.hairline}">
  <div style="display:flex;align-items:flex-start;gap:12px">
    <div style="margin-top:2px">${icon('notebookPen', 15, c.destructive, 2)}</div>
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:600;letter-spacing:-.008em;color:${c.fg}" class="c2">A note in Designing Data-Intensive Applications</div>
      <div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Your account would not accept it. Tried 8 times over 40 minutes.</div>
    </div>
  </div>
  <div style="margin-top:12px;margin-left:27px;display:flex;gap:8px">
    ${action('Try again')}
    ${action('Discard', true)}
  </div>
</div>
${syncLabel(c, 'Waiting')}
${syncRow(c, {
        glyph: icon('bookOpen', 15, c.fgMuted, 2),
        title: 'Where you are in Thinking, Fast and Slow',
        detail: 'Page 216.',
      })}
<div style="padding:22px ${PAD}px 0">
  <div style="font-size:12px;line-height:18px;color:${c.fgSubtle}" class="pretty">Discarding drops the change from this queue. It does not undo anything in your library — the note stays on this phone, and simply never reaches your other devices.</div>
</div>`,
    }),
  });
}

function accountSync() {
  const c = DARK;

  const label = (text) => `<div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">${text}</div>`;
  const infoRow = (title, hint) => `<div style="padding:12px 4px">
      <div style="font-size:14px;color:${c.fg}">${title}</div>
      <div style="margin-top:4px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${hint}</div>
    </div>`;
  const tapRow = (ic, title, hint) => `<div style="display:flex;align-items:center;gap:12px;padding:12px 4px;border-radius:${R}">
      ${icon(ic, 19, c.fgMuted)}
      <div style="flex:1">
        <div style="font-size:14px;color:${c.fg}">${title}</div>
        <div style="margin-top:3px;font-size:12px;color:${c.fgSubtle}">${hint}</div>
      </div>
      ${icon('chevronRight', 16, c.fgSubtle, 2)}
    </div>`;
  const rule = `<div style="height:1px;background:${c.hairline};margin:20px 0"></div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="height:844px;overflow:hidden">
  <div style="display:flex;align-items:center;padding:44px 16px 8px">${icon('arrowLeft', 22, c.fg, 2)}</div>

  <div style="padding:0 ${PAD}px 40px">
    <div style="display:flex;flex-direction:column;align-items:center;padding-top:16px;gap:12px">
      <div style="width:80px;height:80px;border-radius:9999px;background:${c.primary};display:flex;align-items:center;justify-content:center;font-size:29px;font-weight:600;color:${c.onPrimary}">EG</div>
      <div style="text-align:center">
        <div style="font-size:20px;line-height:26px;font-weight:700;letter-spacing:-.018em;color:${c.fg}">Emmanuel Gichuhi</div>
        <div style="margin-top:4px;font-size:14px;color:${c.fgMuted}">egichuhi580@gmail.com</div>
      </div>
    </div>

    ${rule}
    ${label('Appearance')}
    <div style="margin-top:4px">
      <div style="display:flex;align-items:center;gap:12px;padding:12px 4px">${icon('moon', 19, c.fgMuted)}<span style="flex:1;font-size:14px;color:${c.fg}">Dark</span>${icon('check', 17, c.primary, 2)}</div>
    </div>

    ${rule}
    ${label('Storage')}
    <div style="margin-top:4px">
      ${infoRow('4 documents in your account', '18.4 MB synced, so any device can download them.')}
      ${tapRow('hardDrive', '1.4 GB on this device', '11 documents. 8.2 GB free.')}
    </div>

    ${rule}
    ${label('Sync')}
    <div style="margin-top:4px">
      ${tapRow('cloudUp', '4 changes waiting', 'Last synced 2 minutes ago')}
    </div>

    ${rule}
    ${label('Account')}
    <div style="margin-top:4px">${infoRow('Signed in with Google', 'Library created 3 March 2026')}</div>
    <div style="display:flex;align-items:center;gap:12px;padding:12px 4px">${icon('logOut', 19, c.destructive)}<span style="font-size:14px;color:${c.destructive}">Sign out</span></div>
  </div>
</div>`,
  });
}

function importOffline() {
  const c = DARK;
  const doc = byTitle('Lease Agreement');

  const field = (labelText, value, muted = false) => `<div style="margin-top:18px">
      <div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">${labelText}</div>
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

    ${field('Title', doc.t)}
    ${field('Author', 'Optional', true)}

    <div style="margin-top:14px;display:flex;align-items:center;gap:6px">
      ${icon('info', 12, c.fgSubtle, 2)}
      <span style="font-size:12px;color:${c.fgSubtle}">PDF · 210 KB · 9 pages</span>
    </div>

    <div style="margin-top:22px;height:1px;background:${c.hairline}"></div>

    <div style="display:flex;align-items:flex-start;gap:14px;padding:18px 0">
      ${icon('wifiOff', 19, c.fgDisabled)}
      <div style="flex:1">
        <div style="font-size:15px;color:${c.fgDisabled}">Available on all devices</div>
        <div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">There is no connection, so the copy for your other devices waits. This one is added here now and opens straight away.</div>
      </div>
      <div style="width:44px;height:26px;border-radius:9999px;background:${c.border};position:relative;flex:0 0 auto;margin-top:2px;opacity:.5">
        <div style="position:absolute;left:3px;top:3px;width:20px;height:20px;border-radius:9999px;background:${c.fgDisabled}"></div>
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

function importNoSpace() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="height:844px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:20px ${PAD}px 0">
    <span style="font-size:14px;color:${c.fgMuted}">Cancel</span>
    <span style="font-size:16px;font-weight:600;letter-spacing:-.01em;color:${c.fg}">Add to library</span>
    <span style="font-size:14px;color:transparent">Cancel</span>
  </div>

  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 40px;text-align:center">
    ${icon('hardDrive', 40, c.fgSubtle, 1.5)}
    <div style="margin-top:20px;font-size:20px;line-height:26px;font-weight:700;letter-spacing:-.018em;color:${c.fg}">Not enough room</div>
    <div style="margin-top:8px;max-width:286px;font-size:14px;line-height:21px;color:${c.fgMuted}" class="pretty">This document needs 317 MB and there is 184 MB free on this device. Nothing has been written, and your library is untouched.</div>
    <div style="margin-top:24px;height:44px;display:flex;align-items:center;padding:0 20px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}">
      <span style="font-size:14px;font-weight:500;color:${c.fg}">Manage storage</span>
    </div>
  </div>

  <div style="padding:0 ${PAD}px 34px">
    <div style="font-size:12px;line-height:18px;color:${c.fgSubtle};text-align:center" class="pretty">Asked before anything is copied. A phone filled to the last byte fails at everything at once a minute later, not at the thing that filled it.</div>
  </div>
</div>`,
  });
}

/* --------------------- documentation boards ---------------------- */

function localFirst() {
  const c = DARK;

  const box = (title, lines, { tint = false } = {}) => `<div style="flex:1;min-width:0;border-radius:${R};padding:16px;box-shadow:inset 0 0 0 1px ${tint ? c.primary : c.border};background:${tint ? c.primaryTint : 'transparent'}">
      <div style="font-size:13px;font-weight:600;letter-spacing:-.008em;color:${c.fg}">${title}</div>
      ${lines.map((line) => `<div style="margin-top:7px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${line}</div>`).join('')}
    </div>`;

  const arrow = `<div style="display:flex;align-items:center;padding:0 2px;flex:0 0 auto">${icon('arrowRight', 16, c.fgDisabled, 2)}</div>`;

  return dc({
    w: 900, h: 620, bg: c.bg,
    body: `<div style="padding:36px 40px">
  <div style="font-size:22px;font-weight:700;letter-spacing:-.02em;color:${c.fg}">Where a read and a write actually go</div>
  <div style="margin-top:6px;max-width:700px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">The device is the first source, not the fallback. Nothing a reader does in the ordinary course of reading waits on a network, and the account is the layer the phone converges with afterwards.</div>

  <div style="margin-top:30px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">Opening page 438</div>
  <div style="margin-top:12px;display:flex;align-items:stretch;gap:10px">
    ${box('Tap a tile', ['The rail was drawn from rows in the local database. No query was in flight.'])}
    ${arrow}
    ${box('Look the document up', ['One indexed read on this phone. It answers in a frame.'], { tint: true })}
    ${arrow}
    ${box('Open the file', ['Documents/library/&lt;profile&gt;/&lt;id&gt;.pdf, verified when it arrived.'])}
    ${arrow}
    ${box('Restore the page', ['Kept on every page turn, so a force-quit costs a paragraph.'])}
  </div>

  <div style="margin-top:30px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">Keeping a passage</div>
  <div style="margin-top:12px;display:flex;align-items:stretch;gap:10px">
    ${box('Tap Keep', ['The reader is finished the moment the row is written.'])}
    ${arrow}
    ${box('Write it down', ['One row in the local database, with this device&#39;s clock on it.'], { tint: true })}
    ${arrow}
    ${box('Put it in the outbox', ['One row per thing, so a hundred page turns are one message.'])}
    ${arrow}
    ${box('Tell the account, later', ['When there is a connection. Nothing on screen waited for this.'])}
  </div>

  <div style="margin-top:34px;height:1px;background:${c.hairline}"></div>
  <div style="margin-top:22px;display:flex;gap:40px">
    <div style="flex:1;display:flex;align-items:flex-start;gap:10px">
      ${icon('database', 16, c.fgMuted, 2)}
      <div style="font-size:12px;line-height:18px;color:${c.fgSubtle}" class="pretty"><span style="color:${c.fg}">SQLite answers what.</span> Documents, marks, notes, collections, where you are, and what is queued. Encrypted, because it also holds the words of every synced document.</div>
    </div>
    <div style="flex:1;display:flex;align-items:flex-start;gap:10px">
      ${icon('hardDrive', 16, c.fgMuted, 2)}
      <div style="font-size:12px;line-height:18px;color:${c.fgSubtle}" class="pretty"><span style="color:${c.fg}">The filesystem answers where.</span> The PDFs, their covers and their page pictures. Never in the database, and never in the cache directory, which the system may empty.</div>
    </div>
  </div>
</div>`,
  });
}

function syncPipeline() {
  const c = DARK;

  const stage = (n, title, body) => `<div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:20px;height:20px;border-radius:9999px;background:${c.hover};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:${c.fgMuted}">${n}</div>
        <div style="font-size:13px;font-weight:600;letter-spacing:-.008em;color:${c.fg}">${title}</div>
      </div>
      <div style="margin-top:8px;font-size:12px;line-height:18px;color:${c.fgSubtle}" class="pretty">${body}</div>
    </div>`;

  const verdict = (code, ruling, why, tone) => `<div style="display:flex;align-items:flex-start;gap:14px;padding:13px 0;border-bottom:1px solid ${c.hairline}">
      <div style="width:132px;flex:0 0 auto;font-size:12px;font-weight:600;letter-spacing:.02em;color:${tone}" class="tnum">${code}</div>
      <div style="width:150px;flex:0 0 auto;font-size:12px;color:${c.fg}">${ruling}</div>
      <div style="flex:1;font-size:12px;line-height:18px;color:${c.fgSubtle}" class="pretty">${why}</div>
    </div>`;

  return dc({
    w: 1024, h: 700, bg: c.bg,
    body: `<div style="padding:36px 40px">
  <div style="font-size:22px;font-weight:700;letter-spacing:-.02em;color:${c.fg}">The outbox</div>
  <div style="margin-top:6px;max-width:760px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">A durable queue in the same database as everything else, so a change survives a force-quit. The Convex client keeps its own queue in memory and has no way to persist it — which is why a favourite marked in a tunnel used to be gone by the next launch.</div>

  <div style="margin-top:30px;display:flex;gap:34px">
    ${stage(1, 'Write, then queue', 'The change lands in the local database first. One queue row per thing changed, named for the thing rather than the change.')}
    ${stage(2, 'Coalesce by construction', 'Two hundred page turns collide on one row. What is recorded is which fields moved; the values are read off the row when it is finally sent.')}
    ${stage(3, 'Send in order', 'Oldest first, one at a time. A note cannot be created before the document it is on, and the order the reader made them in is the order they land.')}
    ${stage(4, 'Read the account back', 'Only once the queue is empty. Reconciling with work still waiting would overwrite the reader with a version that predates them.')}
  </div>

  <div style="margin-top:36px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">What an answer means</div>
  <div style="margin-top:14px">
    ${verdict('RATE_LIMITED', 'Wait exactly that long', 'The error carries how many milliseconds. Waiting is the instruction; counting it as a failed attempt would spend the retry budget on a queue behaving as designed.', c.fgMuted)}
    ${verdict('FORBIDDEN on a delete', 'Done', 'Missing and not-yours are reported identically so that nobody can enumerate ids. On a delete both readings end in the same place: there is nothing there. Retrying is retrying for ever.', c.ok)}
    ${verdict('FORBIDDEN on a create', 'Drop it here too', 'A create cannot fail to find a row it is about to make, so this is the parent: the document was deleted on another phone, and the note goes with it.', c.fgMuted)}
    ${verdict('INVALID', 'Stop, and say so', 'The account refused the content and will refuse it again. The only outcome worth a reader&#39;s attention, and the only one the sync screen shows.', c.destructive)}
    ${verdict('Anything else', 'Back off and return', 'Doubling from four seconds with jitter, to five minutes, eight times — so fifty operations that failed on one dropped socket do not all come back at once.', c.fgMuted)}
  </div>

  <div style="margin-top:26px;display:flex;align-items:flex-start;gap:10px;max-width:820px">
    ${icon('alert', 15, c.fgMuted, 2)}
    <div style="font-size:12px;line-height:18px;color:${c.fgSubtle}" class="pretty">Transfers are not in this queue. <span style="color:${c.fg}">library.uploadUrl</span> deletes whatever is at the key before it signs a new URL, so replaying it against an already-synced document destroys the copy in the account while the row goes on claiming there is one. Asking for a cloud copy offline records an intention; the bytes move in the foreground, once, when there is a connection.</div>
  </div>
</div>`,
  });
}

/* ── on this device ─────────────────────────────────────────────────── */

/**
 * What the library takes up on this phone, and what removing any of it costs.
 *
 * The screen `space.ts` has always assumed. Refusing an import says "remove a
 * download or two and try again", which is advice with nowhere to act on it —
 * no surface said which downloads were large, and the account's Storage section
 * reported only what was in the *account*.
 *
 * The distinction every row carries is the one that matters: a document in the
 * account comes back on a tap, and a document that is only here does not come
 * back at all. Same gesture, two different consequences, so the row says which
 * before the reader commits rather than after.
 */
function deviceStorageScreen(c, { free, used, rows, notices = '' }) {
  return `<div style="height:844px;display:flex;flex-direction:column;overflow:hidden">
  <div style="display:flex;align-items:center;gap:10px;padding:44px ${PAD}px 12px">
    ${icon('arrowLeft', 22, c.fg, 2)}
    <span style="font-size:16px;font-weight:600;letter-spacing:-.01em;color:${c.fg}">On this device</span>
  </div>

  <div style="display:flex;align-items:flex-start;gap:12px;padding:6px ${PAD}px 18px">
    ${icon('hardDrive', 19, c.primary)}
    <div style="flex:1">
      <div style="font-size:15px;color:${c.fg}" class="tnum">${used}</div>
      <div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${free}</div>
    </div>
  </div>
${notices}
  <div style="flex:1;overflow:hidden">${rows}</div>
</div>`;
}

/**
 * One document, its size, and what removing it would mean.
 *
 * No cover. This is the one library surface where the document is a quantity
 * rather than a thing to open — the reader is deciding what to lose, and a
 * column of covers would sell them each one back.
 */
function storageRow(c, { title, detail, size, recoverable }) {
  return `<div style="display:flex;align-items:flex-start;gap:12px;padding:14px ${PAD}px;border-bottom:1px solid ${c.hairline}">
      <div style="margin-top:2px">${icon(recoverable ? 'cloudCheck' : 'phone', 15, recoverable ? c.fgMuted : c.destructive, 2)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;letter-spacing:-.008em;color:${c.fg}" class="c2">${title}</div>
        <div style="margin-top:3px;font-size:12px;line-height:17px;color:${recoverable ? c.fgSubtle : c.destructive}" class="pretty">${detail}</div>
      </div>
      <div style="flex:0 0 auto;text-align:right">
        <div style="font-size:12px;color:${c.fgMuted}" class="tnum">${size}</div>
        <div style="margin-top:5px;font-size:12px;color:${c.primary}">Remove</div>
      </div>
    </div>`;
}

/** A quiet line above the list. Never a banner: nothing here is an emergency. */
function storageNotice(c, glyph, text, tone) {
  return `  <div style="display:flex;align-items:flex-start;gap:10px;padding:0 ${PAD}px 18px">
    ${icon(glyph, 15, tone, 2)}
    <div style="flex:1;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${text}</div>
  </div>
`;
}

function deviceStorage() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: deviceStorageScreen(c, {
      used: '1.4 GB across 11 documents',
      free: '8.2 GB free on this device. Largest first.',
      rows: `${storageRow(c, {
        title: 'Designing Data-Intensive Applications',
        detail: 'In your account. Removing it here downloads again in a tap.',
        size: '12.4 MB',
        recoverable: true,
      })}
${storageRow(c, {
        title: 'Sapiens: A Brief History of Humankind',
        detail: 'In your account. Removing it here downloads again in a tap.',
        size: '6.8 MB',
        recoverable: true,
      })}
${storageRow(c, {
        title: 'Lease Agreement — 14 Kilimani Road',
        detail: 'On this phone only. Removing it deletes it for good.',
        size: '4.6 MB',
        recoverable: false,
      })}
${storageRow(c, {
        title: 'Thinking, Fast and Slow',
        detail: 'In your account. Removing it here downloads again in a tap.',
        size: '4.1 MB',
        recoverable: true,
      })}
${storageRow(c, {
        title: 'React Native Performance Notes',
        detail: 'On this phone only. Removing it deletes it for good.',
        size: '380 KB',
        recoverable: false,
      })}`,
    }),
  });
}

/**
 * The same screen with the two things a reader should be told about a device.
 *
 * Running out of room, and a build that cannot encrypt what it stores. Both are
 * facts about this phone rather than about the library, which is why they sit
 * here and not on Home — and both are lines rather than dialogs, because
 * neither is something to interrupt somebody's reading over.
 */
function deviceStorageTight() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: deviceStorageScreen(c, {
      used: '11.8 GB across 74 documents',
      free: '412 MB free on this device. Largest first.',
      notices:
        storageNotice(
          c,
          'alert',
          'There is not much room left. An import larger than about 350&nbsp;MB will be refused until you remove something.',
          c.destructive,
        ) +
        storageNotice(
          c,
          'lock',
          'This build cannot encrypt a library on disk, so Pidom is not keeping one. Your documents are still in your account, but nothing is being stored here until the app is rebuilt with encryption turned on.',
          c.destructive,
        ),
      rows: `${storageRow(c, {
        title: 'The Complete Works — scanned, 1,340 pages',
        detail: 'On this phone only. Removing it deletes it for good.',
        size: '1.9 GB',
        recoverable: false,
      })}
${storageRow(c, {
        title: 'Designing Data-Intensive Applications',
        detail: 'In your account. Removing it here downloads again in a tap.',
        size: '12.4 MB',
        recoverable: true,
      })}
${storageRow(c, {
        title: 'Sapiens: A Brief History of Humankind',
        detail: 'In your account. Removing it here downloads again in a tap.',
        size: '6.8 MB',
        recoverable: true,
      })}`,
    }),
  });
}

/* ============================ SHARING ============================= *
 * Sharing sits above the local-first library rather than replacing any
 * of it. A shared document is one row, still owned by whoever imported
 * it, plus a grant — so every screen below is about the grant, and the
 * document underneath is the same document the reader already has.
 * ------------------------------------------------------------------ */

/**
 * The people in these artboards.
 *
 * A handle rather than an email on every row, because that is what search
 * matches on: an exact `@handle` or an exact address, never a prefix over
 * everybody. `find` says whether that person can be found at all — the last
 * one has turned it off, which is why she appears in a group and never in a
 * search result.
 */
const PEOPLE = [
  { n: 'Amina Wanjiru', h: 'amina', i: 'AW', online: true, find: true },
  { n: 'Joseph Kimani', h: 'jkimani', i: 'JK', online: false, find: true },
  { n: 'Grace Otieno', h: 'grace_o', i: 'GO', online: true, find: true },
  { n: 'Daniel Mwangi', h: 'dmwangi', i: 'DM', online: false, find: true },
  { n: 'Faith Njeri', h: 'faithn', i: 'FN', online: false, find: false },
];
const byHandle = (h) => PEOPLE.find((p) => p.h === h);

const GROUPS = [
  { n: 'Reading group', m: 6, g: 'RG' },
  { n: 'Kilimani Housing Co-op', m: 23, g: 'KH' },
  { n: 'Distributed systems', m: 4, g: 'DS' },
];

/**
 * A person, drawn the way a cover is: the same hash, the same twelve hues.
 *
 * The account has a Google photo most of the time and this is the fallback —
 * but the fallback is what the artboards draw, because a screen designed
 * around photographs falls apart on the account that has none.
 */
function faceOf(c, p, size, dark = true) {
  const hue = hueOf(p.n);
  return `<div style="width:${size}px;height:${size}px;border-radius:9999px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:${coverBg(hue, dark)};color:${coverFg(hue, dark)};font-size:${Math.round(size * 0.36)}px;font-weight:600;letter-spacing:.01em">${p.i ?? p.g}</div>`;
}

/**
 * Online, and nothing more.
 *
 * Presence is ephemeral by design — a heartbeat and a timeout, not a
 * `lastSeen` column — so the only honest rendering is a dot that is either
 * there or not. No "active 4 minutes ago": the component does not know that,
 * and a number invented to fill the space would be a number somebody trusts.
 */
function dot(c, online) {
  return online
    ? `<div style="width:8px;height:8px;border-radius:9999px;background:${c.ok};flex:0 0 auto"></div>`
    : '';
}

/** A face with its presence dot notched into the corner. */
function facePresence(c, p, size, dark = true) {
  return `<div style="position:relative;flex:0 0 auto">
      ${faceOf(c, p, size, dark)}
      ${p.online ? `<div style="position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;border-radius:9999px;background:${c.ok};box-shadow:0 0 0 2px ${c.bg}"></div>` : ''}
    </div>`;
}

/** One person or group in a list. The trailing slot is the only thing that varies. */
function personRow(c, { face, name, sub, trailing = '', dim = false, pad = PAD }) {
  return `<div style="display:flex;align-items:center;gap:12px;padding:11px ${pad}px;${dim ? 'opacity:.55;' : ''}">
      ${face}
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;letter-spacing:-.008em;color:${c.fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div>
        ${sub ? `<div style="margin-top:2px;font-size:12px;color:${c.fgSubtle};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sub}</div>` : ''}
      </div>
      ${trailing}
    </div>`;
}

/**
 * The chip row.
 *
 * Same control as the navigator's, generalised: a chip rather than a sliding
 * segmented control, because these labels carry counts and a sliding indicator
 * over labels that change width is an indicator that never lands square.
 */
function segments(c, items) {
  return `<div style="display:flex;gap:6px;padding:0 ${PAD}px 12px;overflow:hidden">
      ${items
        .map(
          ({ label, on }) =>
            `<div style="padding:6px 12px;border-radius:${R};flex:0 0 auto;${on ? `background:${c.primaryTint}` : ''}">
               <span style="font-size:12px;white-space:nowrap;color:${on ? c.primary : c.fgMuted}">${label}</span>
             </div>`,
        )
        .join('')}
    </div>`;
}

/** The shell every sharing screen uses. Identical to the navigator's, minus its fixed tabs. */
function sharePage(c, { glyph, title, subtitle = '', trailing = '', segs = null, body }) {
  return `<div style="position:absolute;inset:0;background:${c.bg};display:flex;flex-direction:column">
    <div style="display:flex;align-items:center;padding:44px ${PAD}px 12px;flex:0 0 auto">
      ${icon('arrowLeft', 22, c.fg, 2)}
      <div style="margin-left:10px;flex:0 0 auto">${icon(glyph, 18, c.fgMuted)}</div>
      <div style="flex:1;min-width:0;margin-left:10px">
        <div style="font-size:15px;font-weight:600;letter-spacing:-.01em;color:${c.fg}">${title}</div>
        ${subtitle ? `<div style="margin-top:2px;font-size:12px;color:${c.fgSubtle};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${subtitle}</div>` : ''}
      </div>
      ${trailing}
    </div>
    ${segs ? segments(c, segs) : ''}
    <div style="height:1px;background:${c.hairline};flex:0 0 auto"></div>
    ${body}
  </div>`;
}

/**
 * The document being shared, at the top of the screen and not in a card.
 *
 * It is the header's subject rather than an object on the page — the reader
 * arrived here from that document and does not need to be sold it again.
 */
function pdfIdentity(c, doc, { note = null } = {}) {
  return `<div style="display:flex;align-items:center;gap:14px;padding:14px ${PAD}px">
      ${pageCover(doc, { w: 44 })}
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;letter-spacing:-.008em;color:${c.fg}" class="c2">${doc.t}</div>
        <div style="margin-top:3px;font-size:12px;color:${c.fgSubtle}" class="tnum">${note ?? `${doc.p ? `${doc.p} pages · ` : ''}${doc.size}`}</div>
      </div>
    </div>`;
}

/** The one filled control on a screen. Same 48px the import footer uses. */
function primaryButton(c, label, { tone = 'primary', glyph = null, spinner = false } = {}) {
  const bg = tone === 'quiet' ? c.hover : c.primary;
  const fg = tone === 'quiet' ? c.fgDisabled : c.onPrimary;
  return `<div style="height:48px;display:flex;align-items:center;justify-content:center;gap:9px;border-radius:${R};background:${bg}">
      ${spinner ? `<div style="width:17px;height:17px;border-radius:9999px;box-shadow:inset 0 0 0 2px rgba(255,255,255,.28);border-top:2px solid ${c.onPrimary}"></div>` : glyph ? icon(glyph, 17, fg, 2) : ''}
      <span style="font-size:15px;font-weight:500;color:${fg}">${label}</span>
    </div>`;
}

/** An outline control, for the second of two actions. */
function quietButton(c, label, { glyph = null, tone = null } = {}) {
  const fg = tone === 'danger' ? c.destructive : c.fg;
  return `<div style="height:48px;display:flex;align-items:center;justify-content:center;gap:9px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}">
      ${glyph ? icon(glyph, 17, fg, 2) : ''}
      <span style="font-size:15px;font-weight:500;color:${fg}">${label}</span>
    </div>`;
}

const switchToggle = (c, on, off = false) =>
  `<div style="width:44px;height:26px;border-radius:9999px;background:${on ? c.primary : c.border};position:relative;flex:0 0 auto;${off ? 'opacity:.45;' : ''}">
     <div style="position:absolute;${on ? 'right:3px' : 'left:3px'};top:3px;width:20px;height:20px;border-radius:9999px;background:${on ? c.onPrimary : c.fgSubtle}"></div>
   </div>`;

/** A settings group label. Typography and a rule do the work a card would. */
const settingsLabel = (c, text, top = 24) =>
  `<div style="padding:${top}px ${PAD}px 8px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">${text}</div>`;

function settingsSwitch(c, { label, note, on, off = false }) {
  return `<div style="display:flex;align-items:center;gap:14px;padding:11px ${PAD}px">
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;color:${off ? c.fgDisabled : c.fg}">${label}</div>
        ${note ? `<div style="margin-top:2px;font-size:12px;line-height:16px;color:${c.fgSubtle}" class="pretty">${note}</div>` : ''}
      </div>
      ${switchToggle(c, on, off)}
    </div>`;
}

function settingsPick(c, { label, note, value }) {
  return `<div style="display:flex;align-items:center;gap:12px;padding:11px ${PAD}px">
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;color:${c.fg}">${label}</div>
        ${note ? `<div style="margin-top:2px;font-size:12px;line-height:16px;color:${c.fgSubtle}" class="pretty">${note}</div>` : ''}
      </div>
      <span style="font-size:13px;color:${c.fgSubtle};flex:0 0 auto">${value}</span>
      ${icon('chevronRight', 15, c.fgSubtle, 2)}
    </div>`;
}

/** The line a screen uses to say something without demanding anything. */
function quietNotice(c, glyph, text, tone = null) {
  return `<div style="display:flex;align-items:flex-start;gap:10px;padding:12px ${PAD}px">
      <div style="margin-top:1px">${icon(glyph, 15, tone ?? c.fgSubtle, 2)}</div>
      <div style="flex:1;font-size:12px;line-height:17px;color:${tone ?? c.fgSubtle}" class="pretty">${text}</div>
    </div>`;
}

/* -------------------------- share compose ------------------------- */

/**
 * Sharing a document with people.
 *
 * One continuous surface: the document at the top as the header's subject, a
 * field, the people chosen so far in a horizontal rail, results underneath,
 * then what they will be allowed to do and an optional line to them.
 *
 * The search is a **lookup, not a search**. It matches an exact `@handle` or an
 * exact email address, plus display-name prefixes among people already in a
 * group with the reader — and nothing else, because a Convex query cannot spend
 * a rate-limiter token, so an index over every account in the deployment would
 * be an enumeration endpoint with no bound anybody could put on it.
 */
function shareCompose(variant) {
  const c = DARK;
  const doc = byTitle('Thinking,');
  const searching = variant === 'searching';
  const nomatch = variant === 'nomatch';
  const sending = variant === 'sending';
  const queued = variant === 'queued';
  const chosen = nomatch ? [] : sending || queued ? [byHandle('amina'), byHandle('grace_o')] : [byHandle('amina')];

  const field = (value, placeholder) =>
    `<div style="margin:14px ${PAD}px 0;height:44px;display:flex;align-items:center;gap:10px;padding:0 12px;border-radius:${R};box-shadow:inset 0 0 0 1px ${value ? c.primary : c.border}">
       ${icon('search', 18, c.fgSubtle)}
       <span style="font-size:14px;color:${value ? c.fg : c.fgSubtle}">${value ?? placeholder}</span>
     </div>`;

  const chip = (p) =>
    `<div style="width:60px;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:6px">
       <div style="position:relative">${faceOf(c, p, 44)}<div style="position:absolute;right:-2px;top:-2px;width:17px;height:17px;border-radius:9999px;background:${c.hover};box-shadow:0 0 0 2px ${c.bg};display:flex;align-items:center;justify-content:center">${icon('close', 10, c.fgMuted, 2.4)}</div></div>
       <span style="font-size:10px;line-height:13px;text-align:center;color:${c.fgSubtle};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60px">${p.n.split(' ')[0]}</span>
     </div>`;

  const result = (p, sub) =>
    personRow(c, { face: facePresence(c, p, 38), name: p.n, sub, trailing: icon('plus', 18, c.fgMuted, 2) });

  const groupResult = (g) =>
    personRow(c, {
      face: `<div style="width:38px;height:38px;border-radius:${R};flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:${c.hover};color:${c.fgMuted};font-size:13px;font-weight:600">${g.g}</div>`,
      name: g.n,
      sub: `${g.m} members`,
      trailing: icon('plus', 18, c.fgMuted, 2),
    });

  const results = nomatch
    ? `<div style="padding:34px ${PAD}px 0;text-align:center">
         ${icon('atSign', 26, c.fgSubtle, 1.6)}
         <div style="margin-top:14px;font-size:15px;font-weight:600;color:${c.fg}">No account called @kimw</div>
         <div style="margin-top:6px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">Handles and email addresses have to match exactly. Pidom does not list accounts you have no connection to, so there is nothing to browse here.</div>
       </div>`
    : searching
      ? `<div style="padding-top:2px">
           ${result(byHandle('jkimani'), '@jkimani · exact handle')}
           <div style="padding:14px ${PAD}px 6px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">In your groups</div>
           ${result(byHandle('grace_o'), 'Reading group')}
           ${result(byHandle('faithn'), 'Kilimani Housing Co-op')}
           <div style="padding:14px ${PAD}px 6px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">Groups</div>
           ${groupResult(GROUPS[0])}
         </div>`
      : `<div style="padding-top:2px">
           <div style="padding:8px ${PAD}px 6px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">Recent</div>
           ${result(byHandle('grace_o'), '@grace_o')}
           ${result(byHandle('dmwangi'), '@dmwangi')}
           <div style="padding:14px ${PAD}px 6px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">Groups</div>
           ${groupResult(GROUPS[0])}
           ${groupResult(GROUPS[2])}
         </div>`;

  const footer = queued
    ? `${quietNotice(c, 'wifiOff', 'No connection. This share is in the queue and goes out the moment there is one — the people you picked are not told anything until it does.')}
       <div style="padding:2px ${PAD}px 34px">${primaryButton(c, 'Waiting for connection', { tone: 'quiet', glyph: 'clock' })}</div>`
    : sending
      ? `<div style="padding:12px ${PAD}px 34px">${primaryButton(c, 'Sharing…', { spinner: true })}</div>`
      : `<div style="padding:12px ${PAD}px 34px">${primaryButton(c, chosen.length === 0 ? 'Share' : `Share with ${chosen.length}`, { tone: chosen.length === 0 ? 'quiet' : 'primary', glyph: chosen.length === 0 ? null : 'send' })}</div>`;

  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${sharePage(c, {
    glyph: 'share2',
    title: 'Share',
    subtitle: doc.t,
    body: `<div style="flex:1;display:flex;flex-direction:column;min-height:0">
      ${pdfIdentity(c, doc)}
      <div style="height:1px;background:${c.hairline};margin:0 ${PAD}px"></div>
      ${field(searching ? 'kim' : nomatch ? '@kimw' : null, 'Search people or groups')}
      ${chosen.length === 0 ? '' : `<div style="margin-top:14px;display:flex;gap:10px;padding:0 ${PAD}px;overflow:hidden">${chosen.map(chip).join('')}</div>`}
      <div style="flex:1;min-height:0;overflow:hidden">${results}</div>
      ${nomatch ? '' : `<div style="height:1px;background:${c.hairline}"></div>
      <div style="display:flex;align-items:center;gap:14px;padding:12px ${PAD}px">
        ${icon('eye', 19, c.fgMuted)}
        <div style="flex:1"><div style="font-size:15px;color:${c.fg}">They can read it</div>
        <div style="margin-top:2px;font-size:12px;color:${c.fgSubtle}">No downloading, no resharing</div></div>
        ${icon('chevronRight', 15, c.fgSubtle, 2)}
      </div>
      <div style="display:flex;align-items:center;gap:14px;padding:2px ${PAD}px 10px">
        ${icon('messageSquare', 19, c.fgMuted)}
        <span style="font-size:14px;color:${sending || queued ? c.fg : c.fgSubtle}">${sending || queued ? 'Chapter 4 is the one we argued about.' : 'Say something (optional)'}</span>
      </div>`}
      ${footer}
    </div>`,
  })}
</div>`,
  });
}

/**
 * What a recipient will be allowed to do.
 *
 * Three rows and one check mark, in a sheet, because it is a short fixed list.
 * Download sits below a rule and reads as the consequential one, which it is:
 * it is the only option here that puts the file itself on somebody else's
 * disk, where no later change of mind can reach it.
 */
function sharePermissionSheet() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  <div style="position:absolute;inset:0;background:${c.bg};opacity:.45"></div>
  <div style="position:absolute;inset:0;background:rgba(0,0,0,.55)"></div>
  ${readerSheet(c, {
    glyph: 'shieldCheck',
    title: 'What they can do',
    subtitle: doc.t,
    body: `<div style="padding-top:4px">
      ${readerRow(c, { glyph: 'eye', label: 'Can read', note: 'Open it and read it. Nothing is written back.', checked: true })}
      ${readerRow(c, { glyph: 'notebookPen', label: 'Can annotate', note: 'Keep passages and write notes on it. Theirs, and you see them.' })}
      <div style="height:1px;margin:6px ${PAD}px;background:${c.hairline}"></div>
      ${readerRow(c, { glyph: 'download', label: 'Can download a copy', note: 'Puts the file on their device. Removing access later does not take it back.' })}
      ${readerRow(c, { glyph: 'share2', label: 'Can share it on', note: 'Never more than they have themselves.' })}
      <div style="padding:14px ${PAD}px 4px">
        <div style="font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Both of the last two are off unless you turn them on, on every share.</div>
      </div>
    </div>`,
  })}
</div>`,
  });
}

/* ---------------------------- the inbox --------------------------- */

/**
 * What has been shared with this reader, and what they have shared out.
 *
 * Every row here is drawn from the device's own `shares` table, which carries
 * the title, the size and the page count — so the inbox is legible with no
 * connection and before a single byte of any of these documents has been
 * fetched. Nothing on this screen is a `file://` path.
 */
function sharedInbox(variant) {
  const c = DARK;
  const empty = variant === 'empty';

  const row = (p, doc, { detail, trailing = '', dim = false }) =>
    `<div style="display:flex;align-items:center;gap:12px;padding:12px ${PAD}px;${dim ? 'opacity:.6;' : ''}">
       ${pageCover(doc, { w: 38 })}
       <div style="flex:1;min-width:0">
         <div style="font-size:14px;letter-spacing:-.008em;color:${c.fg}" class="c2">${doc.t}</div>
         <div style="margin-top:3px;display:flex;align-items:center;gap:6px">
           ${faceOf(c, p, 15)}
           <span style="font-size:12px;color:${c.fgSubtle};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${detail}</span>
         </div>
       </div>
       ${trailing}
     </div>`;

  const pill = (label, tone) =>
    `<span style="flex:0 0 auto;padding:3px 8px;border-radius:${R};font-size:11px;background:${tone === 'primary' ? c.primaryTint : c.hover};color:${tone === 'primary' ? c.primary : c.fgSubtle}">${label}</span>`;

  const bodies = {
    inbox: `<div style="padding-top:2px">
      ${row(byHandle('amina'), byTitle('Designing Data'), { detail: 'Amina Wanjiru · can read', trailing: icon('cloudDown', 17, c.primary, 2) })}
      ${row(byHandle('grace_o'), byTitle('The Pragmatic'), { detail: 'Grace Otieno · can annotate', trailing: icon('check', 17, c.fgSubtle, 2) })}
      ${row(byHandle('jkimani'), byTitle('Kubernetes'), { detail: 'Reading group · can read', trailing: icon('cloudDown', 17, c.primary, 2) })}
      ${row(byHandle('dmwangi'), byTitle('Domain-Driven'), { detail: 'Daniel Mwangi · access removed', dim: true, trailing: icon('ban', 15, c.fgSubtle, 2) })}
    </div>`,
    pending: `<div style="padding-top:2px">
      ${row(byHandle('amina'), byTitle('Structure and'), { detail: 'Amina Wanjiru · 2 hours ago', trailing: pill('Decide', 'primary') })}
      ${row(byHandle('dmwangi'), byTitle('Annual Report'), { detail: 'Daniel Mwangi · yesterday', trailing: pill('Decide', 'primary') })}
      ${quietNotice(c, 'lock', 'Nothing is downloaded until you accept. Until then all Pidom has told you is the title and who sent it. Documents shared with a group are not here — being in the group is the agreement, so they are already under Shared with you.')}
    </div>`,
    sent: `<div style="padding-top:2px">
      ${row(byHandle('grace_o'), byTitle('Thinking,'), { detail: 'Grace Otieno, Amina Wanjiru · can read', trailing: pill('2 people', null) })}
      ${row(byHandle('jkimani'), byTitle('The Design of'), { detail: 'Reading group · can annotate', trailing: pill('6 people', null) })}
      ${row(byHandle('dmwangi'), byTitle('React Native'), { detail: 'Daniel Mwangi · waiting to send', dim: true, trailing: icon('clock', 15, c.fgSubtle, 2) })}
    </div>`,
    empty: `<div style="padding:74px ${PAD}px 0;text-align:center">
      ${icon('inbox', 30, c.fgSubtle, 1.6)}
      <div style="margin-top:16px;font-size:16px;font-weight:600;letter-spacing:-.01em;color:${c.fg}">Nothing shared with you</div>
      <div style="margin-top:7px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">When somebody shares a PDF with you it lands here, with their name on it, before anything is downloaded.</div>
    </div>`,
  };

  const counts = {
    inbox: [
      { label: 'Shared with you', on: true },
      { label: 'Pending · 2', on: false },
      { label: 'Sent', on: false },
    ],
    pending: [
      { label: 'Shared with you', on: false },
      { label: 'Pending · 2', on: true },
      { label: 'Sent', on: false },
    ],
    sent: [
      { label: 'Shared with you', on: false },
      { label: 'Pending · 2', on: false },
      { label: 'Sent', on: true },
    ],
    empty: [
      { label: 'Shared with you', on: true },
      { label: 'Pending', on: false },
      { label: 'Sent', on: false },
    ],
  };

  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${sharePage(c, {
    glyph: 'inbox',
    title: 'Shared',
    subtitle: empty ? 'Nothing yet' : '4 documents · 2 waiting',
    trailing: empty ? '' : `<span style="font-size:12px;color:${c.fgSubtle}" class="tnum">${{ inbox: 4, pending: 2, sent: 3 }[variant]}</span>`,
    segs: counts[variant],
    body: `<div style="flex:1;min-height:0;overflow:hidden">${bodies[variant]}</div>`,
  })}
</div>`,
  });
}

/* --------------------------- one share ---------------------------- */

/**
 * One document somebody shared, from the recipient's side.
 *
 * It says what is allowed **before** anything is tapped. A recipient who finds
 * out there is no download button by looking for it has been told the rule by
 * its absence, which is the worst way to be told anything.
 */
function shareDetail(variant) {
  const c = DARK;
  const doc = byTitle('Designing Data');
  const from = byHandle('amina');
  const accepted = variant === 'accepted';
  const revoked = variant === 'revoked';
  const expired = variant === 'expired';

  const allowRow = (glyph, label, on) =>
    `<div style="display:flex;align-items:center;gap:14px;padding:10px ${PAD}px">
       ${icon(glyph, 18, on ? c.fgMuted : c.fgDisabled)}
       <span style="flex:1;font-size:14px;color:${on ? c.fg : c.fgDisabled}">${label}</span>
       ${on ? icon('check', 16, c.ok, 2.2) : icon('close', 15, c.fgDisabled, 2.2)}
     </div>`;

  const footer = revoked
    ? `<div style="padding:0 ${PAD}px 34px">${quietButton(c, 'Open the copy on this device', { glyph: 'bookOpen' })}</div>`
    : expired
      ? `<div style="padding:0 ${PAD}px 34px">${primaryButton(c, 'Ask Amina again', { tone: 'quiet', glyph: 'send' })}</div>`
      : accepted
        ? `<div style="padding:0 ${PAD}px 34px;display:flex;flex-direction:column;gap:10px">
             ${primaryButton(c, 'Download for offline', { glyph: 'download' })}
             ${quietButton(c, 'Open without downloading', { glyph: 'bookOpen' })}
           </div>`
        : `<div style="padding:0 ${PAD}px 34px;display:flex;flex-direction:column;gap:10px">
             ${primaryButton(c, 'Accept', { glyph: 'check' })}
             ${quietButton(c, 'Decline')}
           </div>`;

  const state = revoked
    ? quietNotice(
        c,
        'ban',
        'Amina removed your access on 4 September. You can still open the copy already on this phone — a file that has been downloaded cannot be recalled, and saying otherwise would be the lie this screen exists to avoid. It will not sync again and it will not come back if you delete it.',
      )
    : expired
      ? quietNotice(c, 'clock', 'This share ran out on 1 September. The document is untouched; only the permission expired.')
      : accepted
        ? quietNotice(c, 'cloudDown', '12.4 MB. Once it is here it opens with no connection, like everything else in your library.')
        : `<div style="display:flex;align-items:flex-start;gap:12px;padding:12px ${PAD}px">
             ${icon('quote', 16, c.fgMuted)}
             <div style="flex:1;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">Chapter 4 is the one we argued about. No rush.</div>
           </div>`;

  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${sharePage(c, {
    glyph: 'share2',
    title: revoked ? 'Access removed' : expired ? 'Share expired' : 'Shared with you',
    subtitle: `From ${from.n}`,
    body: `<div style="flex:1;display:flex;flex-direction:column;min-height:0">
      <div style="display:flex;justify-content:center;padding:22px 0 16px">${pageCover(doc, { w: 116 })}</div>
      <div style="padding:0 ${PAD}px;text-align:center">
        <div style="font-size:17px;font-weight:600;letter-spacing:-.014em;color:${revoked || expired ? c.fgMuted : c.fg}" class="c2 pretty">${doc.t}</div>
        <div style="margin-top:5px;font-size:12px;color:${c.fgSubtle}" class="tnum">${doc.p} pages · ${doc.size}</div>
      </div>

      <div style="height:1px;background:${c.hairline};margin:18px ${PAD}px 0"></div>
      ${personRow(c, {
        face: facePresence(c, from, 36),
        name: from.n,
        sub: revoked || expired ? `@${from.h}` : `@${from.h} · ${from.online ? 'online' : 'offline'}`,
        trailing: `<span style="font-size:12px;color:${c.fgSubtle}">Profile</span>`,
      })}
      <div style="height:1px;background:${c.hairline};margin:0 ${PAD}px"></div>

      <div style="padding-top:6px">
        ${allowRow('eye', 'Read it', !revoked && !expired)}
        ${allowRow('notebookPen', 'Keep passages and notes', false)}
        ${allowRow('download', 'Download a copy', accepted)}
      </div>

      ${state}
      <div style="flex:1"></div>
      ${footer}
    </div>`,
  })}
</div>`,
  });
}

/* -------------------------- manage access ------------------------- */

/**
 * Who can open this document, from the owner's side.
 *
 * Presence is here and nowhere near the page: a dot beside a name in a list
 * somebody deliberately opened, rather than a live header over a document
 * being read. The reader came here to answer a question about access; the
 * dot answers a second one they did not have to ask.
 */
function manageAccess(variant) {
  const c = DARK;
  const doc = byTitle('Thinking,');
  const menu = variant === 'menu';
  const removing = variant === 'remove';

  const roleTag = (label) =>
    `<span style="flex:0 0 auto;padding:3px 8px;border-radius:${R};font-size:11px;background:${c.hover};color:${c.fgMuted}">${label}</span>`;

  const accessRow = (p, role, { pendingLabel = null } = {}) =>
    personRow(c, {
      face: facePresence(c, p, 38),
      name: p.n,
      sub: pendingLabel ?? `@${p.h}${p.online ? ' · viewing now' : ''}`,
      trailing: `<div style="display:flex;align-items:center;gap:10px;flex:0 0 auto">${roleTag(role)}${icon('more', 17, c.fgSubtle)}</div>`,
    });

  const body = `<div style="flex:1;min-height:0;overflow:hidden">
      ${pdfIdentity(c, doc, { note: 'Shared with 4 people and 1 group' })}
      <div style="height:1px;background:${c.hairline};margin:0 ${PAD}px"></div>
      <div style="padding-top:4px">
        ${personRow(c, {
          face: facePresence(c, { n: 'Emmanuel Gichuhi', h: 'you', i: 'EG', online: true }, 38),
          name: 'You',
          sub: 'Owner · imported 12 August',
          trailing: roleTag('Owner'),
        })}
        ${accessRow(byHandle('amina'), 'Read')}
        ${accessRow(byHandle('grace_o'), 'Annotate')}
        ${accessRow(byHandle('jkimani'), 'Read', { pendingLabel: `@jkimani · invited, not answered` })}
        <div style="padding:14px ${PAD}px 6px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">Groups</div>
        ${personRow(c, {
          face: `<div style="width:38px;height:38px;border-radius:${R};flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:${c.hover};color:${c.fgMuted};font-size:13px;font-weight:600">RG</div>`,
          name: 'Reading group',
          sub: '6 members · 2 reading now',
          trailing: `<div style="display:flex;align-items:center;gap:10px;flex:0 0 auto">${roleTag('Read')}${icon('more', 17, c.fgSubtle)}</div>`,
        })}
      </div>
      ${quietNotice(c, 'info', 'Nobody here can download this. Turning that on for one person puts the file on their device permanently.')}
    </div>`;

  const overlay = menu
    ? `<div style="position:absolute;inset:0;background:rgba(0,0,0,.4)"></div>
       <div style="position:absolute;right:${PAD}px;top:284px;width:224px;border-radius:${R};background:${c.elevated};box-shadow:0 0 0 1px ${c.border}, 0 12px 32px rgba(0,0,0,.5);padding:4px 0">
         ${[
           ['shieldCheck', 'Change what they can do', false],
           ['user', 'View profile', false],
           ['ban', 'Remove access', true],
         ]
           .map(
             ([g, label, danger]) =>
               `<div style="height:42px;display:flex;align-items:center;gap:10px;padding:0 13px">${icon(g, 16, danger ? c.destructive : c.fgMuted)}<span style="font-size:14px;color:${danger ? c.destructive : c.fg}">${label}</span></div>`,
           )
           .join('')}
       </div>`
    : removing
      ? `<div style="position:absolute;inset:0;background:rgba(0,0,0,.55)"></div>
         <div style="position:absolute;left:26px;right:26px;top:266px;border-radius:${R};background:${c.elevated};box-shadow:0 0 0 1px ${c.border};padding:20px">
           <div style="font-size:17px;font-weight:700;letter-spacing:-.014em;color:${c.fg}">Remove Grace's access?</div>
           <div style="margin-top:10px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">She will not be able to open this document again, and her notes on it stop syncing to you.</div>
           <div style="margin-top:12px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">She downloaded a copy on 28 August. That copy is on her phone and this does not delete it — no setting here can.</div>
           <div style="margin-top:20px;display:flex;justify-content:flex-end;gap:10px">
             <div style="height:36px;display:flex;align-items:center;padding:0 14px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}"><span style="font-size:14px;color:${c.fg}">Cancel</span></div>
             <div style="height:36px;display:flex;align-items:center;padding:0 14px;border-radius:${R};background:${c.destructive}"><span style="font-size:14px;font-weight:500;color:#ffffff">Remove access</span></div>
           </div>
         </div>`
      : '';

  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${sharePage(c, {
    glyph: 'users',
    title: 'Who can open this',
    subtitle: doc.t,
    trailing: icon('userPlus', 19, c.fgMuted),
    body,
  })}
  ${overlay}
</div>`,
  });
}

/**
 * A person, as much of them as sharing has any business showing.
 *
 * A name, a handle, a picture and what the two of you already have in common.
 * No email, no last-seen, no library — a search result is not a licence to
 * read somebody's account, and the projection the server returns is exactly
 * these four fields whatever the search matched on.
 */
function profilePreview() {
  const c = DARK;
  const p = byHandle('grace_o');
  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  <div style="position:absolute;inset:0;background:rgba(0,0,0,.55)"></div>
  ${readerSheet(c, {
    glyph: 'user',
    title: p.n,
    subtitle: `@${p.h}`,
    body: `<div style="padding:20px ${PAD}px 4px;display:flex;align-items:center;gap:16px">
      ${facePresence(c, p, 64)}
      <div style="flex:1;min-width:0">
        <div style="font-size:17px;font-weight:600;letter-spacing:-.014em;color:${c.fg}">${p.n}</div>
        <div style="margin-top:3px;font-size:13px;color:${c.fgSubtle}">@${p.h}</div>
        <div style="margin-top:7px;display:flex;align-items:center;gap:6px">${dot(c, true)}<span style="font-size:12px;color:${c.ok}">Online</span></div>
      </div>
    </div>
    <div style="height:1px;margin:16px ${PAD}px 0;background:${c.hairline}"></div>
    <div style="padding-top:4px">
      ${readerRow(c, { glyph: 'users', label: 'In 2 groups with you', detail: 'Reading group, Distributed systems' })}
      ${readerRow(c, { glyph: 'share2', label: 'Shared 3 documents with you' })}
    </div>
    <div style="padding:12px ${PAD}px 4px">
      <div style="font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">This is everything Pidom will tell you about another account. Not their email, not what else they are reading.</div>
    </div>`,
  })}
</div>`,
  });
}

/* ----------------------------- groups ----------------------------- */

/**
 * Groups exist to stop the owner editing two hundred rows by hand.
 *
 * A person joining or leaving changes what they can open, because access is
 * resolved through membership at the moment it is asked for rather than copied
 * into a share row when the group was shared with.
 */
function groupsScreen() {
  const c = DARK;
  const row = (g, sub) =>
    personRow(c, {
      face: `<div style="width:40px;height:40px;border-radius:${R};flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:${c.hover};color:${c.fgMuted};font-size:14px;font-weight:600">${g.g}</div>`,
      name: g.n,
      sub,
      trailing: icon('chevronRight', 15, c.fgSubtle, 2),
    });

  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${sharePage(c, {
    glyph: 'users',
    title: 'Groups',
    subtitle: '3 groups · 33 people',
    trailing: icon('plus', 20, c.fgMuted, 2),
    body: `<div style="flex:1;min-height:0;overflow:hidden;padding-top:4px">
      ${row(GROUPS[0], '6 members · you are an admin · 4 documents')}
      ${row(GROUPS[1], '23 members · 1 document')}
      ${row(GROUPS[2], '4 members · you are an admin · 2 documents')}
      ${quietNotice(c, 'info', 'A group is a way to give the same people access to a document without adding them one at a time. Leaving one takes that access away.')}
    </div>`,
  })}
</div>`,
  });
}

function groupScreen(segment) {
  const c = DARK;
  const g = GROUPS[0];
  const roleTag = (label) =>
    `<span style="flex:0 0 auto;padding:3px 8px;border-radius:${R};font-size:11px;background:${c.hover};color:${c.fgMuted}">${label}</span>`;

  const members = `<div style="padding-top:4px">
      ${personRow(c, {
        face: facePresence(c, { n: 'Emmanuel Gichuhi', h: 'you', i: 'EG', online: true }, 38),
        name: 'You',
        sub: 'Admin · created this group',
        trailing: roleTag('Admin'),
      })}
      ${[byHandle('amina'), byHandle('grace_o'), byHandle('jkimani'), byHandle('faithn')]
        .map((p) =>
          personRow(c, {
            face: facePresence(c, p, 38),
            name: p.n,
            sub: `@${p.h}${p.online ? ' · online' : ''}`,
            trailing: `<div style="display:flex;align-items:center;gap:10px;flex:0 0 auto">${roleTag(p.h === 'amina' ? 'Admin' : 'Member')}${icon('more', 17, c.fgSubtle)}</div>`,
          }),
        )
        .join('')}
      ${personRow(c, {
        face: `<div style="width:38px;height:38px;border-radius:9999px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px ${c.border}">${icon('userPlus', 17, c.fgMuted)}</div>`,
        name: 'Add someone',
        sub: 'By handle or email',
      })}
    </div>`;

  const documents = `<div style="padding-top:4px">
      ${[
        [byTitle('Thinking,'), 'You · can read'],
        [byTitle('The Design of'), 'You · can annotate'],
        [byTitle('Kubernetes'), 'Joseph Kimani · can read'],
        [byTitle('Convex Backend'), 'Amina Wanjiru · can read'],
      ]
        .map(
          ([d, sub]) =>
            `<div style="display:flex;align-items:center;gap:12px;padding:12px ${PAD}px">
               ${pageCover(d, { w: 38 })}
               <div style="flex:1;min-width:0">
                 <div style="font-size:14px;color:${c.fg}" class="c2">${d.t}</div>
                 <div style="margin-top:3px;font-size:12px;color:${c.fgSubtle}">${sub}</div>
               </div>
               ${icon('chevronRight', 15, c.fgSubtle, 2)}
             </div>`,
        )
        .join('')}
      ${quietNotice(c, 'users', 'Everybody in this group can open all four. Removing somebody from the group removes all four at once.')}
    </div>`;

  const settings = `<div style="padding-top:2px">
      ${settingsLabel(c, 'This group', 14)}
      ${settingsPick(c, { label: 'Name', value: g.n })}
      ${settingsPick(c, { label: 'Who can add members', note: 'Members can always leave.', value: 'Admins' })}
      ${settingsSwitch(c, { label: 'Members can share documents in', note: 'Anything they share is theirs, not yours, and they can take it back.', on: true })}
      ${settingsSwitch(c, { label: 'Show who is online', note: 'Applies to this group only. Your own setting still wins.', on: true })}
      <div style="height:1px;background:${c.hairline};margin:14px ${PAD}px"></div>
      <div style="display:flex;align-items:center;gap:14px;padding:11px ${PAD}px">
        ${icon('logOut', 19, c.destructive)}
        <div style="flex:1"><div style="font-size:15px;color:${c.destructive}">Leave this group</div>
        <div style="margin-top:2px;font-size:12px;color:${c.fgSubtle}">You lose access to the four documents shared here.</div></div>
      </div>
    </div>`;

  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${sharePage(c, {
    glyph: 'users',
    title: g.n,
    subtitle: `${g.m} members · 4 documents`,
    trailing: `<span style="font-size:12px;color:${c.ok}">2 online</span>`,
    segs: [
      { label: 'Members · 6', on: segment === 'members' },
      { label: 'Shared PDFs · 4', on: segment === 'documents' },
      { label: 'Settings', on: segment === 'settings' },
    ],
    body: `<div style="flex:1;min-height:0;overflow:hidden">${segment === 'members' ? members : segment === 'documents' ? documents : settings}</div>`,
  })}
</div>`,
  });
}

/* ---------------------------- settings ---------------------------- */

/**
 * Sharing and privacy.
 *
 * Defaults are conservative in one direction only: the two that put a file on
 * somebody else's device permanently — downloading and resharing — are off, and
 * have to be turned on per share. Being findable is on, because a share system
 * nobody can be found in is a share system that does not work; what makes that
 * safe is that finding is an exact match rather than a list.
 */
function sharingPrivacy() {
  const c = DARK;
  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${sharePage(c, {
    glyph: 'shieldCheck',
    title: 'Sharing & privacy',
    subtitle: 'Who can reach you, and what they get',
    body: `<div style="flex:1;min-height:0;overflow:hidden">
      ${settingsLabel(c, 'Being found', 14)}
      ${settingsPick(c, { label: 'Who can find me', note: 'By an exact @handle or email address. Pidom never lists accounts.', value: 'Anyone' })}
      ${settingsPick(c, { label: 'Who can share with me', value: 'Anyone' })}
      ${settingsSwitch(c, { label: 'Show when I am online', note: 'A dot beside your name to people who already share a document or a group with you.', on: true })}
      ${settingsSwitch(c, { label: 'Show which page I am on', note: 'Off. Nobody sees where you are in a document.', on: false })}

      ${settingsLabel(c, 'What I share out')}
      ${settingsPick(c, { label: 'Default permission', note: 'What a new share starts as, before you change it.', value: 'Can read' })}
      ${settingsSwitch(c, { label: 'Let people download by default', note: 'Off. A downloaded copy cannot be taken back later.', on: false })}
      ${settingsSwitch(c, { label: 'Let people share mine on', note: 'Off. When on, they can never grant more than they have.', on: false })}

      ${settingsLabel(c, 'Groups')}
      ${settingsSwitch(c, { label: 'Allow group invitations', on: true })}
      ${quietNotice(c, 'users', 'A document shared with a group is open to its members straight away — being in the group is the agreement. Leaving one takes those documents with it.')}
    </div>`,
  })}
</div>`,
  });
}

/**
 * Notifications, per kind.
 *
 * Presence is deliberately absent from this list. It is a heartbeat that times
 * out, it changes every few seconds, and a notification for it would be a
 * notification for nothing.
 */
function notificationSettings() {
  const c = DARK;
  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${sharePage(c, {
    glyph: 'bell',
    title: 'Notifications',
    subtitle: 'On this device',
    body: `<div style="flex:1;min-height:0;overflow:hidden">
      <div style="padding-top:6px">${settingsSwitch(c, { label: 'Allow notifications', note: 'Everything below is off while this is.', on: true })}</div>
      <div style="height:1px;background:${c.hairline};margin:6px ${PAD}px"></div>

      ${settingsLabel(c, 'Tell me about', 12)}
      ${settingsSwitch(c, { label: 'Documents shared with me', on: true })}
      ${settingsSwitch(c, { label: 'Answers to what I shared', note: 'Accepted, declined.', on: true })}
      ${settingsSwitch(c, { label: 'Group activity', note: 'Added to a group, a document shared into one.', on: true })}
      ${settingsSwitch(c, { label: 'Notes on documents I own', note: 'Somebody with annotate access wrote something.', on: false })}

      ${settingsLabel(c, 'Quiet hours')}
      ${settingsSwitch(c, { label: 'Hold notifications overnight', note: 'They arrive in the morning. Nothing is dropped.', on: true })}
      ${settingsPick(c, { label: 'From', value: '22:00' })}
      ${settingsPick(c, { label: 'Until', value: '07:00' })}

      ${quietNotice(c, 'lock', 'A notification says a PDF was shared with you and who by. Never the title — it renders on a locked screen, and the rest is behind a query that checks you are allowed to read it.')}
    </div>`,
  })}
</div>`,
  });
}

/**
 * Asking for the permission, at the point it buys the reader something.
 *
 * Not on first launch. This is drawn after a first share has been sent, when
 * the answer being waited for is the reason to allow it — a prompt with a
 * concrete thing attached is a prompt somebody can decide about.
 */
function notificationPermission() {
  const c = DARK;
  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  <div style="position:absolute;inset:0;background:${c.bg}"></div>
  <div style="position:absolute;left:0;right:0;bottom:0;background:${c.elevated};border-radius:${R} ${R} 0 0;box-shadow:0 -1px 0 ${c.border};padding:0 0 34px">
    <div style="display:flex;justify-content:center;padding:8px 0 4px"><div style="width:36px;height:4px;border-radius:${R};background:${c.borderStrong}"></div></div>
    <div style="padding:18px ${PAD}px 0;text-align:center">
      ${icon('bell', 28, c.primary, 1.6)}
      <div style="margin-top:14px;font-size:19px;font-weight:700;letter-spacing:-.016em;color:${c.fg}">Know when Amina answers</div>
      <div style="margin-top:9px;font-size:14px;line-height:20px;color:${c.fgMuted}" class="pretty">You shared a document a moment ago. A notification is how you find out it was accepted without opening the app to check.</div>
    </div>
    <div style="margin-top:20px;height:1px;background:${c.hairline}"></div>
    <div style="padding-top:4px">
      ${readerRow(c, { glyph: 'inbox', label: 'Shares, and answers to yours', note: 'The title stays out of it. Just who, and that there is something.' })}
      ${readerRow(c, { glyph: 'bellOff', label: 'Nothing else', note: 'No reading reminders, no presence, no marketing.' })}
    </div>
    <div style="padding:16px ${PAD}px 0;display:flex;flex-direction:column;gap:10px">
      ${primaryButton(c, 'Allow notifications')}
      ${quietButton(c, 'Not now')}
    </div>
  </div>
</div>`,
  });
}

/* ------------------- sharing inside the app ----------------------- */

/**
 * The reader, with a share control and the people reading alongside.
 *
 * The presence row sits under the title rather than in the run of buttons: the
 * top bar carries five controls already, and a sixth would be the one that
 * finally makes the title an ellipsis. The faces are three at most, then a
 * count — a row that grows without limit is a row that pushes the title off.
 */
function readerShare() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  const watchers = [byHandle('amina'), byHandle('grace_o')];

  return dc({
    w: 390,
    h: 844,
    bg: PAPER.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${PAPER.bg}">
  ${readerPage({ top: 108 })}
  <div style="position:absolute;left:0;right:0;top:0;background:${c.bg};box-shadow:0 1px 0 ${c.hairline}">
    <div style="display:flex;align-items:center;gap:6px;padding:44px 16px 4px">
      ${icon('arrowLeft', 22, c.fg, 2)}
      <div style="flex:1;min-width:0;padding:0 4px">
        <div style="font-size:14px;font-weight:600;letter-spacing:-.01em;color:${c.fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${doc.t}</div>
      </div>
      ${icon('listTree', 21, c.fg, 2)}
      ${icon('textSearch', 21, c.fg, 2)}
      ${icon('bookmark', 21, c.fg, 2)}
      ${icon('share2', 21, c.primary, 2)}
      ${icon('more', 21, c.fg, 2)}
    </div>
    <div style="display:flex;align-items:center;gap:8px;padding:2px 20px 12px">
      <div style="display:flex">
        ${watchers.map((p, i) => `<div style="margin-left:${i === 0 ? 0 : -8}px;border-radius:9999px;box-shadow:0 0 0 2px ${c.bg}">${faceOf(c, p, 22)}</div>`).join('')}
      </div>
      <span style="font-size:12px;color:${c.fgSubtle}">Amina and Grace are reading this</span>
    </div>
  </div>
  ${folio(216)}
</div>`,
  });
}

/**
 * Home, with what other people sent.
 *
 * A rail like every other rail, read from the device's own database. It is
 * above Continue reading because an unanswered share is the one thing on this
 * screen with somebody waiting at the other end of it.
 */
function homeSharedRail() {
  const c = DARK;
  const t = (title, opts) => tile(byTitle(title), { dark: true, ...opts });

  const sharedTile = (title, who, state) => {
    const doc = byTitle(title);
    return `<div style="width:${COVER_W}px;flex:0 0 auto">
        ${state === 'pending' ? `<div style="opacity:.55">${pageCover(doc, { w: COVER_W })}</div>` : pageCover(doc, { w: COVER_W })}
        <div style="margin-top:8px;font-size:12px;line-height:16px;letter-spacing:-.006em;color:${c.fg}" class="c2">${doc.t}</div>
        <div style="margin-top:4px;display:flex;align-items:center;gap:5px;font-size:10px;line-height:13px;color:${state === 'pending' ? c.primary : c.fgSubtle}">
          ${state === 'pending' ? icon('inbox', 11, c.primary, 2) : icon('cloudDown', 11, c.fgSubtle, 2)}${who}
        </div>
      </div>`;
  };

  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="height:844px;overflow:hidden;background:${c.bg}">
  ${header(c)}
  ${searchTrigger(c)}
  <section style="margin-top:28px">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:0 ${PAD}px">
      <div style="font-size:16px;line-height:20px;font-weight:700;letter-spacing:-.014em;color:${c.fg}">Shared with you</div>
      <span style="font-size:12px;color:${c.primary}">2 waiting</span>
    </div>
    <div style="margin-top:12px;display:flex;gap:${GAP}px;padding:0 ${PAD}px;overflow:hidden">
      ${sharedTile('Structure and', 'Amina · decide', 'pending')}
      ${sharedTile('Annual Report', 'Kilimani · decide', 'pending')}
      ${sharedTile('Designing Data', 'Amina · download', 'accepted')}
      ${sharedTile('The Pragmatic', 'Grace · on device', 'accepted')}
    </div>
  </section>
  ${rail('Continue reading', [t('Thinking,', { showProgress: true, real: true }), t('The Design of', { showProgress: true, real: true }), t('Convex Backend', { showProgress: true })], c)}
  ${rail('Recently added', [t('Sapiens'), t('React Native'), t('Lease Agreement')], c)}
</div>`,
  });
}

/**
 * What a share actually is, and what removing one can and cannot do.
 *
 * Drawn because the honest answer is counter-intuitive and the UI has to keep
 * saying it: access is resolved every time it is asked for, so revoking is
 * immediate for everything the server mediates — and reaches nothing that is
 * already on somebody's disk.
 */
function shareModel() {
  const c = DARK;
  const box = (title, lines, { tone = null, w = 236 } = {}) =>
    `<div style="width:${w}px;border-radius:${R};padding:14px 16px;box-shadow:inset 0 0 0 1px ${tone === 'danger' ? c.destructive : tone === 'ok' ? c.ok : c.border}">
       <div style="font-size:13px;font-weight:600;letter-spacing:-.008em;color:${tone === 'danger' ? c.destructive : tone === 'ok' ? c.ok : c.fg}">${title}</div>
       ${lines.map((l) => `<div style="margin-top:7px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${l}</div>`).join('')}
     </div>`;
  const arrow = () => `<div style="display:flex;align-items:center;justify-content:center;width:44px">${icon('arrowRight', 17, c.fgMuted, 2)}</div>`;
  const label = (t) => `<div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle};margin-bottom:12px">${t}</div>`;

  return dc({
    w: 900,
    h: 720,
    bg: c.bg,
    body: `<div style="padding:36px 40px">
  <div style="font-size:22px;font-weight:700;letter-spacing:-.02em;color:${c.fg}">Identity, membership, access</div>
  <div style="margin-top:8px;max-width:640px;font-size:13px;line-height:20px;color:${c.fgMuted}" class="pretty">Three separate things. Collapsing them into one "shared PDF" row is what makes a person leaving a group into a hundred rows somebody has to remember to delete.</div>

  <div style="margin-top:30px">${label('How a recipient is allowed in')}
    <div style="display:flex;align-items:stretch">
      ${box('The document', ['One row, one owner, one object in R2. Sharing never copies it and never changes who owns it.'])}
      ${arrow()}
      ${box('A grant', ['<b style="color:' + c.fg + '">documentShares</b> — who, what role, can they download, can they share it on, and when it stops.'])}
      ${arrow()}
      ${box('Resolved on every read', ['Owner first, then a direct grant, then a group the caller is in. Nothing is cached into a session.'])}
    </div>
  </div>

  <div style="margin-top:34px">${label('What removing access reaches')}
    <div style="display:flex;align-items:stretch;gap:18px">
      ${box('Immediately', ['Opening it again.', 'Downloading it again.', 'Their notes syncing to you.', 'Joining the presence room.'], { tone: 'ok', w: 250 })}
      ${box('Never', ['A copy already downloaded to their phone. It is a file on a disk you do not own, and no server can reach it.', 'This is why downloading is off by default and asked for per share.'], { tone: 'danger', w: 250 })}
      ${box('Unchanged', ['Your own document, your own file, your own notes. Removing access is a change to a grant and nothing else.'], { w: 250 })}
    </div>
  </div>

  <div style="margin-top:34px;padding-top:20px;border-top:1px solid ${c.hairline};display:flex;gap:36px">
    <div style="flex:1">
      <div style="font-size:13px;font-weight:600;color:${c.fg}">The file still moves the same way</div>
      <div style="margin-top:7px;font-size:12px;line-height:18px;color:${c.fgSubtle}" class="pretty">A recipient downloads through a signed R2 URL that lives for five minutes and is minted only after the grant is checked — the same mutation the owner's own devices use, with a different check in front of it. There is no permanent link, and no URL that outlives the permission it was issued under.</div>
    </div>
    <div style="flex:1">
      <div style="font-size:13px;font-weight:600;color:${c.fg}">And it still reads offline</div>
      <div style="margin-top:7px;font-size:12px;line-height:18px;color:${c.fgSubtle}" class="pretty">Once accepted and downloaded, a shared document is a row in this phone's database and a file beside it, like every other document. Opening it touches no network. That is the whole point of putting sharing above the local-first library rather than beside it.</div>
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
  'OfflineIdentity.dc.html': offlineIdentity(),
  'SyncActivity.dc.html': syncActivity(),
  'SyncActivityFailed.dc.html': syncActivityFailed(),
  'AccountSync.dc.html': accountSync(),
  'ImportOffline.dc.html': importOffline(),
  'ImportNoSpace.dc.html': importNoSpace(),
  'LocalFirst.dc.html': localFirst(),
  'SyncPipeline.dc.html': syncPipeline(),
  'DeviceStorage.dc.html': deviceStorage(),
  'DeviceStorageTight.dc.html': deviceStorageTight(),

  /* Sharing. */
  'Share.dc.html': shareCompose('idle'),
  'ShareSearching.dc.html': shareCompose('searching'),
  'ShareNoMatch.dc.html': shareCompose('nomatch'),
  'ShareSending.dc.html': shareCompose('sending'),
  'ShareQueued.dc.html': shareCompose('queued'),
  'SharePermission.dc.html': sharePermissionSheet(),
  'SharedInbox.dc.html': sharedInbox('inbox'),
  'SharedInboxPending.dc.html': sharedInbox('pending'),
  'SharedInboxSent.dc.html': sharedInbox('sent'),
  'SharedInboxEmpty.dc.html': sharedInbox('empty'),
  'ShareDetail.dc.html': shareDetail('pending'),
  'ShareDetailAccepted.dc.html': shareDetail('accepted'),
  'ShareRevoked.dc.html': shareDetail('revoked'),
  'ShareExpired.dc.html': shareDetail('expired'),
  'ManageAccess.dc.html': manageAccess('list'),
  'ManageAccessMenu.dc.html': manageAccess('menu'),
  'ManageAccessRemove.dc.html': manageAccess('remove'),
  'ProfilePreview.dc.html': profilePreview(),
  'Groups.dc.html': groupsScreen(),
  'Group.dc.html': groupScreen('members'),
  'GroupDocuments.dc.html': groupScreen('documents'),
  'GroupSettings.dc.html': groupScreen('settings'),
  'SharingPrivacy.dc.html': sharingPrivacy(),
  'NotificationSettings.dc.html': notificationSettings(),
  'NotificationPermission.dc.html': notificationPermission(),
  'ReaderShare.dc.html': readerShare(),
  'HomeSharedRail.dc.html': homeSharedRail(),
  'ShareModel.dc.html': shareModel(),
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
    { file: 'SyncStates.dc.html', title: 'Where a document is', x: 0, y: 4344, w: 1024, h: 600 },
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

    { file: 'OfflineIdentity.dc.html', title: 'Home — opened with no connection', x: 0, y: 12260, w: 390, h: 844 },
    { file: 'SyncActivity.dc.html', title: 'Sync — what is waiting', x: 490, y: 12260, w: 390, h: 844 },
    { file: 'SyncActivityFailed.dc.html', title: 'Sync — a change that would not go', x: 980, y: 12260, w: 390, h: 844 },
    { file: 'AccountSync.dc.html', title: 'Account — with sync', x: 1470, y: 12260, w: 390, h: 844 },
    { file: 'ImportOffline.dc.html', title: 'Import — with no connection', x: 1960, y: 12260, w: 390, h: 844 },
    { file: 'ImportNoSpace.dc.html', title: 'Import — not enough room', x: 2450, y: 12260, w: 390, h: 844 },

    { file: 'LocalFirst.dc.html', title: 'Where a read and a write go', x: 0, y: 13224, w: 900, h: 620 },
    { file: 'SyncPipeline.dc.html', title: 'The outbox', x: 1000, y: 13224, w: 1024, h: 700 },

    { file: 'DeviceStorage.dc.html', title: 'On this device', x: 0, y: 14180, w: 390, h: 844 },
    { file: 'DeviceStorageTight.dc.html', title: 'On this device — running out, and unencrypted', x: 490, y: 14180, w: 390, h: 844 },

    { file: 'Share.dc.html', title: 'Share — who with', x: 0, y: 15144, w: 390, h: 844 },
    { file: 'ShareSearching.dc.html', title: 'Share — an exact handle, and your own groups', x: 490, y: 15144, w: 390, h: 844 },
    { file: 'ShareNoMatch.dc.html', title: 'Share — no account by that name', x: 980, y: 15144, w: 390, h: 844 },
    { file: 'SharePermission.dc.html', title: 'Share — what they can do', x: 1470, y: 15144, w: 390, h: 844 },
    { file: 'ShareSending.dc.html', title: 'Share — sending', x: 1960, y: 15144, w: 390, h: 844 },
    { file: 'ShareQueued.dc.html', title: 'Share — with no connection', x: 2450, y: 15144, w: 390, h: 844 },

    { file: 'SharedInbox.dc.html', title: 'Shared with you', x: 0, y: 16108, w: 390, h: 844 },
    { file: 'SharedInboxPending.dc.html', title: 'Shared — waiting on you', x: 490, y: 16108, w: 390, h: 844 },
    { file: 'SharedInboxSent.dc.html', title: 'Shared — what you sent', x: 980, y: 16108, w: 390, h: 844 },
    { file: 'SharedInboxEmpty.dc.html', title: 'Shared — nothing yet', x: 1470, y: 16108, w: 390, h: 844 },
    { file: 'ShareDetail.dc.html', title: 'A share — accept or decline', x: 1960, y: 16108, w: 390, h: 844 },
    { file: 'ShareDetailAccepted.dc.html', title: 'A share — accepted', x: 2450, y: 16108, w: 390, h: 844 },

    { file: 'ShareRevoked.dc.html', title: 'A share — access removed', x: 0, y: 17072, w: 390, h: 844 },
    { file: 'ShareExpired.dc.html', title: 'A share — expired', x: 490, y: 17072, w: 390, h: 844 },
    { file: 'ManageAccess.dc.html', title: 'Who can open this', x: 980, y: 17072, w: 390, h: 844 },
    { file: 'ManageAccessMenu.dc.html', title: 'Who can open this — one person', x: 1470, y: 17072, w: 390, h: 844 },
    { file: 'ManageAccessRemove.dc.html', title: 'Removing access, and what it cannot do', x: 1960, y: 17072, w: 390, h: 844 },
    { file: 'ProfilePreview.dc.html', title: 'A person, as far as sharing shows them', x: 2450, y: 17072, w: 390, h: 844 },

    { file: 'Groups.dc.html', title: 'Groups', x: 0, y: 18036, w: 390, h: 844 },
    { file: 'Group.dc.html', title: 'A group — members', x: 490, y: 18036, w: 390, h: 844 },
    { file: 'GroupDocuments.dc.html', title: 'A group — what is shared in it', x: 980, y: 18036, w: 390, h: 844 },
    { file: 'GroupSettings.dc.html', title: 'A group — settings', x: 1470, y: 18036, w: 390, h: 844 },
    { file: 'SharingPrivacy.dc.html', title: 'Sharing & privacy', x: 1960, y: 18036, w: 390, h: 844 },
    { file: 'NotificationSettings.dc.html', title: 'Notifications', x: 2450, y: 18036, w: 390, h: 844 },

    { file: 'NotificationPermission.dc.html', title: 'Notifications — asking, once it is worth something', x: 0, y: 19000, w: 390, h: 844 },
    { file: 'ReaderShare.dc.html', title: 'Reader — sharing, and who else is here', x: 490, y: 19000, w: 390, h: 844 },
    { file: 'HomeSharedRail.dc.html', title: 'Home — what other people sent', x: 980, y: 19000, w: 390, h: 844 },

    { file: 'ShareModel.dc.html', title: 'Identity, membership, access', x: 1470, y: 19000, w: 900, h: 720 },
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
    { id: 'note-offline-first', x: 0, y: 12110, w: 880, text: 'Offline is not a mode this app enters.\nThe local database and the files beside it are the first source for every ordinary read, and the account is what the device converges with afterwards \u2014 so none of these screens is a degraded one. The only thing that changes with no connection is a line saying so and a queue quietly filling up.' },
    { id: 'note-outbox', x: 1000, y: 13074, w: 1024, text: 'One queue row per thing, not per change. That is what makes two hundred page turns one message, and it is also why the values are read off the row at the moment of sending rather than captured when the reader acted \u2014 the account is told where somebody ended up, not replayed through every page they passed.' },
    { id: 'note-covers', x: 1960, y: 2360, w: 300, text: 'No cards anywhere. The cover is the only filled shape on the surface; sections are separated by whitespace, and the one rule on the screen sits above View all library.' },
    { id: 'note-sharing', x: 0, y: 14994, w: 880, text: 'Sharing is a grant, not a copy.\nThe document stays one row with one owner. A documentShares row says who else may open it, what they may do, and when that stops — and it is resolved on every read rather than cached into a session, so removing access is immediate everywhere the server is in the loop.\nSearch is a lookup: an exact @handle or an exact email, plus display-name prefixes among people already in a group with you. A Convex query cannot spend a rate-limiter token, so an index over every account would be an enumeration endpoint with nothing to bound it.' },
    { id: 'note-share-truth', x: 0, y: 16922, w: 880, text: 'The one thing this feature must keep saying out loud: a file that has been downloaded cannot be recalled.\nRemove access stops the next open, the next download and the next sync. It does not reach a copy already sitting on somebody else\u2019s phone, because no server can. That is why downloading is off by default, asked for per share, and spelled out in the dialog rather than discovered afterwards.' },
    { id: 'note-notify', x: 2940, y: 18886, w: 380, text: 'A push says a PDF was shared with you and who by. Never the title \u2014 it renders on a locked screen. The rest arrives from an authenticated query once the app is open and the recipient has been checked.' },
    { id: 'note-device-storage', x: 0, y: 14030, w: 880, text: 'The screen the refusal always assumed.\nAn import with no room says to remove a download or two, and until now nothing said which ones were large — the account’s Storage section reported what was in the account, which is the other half.\nEvery row says what removing it costs. A document in the account comes back on a tap; a document that is only here does not come back at all. Same gesture, two consequences, so the row says which before the reader commits. And no covers: this is the one library surface where a document is a quantity rather than something to open.' },
  ],
  launch: { view: 'canvas' },
};
writeFileSync(new URL('./canvas.json', import.meta.url), JSON.stringify(canvas, null, 2));
console.log('wrote', Object.keys(out).length, 'artboards + canvas.json');
