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
  warn: '#e0a83e', warnTint: '#2b210c',
  onPrimary: '#ffffff', inset: 'rgba(255,255,255,.05)',
};
const LIGHT = {
  bg: '#ffffff', surface: '#fafaf9', elevated: '#ffffff', sunken: '#f4f3f1', hover: '#f0efec',
  hairline: '#eceae6', border: '#e2e0dc', borderStrong: '#c6c3be',
  fg: '#171615', fgMuted: '#6e6c68', fgSubtle: '#8f8d88', fgDisabled: '#b0aea9',
  primary: '#6a59e8', primaryTint: '#f0eefd', destructive: '#d0282c', ok: '#168f59',
  warn: '#b0740c', warnTint: '#fdf6e8',
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
  /* Round two: activity, devices, data. */
  bellRing: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M22 8c0-2.3-.8-4.3-2-6"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/><path d="M4 2C2.8 3.7 2 5.7 2 8"/>',
  wifi: '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M2 8.82a15 15 0 0 1 20 0"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  smartphone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  shieldAlert: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="M5 4.5a1 1 0 0 1 1.52-.85l11 7.5a1 1 0 0 1 0 1.7l-11 7.5A1 1 0 0 1 5 19.5z"/>',
  fileCheck: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/>',
  circleSlash: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m6.08 10.37-3.48 1.59a1 1 0 0 0 0 1.83l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.48-1.59"/><path d="m6.08 15.37-3.48 1.59a1 1 0 0 0 0 1.83l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.48-1.59"/>',
  sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
  /* Intelligence. Two, because the rest of this vocabulary already existed. */
  sparkles: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
  cpu: '<path d="M12 20v2"/><path d="M12 2v2"/><path d="M17 20v2"/><path d="M17 2v2"/><path d="M2 12h2"/><path d="M2 17h2"/><path d="M2 7h2"/><path d="M20 12h2"/><path d="M20 17h2"/><path d="M20 7h2"/><path d="M7 20v2"/><path d="M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
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
      ${tab('contents', 'Contents')}${tab('bookmarks', bookmarks === 0 ? 'Bookmarks' : `Bookmarks · ${bookmarks}`)}${tab('notes', notes === 0 ? 'Passages' : `Passages · ${notes}`)}${tab('pages', 'Pages')}
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
    glyph: 'highlighter', title: 'Passages', subtitle: doc.t,
    trailing: `<span style="font-size:12px;color:${c.fgSubtle}" class="tnum">3</span>`,
    active: 'notes', counts: { bookmarks: 5, notes: 3 },
    body: `<div style="padding-top:4px">
      ${row('&ldquo;System 1 operates automatically and quickly, with little or no effort and no sense of voluntary control.&rdquo;', null, 20)}
      ${row('&ldquo;The law of small numbers is a bias of confidence over doubt.&rdquo;', null, 142, true)}
      ${row('&ldquo;&hellip;an anchoring index of 55%, which is about what most of these experiments produce.&rdquo;', null, 152)}
    </div>`,
  })}
</div>`,
  });
}

/**
 * Nothing kept yet.
 *
 * It says what to do rather than what is absent. The button under it offered
 * writing a note, which is not something this application does any more — so
 * the state says where keeping comes from instead of offering a control that
 * Android could not honour anyway: the renderer reports no text selection
 * there, which is why the sentence names the gesture rather than a button.
 */
function readerNotesEmpty() {
  const c = DARK;
  const doc = byTitle('Thinking,');

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${navigatorPage(c, {
    glyph: 'highlighter', title: 'Passages', subtitle: doc.t,
    active: 'notes', counts: { bookmarks: 5, notes: 0 },
    body: `<div style="padding:44px ${PAD}px 24px;text-align:center">
      ${icon('quote', 26, c.fgDisabled)}
      <div style="margin-top:14px;font-size:15px;font-weight:600;color:${c.fg}">Nothing kept yet</div>
      <div style="margin-top:6px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">Select a passage while reading and choose Keep. It stays with the page it came from.</div>
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

/**
 * The empty state, and where it sits.
 *
 * `pt-16` in the first version, which put "No groups yet" a third of the way
 * down a screen whose whole content was that sentence — and it is the *first*
 * thing a new account sees on both Groups and Shared. Half that, and left
 * aligned: an empty state is still a sentence, and a sentence centred over two
 * lines reads as an error page.
 */
function emptyState(c, { glyph, title, body, action = null }) {
  // Centred in whatever is left, which is what the screens do: an empty state
  // is the only thing on the screen, and a fixed top padding is a guess about
  // how tall the screen is. See `Empty` in `components/segments.tsx`.
  return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 32px;text-align:center">
      ${icon(glyph, 26, c.fgSubtle, 1.6)}
      <div style="margin-top:14px;font-size:16px;font-weight:600;letter-spacing:-.012em;color:${c.fg}">${title}</div>
      <div style="margin-top:7px;max-width:300px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">${body}</div>
      ${action === null ? '' : `<div style="margin-top:16px;display:inline-flex">${action}</div>`}
    </div>`;
}

/**
 * A row that has not arrived yet.
 *
 * The rest of the app answers "loading" with a skeleton of the shape that is
 * coming — `library-skeleton.tsx` keeps the real headings and greys only the
 * covers. Sharing answered it with a spinner in the middle of the screen eight
 * times over, which tells the reader nothing about what is about to appear and
 * moves everything when it does.
 */
function skeletonRow(c, { avatar = true, lines = [62, 38] } = {}) {
  const bone = (w, h, mt = 0) =>
    `<div style="width:${w};height:${h}px;border-radius:${R};background:${c.hover};${mt ? `margin-top:${mt}px` : ''}"></div>`;
  return `<div class="bones" style="display:flex;align-items:center;gap:12px;padding:12px ${PAD}px">
      ${avatar
        ? `<div style="width:40px;height:40px;border-radius:9999px;background:${c.hover};flex:0 0 auto"></div>`
        : `<div style="width:40px;height:56px;border-radius:${R};background:${c.hover};flex:0 0 auto"></div>`}
      <div style="flex:1">${bone(lines[0] + '%', 11)}${bone(lines[1] + '%', 10, 7)}</div>
    </div>`;
}

/** The bar the library already draws for a transfer. Same two pixels, same track. */
function progressBar(c, pct, width = '100%') {
  return `<div style="width:${width};height:2px;border-radius:${R};background:${c.border};overflow:hidden">
      <div style="width:${pct}%;height:100%;border-radius:${R};background:${c.primary}"></div>
    </div>`;
}

/**
 * A count of things nobody has looked at.
 *
 * The one place a filled shape is allowed on these screens. It is a number
 * somebody has to act on, which is what separates it from every other piece of
 * metadata here — those are all `text-fg-subtle` and stay that way.
 */
function unreadBadge(c, count) {
  return `<div style="min-width:18px;height:18px;padding:0 5px;border-radius:9999px;background:${c.primary};display:flex;align-items:center;justify-content:center;flex:0 0 auto">
      <span style="font-size:10px;font-weight:600;color:${c.onPrimary}" class="tnum">${count}</span>
    </div>`;
}

/** One registered handset: what it is called, whether it will be told, and a way out. */
function deviceRow(c, { name, detail, on, thisOne = false }) {
  return `<div style="display:flex;align-items:center;gap:14px;padding:11px ${PAD}px">
      ${icon('smartphone', 19, c.fgMuted)}
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;color:${c.fg}">${name}${thisOne ? ' <span style="font-size:12px;color:' + c.fgSubtle + '">· this device</span>' : ''}</div>
        <div style="margin-top:2px;font-size:12px;color:${c.fgSubtle}">${detail}</div>
      </div>
      ${switchToggle(c, on)}
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
    ? emptyState(c, {
        glyph: 'atSign',
        title: 'No account called @kimw',
        body: 'Handles and email addresses have to match exactly. Pidom does not list accounts you have no connection to, so there is nothing to browse here.',
      })
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
        ${icon('clock', 19, c.fgMuted)}
        <div style="flex:1"><div style="font-size:15px;color:${c.fg}">Access ends in a week</div>
        <div style="margin-top:2px;font-size:12px;color:${c.fgSubtle}">The only permission that takes itself back</div></div>
        ${icon('chevronRight', 15, c.fgSubtle, 2)}
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
      ${readerRow(c, { glyph: 'highlighter', label: 'Can annotate', note: 'Keep passages from it. Theirs, and you see them.' })}
      <div style="height:1px;margin:6px ${PAD}px;background:${c.hairline}"></div>
      ${readerRow(c, { glyph: 'download', label: 'Can download a copy', note: 'Puts the file on their device. Removing access later does not take it back.' })}
      ${readerRow(c, { glyph: 'share2', label: 'Can share it on', note: 'Never more than they have themselves.' })}
      ${readerRow(c, { glyph: 'clock', label: 'Access ends', note: 'A week from when you share it.', checked: true })}
      <div style="padding:14px ${PAD}px 4px">
        <div style="font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Downloading and resharing are off unless you turn them on, on every share. An end date is the only one of these that takes access back on its own.</div>
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
    empty: emptyState(c, {
      glyph: 'inbox',
      title: 'Nothing shared with you',
      body: 'When somebody shares a PDF with you it lands here, with their name on it, before anything is downloaded.',
    }),
    skeleton: `<div style="padding-top:2px">${skeletonRow(c, { avatar: false })}${skeletonRow(c, { avatar: false, lines: [48, 44] })}${skeletonRow(c, { avatar: false, lines: [70, 30] })}${skeletonRow(c, { avatar: false, lines: [40, 36] })}</div>`,
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
    skeleton: [
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
    subtitle: empty ? 'Nothing yet' : variant === 'skeleton' ? 'Checking…' : '4 documents · 2 waiting',
    trailing:
      variant === 'inbox'
        ? unreadBadge(c, 2)
        : empty || variant === 'skeleton'
          ? ''
          : `<span style="font-size:12px;color:${c.fgSubtle}" class="tnum">${{ pending: 2, sent: 3 }[variant]}</span>`,
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
/**
 * One document somebody shared, from the recipient's side.
 *
 * **Redrawn, and the shape is the point.** The first version centred a 164px
 * cover, centred the title under it, and then pushed the buttons to the bottom
 * bezel with a `flex-1` spacer — so on a tall phone everything floated in the
 * top third with a hole in the middle, and on a short one a three-line title
 * plus the revoked paragraph ran off the bottom of a screen that could not
 * scroll. Content sits at the top now, in the same left-aligned identity row
 * the share screen already uses, the body scrolls, and the actions are a fixed
 * footer under the scroller rather than an island floating above the edge.
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
  const downloading = variant === 'downloading';

  const allowRow = (glyph, label, on) =>
    `<div style="display:flex;align-items:center;gap:14px;padding:9px ${PAD}px">
       ${icon(glyph, 18, on ? c.fgMuted : c.fgDisabled)}
       <span style="flex:1;font-size:14px;color:${on ? c.fg : c.fgDisabled}">${label}</span>
       ${on ? icon('check', 16, c.ok, 2.2) : icon('close', 15, c.fgDisabled, 2.2)}
     </div>`;

  const footer = downloading
    ? `<div style="padding:12px ${PAD}px 30px">
         <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">
           <span style="font-size:12px;color:${c.fgMuted}">Downloading</span>
           <span style="font-size:12px;color:${c.fgSubtle}" class="tnum">6.3 of 12.4 MB</span>
         </div>
         ${progressBar(c, 51)}
       </div>`
    : revoked
      ? `<div style="padding:12px ${PAD}px 30px">${quietButton(c, 'Open the copy on this device', { glyph: 'bookOpen' })}</div>`
      : expired
        ? `<div style="padding:12px ${PAD}px 30px">${primaryButton(c, 'Ask Amina again', { tone: 'quiet', glyph: 'send' })}</div>`
        : accepted
          ? `<div style="padding:12px ${PAD}px 30px;display:flex;flex-direction:column;gap:10px">
               ${primaryButton(c, 'Download for offline', { glyph: 'download' })}
               ${quietButton(c, 'Open without downloading', { glyph: 'bookOpen' })}
             </div>`
          : `<div style="padding:12px ${PAD}px 30px;display:flex;flex-direction:column;gap:10px">
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
      : downloading
        ? quietNotice(c, 'cloudDown', 'Once it is here it opens with no connection, like everything else in your library.')
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
    glyph: revoked || expired ? 'ban' : 'share2',
    title: revoked ? 'Access removed' : expired ? 'Share expired' : 'Shared with you',
    subtitle: `From ${from.n}`,
    body: `<div style="flex:1;display:flex;flex-direction:column;min-height:0">
      <div style="flex:1;min-height:0;overflow:hidden">

        <!-- The document, as an identity row rather than a poster. Same
             composition as the share screen's header, so the two surfaces read
             as one feature. -->
        <div style="display:flex;align-items:center;gap:14px;padding:14px ${PAD}px">
          ${pageCover(doc, { w: 52 })}
          <div style="flex:1;min-width:0">
            <div style="font-size:15px;font-weight:600;letter-spacing:-.01em;color:${revoked || expired ? c.fgMuted : c.fg}" class="c2 pretty">${doc.t}</div>
            <div style="margin-top:4px;font-size:12px;color:${c.fgSubtle}" class="tnum">${doc.p} pages · ${doc.size}</div>
          </div>
        </div>
        <div style="height:1px;background:${c.hairline};margin:0 ${PAD}px"></div>

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
          ${allowRow('download', 'Download a copy', accepted || downloading)}
          ${allowRow('share2', 'Share it on', false)}
        </div>

        ${state}
      </div>

      <div style="height:1px;background:${c.hairline}"></div>
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

/* ======================= ROUND TWO: what was missing ================ *
 * The first pass built the sharing feature and left four things
 * unreachable: nothing was live, the event feed had no screen, avatars
 * were frozen at sign-up, and content sat low. These are the surfaces
 * that fix them.
 * ------------------------------------------------------------------- */

/**
 * What has happened, in order.
 *
 * `shareEvents` has had a table, a sync pass and an unread count since the day
 * sharing shipped, and nothing rendered any of it. This is the screen that was
 * missing — and it is a *feed*, not an inbox: every row here is a thing that
 * already happened, so tapping one goes to the share it describes rather than
 * asking for a decision. Decisions live under Pending.
 *
 * Unread rows carry a dot rather than a background wash. A filled row in a list
 * of twenty filled rows stops meaning anything by the third one.
 */
function activityScreen(empty = false) {
  const c = DARK;

  const row = (p, glyph, text, when, unread) =>
    `<div style="display:flex;align-items:flex-start;gap:12px;padding:12px ${PAD}px">
       <div style="position:relative;flex:0 0 auto">
         ${faceOf(c, p, 36)}
         <div style="position:absolute;right:-3px;bottom:-3px;width:17px;height:17px;border-radius:9999px;background:${c.bg};display:flex;align-items:center;justify-content:center">
           ${icon(glyph, 11, c.fgMuted, 2.2)}
         </div>
       </div>
       <div style="flex:1;min-width:0;padding-top:1px">
         <div style="font-size:14px;line-height:19px;color:${unread ? c.fg : c.fgMuted}" class="pretty">${text}</div>
         <div style="margin-top:3px;font-size:11px;color:${c.fgSubtle}">${when}</div>
       </div>
       ${unread ? `<div style="width:7px;height:7px;border-radius:9999px;background:${c.primary};flex:0 0 auto;margin-top:7px"></div>` : ''}
     </div>`;

  const body = empty
    ? emptyState(c, {
        glyph: 'bellRing',
        title: 'Nothing has happened yet',
        body: 'When somebody shares a PDF with you, answers one of yours, or adds you to a group, it shows up here — whether or not a notification reached your phone.',
      })
    : `<div style="padding-top:2px">
        ${row(byHandle('amina'), 'share2', '<b style="font-weight:600;color:' + c.fg + '">Amina Wanjiru</b> shared a PDF with you', '2 hours ago', true)}
        ${row(byHandle('grace_o'), 'check', '<b style="font-weight:600;color:' + c.fg + '">Grace Otieno</b> accepted a PDF you shared', '4 hours ago', true)}
        ${row(byHandle('jkimani'), 'users', '<b style="font-weight:600;color:' + c.fgMuted + '">Joseph Kimani</b> shared a PDF with Reading group', 'Yesterday', false)}
        ${row(byHandle('dmwangi'), 'ban', '<b style="font-weight:600;color:' + c.fgMuted + '">Daniel Mwangi</b> removed your access to a PDF', 'Yesterday', false)}
        ${row(byHandle('faithn'), 'userPlus', '<b style="font-weight:600;color:' + c.fgMuted + '">Faith Njeri</b> added you to Kilimani Housing Co-op', '3 days ago', false)}
        ${row(byHandle('grace_o'), 'notebookPen', '<b style="font-weight:600;color:' + c.fgMuted + '">Grace Otieno</b> wrote a note on a PDF you shared', 'Last week', false)}
        ${quietNotice(c, 'lock', 'A row here never says which document. The title comes from a query that checks you can still read it — a feed that cached titles would keep showing them after access was removed.')}
      </div>`;

  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${sharePage(c, {
    glyph: 'bellRing',
    title: 'Activity',
    subtitle: empty ? 'Nothing yet' : '2 you have not seen',
    trailing: empty ? '' : unreadBadge(c, 2),
    body: `<div style="flex:1;min-height:0;overflow:hidden">${body}</div>`,
  })}
</div>`,
  });
}

/**
 * The count, where it is actually read.
 *
 * Two places, and only two: the Account row that leads to Shared, and the
 * Shared header itself. A badge on the tab bar would be a badge on a tab bar
 * this app does not have, and a badge on the home screen would be a number
 * competing with six rails of covers.
 */
function sharedBadge() {
  const c = DARK;

  const navRow = (glyph, title, hint, trailing) =>
    `<div style="display:flex;align-items:center;gap:14px;padding:12px ${PAD}px">
       ${icon(glyph, 19, c.fgMuted)}
       <div style="flex:1;min-width:0">
         <div style="font-size:14px;color:${c.fg}">${title}</div>
         <div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${hint}</div>
       </div>
       ${trailing}
       ${icon('chevronRight', 15, c.fgSubtle, 2)}
     </div>`;

  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="height:844px;overflow:hidden;background:${c.bg}">
  <div style="display:flex;align-items:center;gap:10px;padding:44px ${PAD}px 12px">
    ${icon('arrowLeft', 22, c.fg, 2)}
    <span style="font-size:16px;font-weight:600;letter-spacing:-.01em;color:${c.fg}">Account</span>
  </div>

  <div style="display:flex;flex-direction:column;align-items:center;padding:14px 0 22px">
    ${faceOf(c, { n: 'Emmanuel Gichuhi', i: 'EG' }, 80)}
    <div style="margin-top:14px;font-size:20px;font-weight:700;letter-spacing:-.016em;color:${c.fg}">Emmanuel Gichuhi</div>
    <div style="margin-top:4px;font-size:13px;color:${c.fgMuted}">egichuhi580@gmail.com</div>
    <div style="margin-top:12px;display:flex;align-items:center;gap:7px;padding:6px 12px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}">
      ${icon('pencil', 13, c.fgMuted, 2)}
      <span style="font-size:12px;color:${c.fg}">Edit profile</span>
    </div>
  </div>

  <div style="height:1px;background:${c.hairline};margin:0 ${PAD}px"></div>
  ${settingsLabel(c, 'Sharing', 18)}
  ${navRow('inbox', 'Shared', 'Documents other people sent you, and what you sent them.', unreadBadge(c, 2) + '<div style="width:8px"></div>')}
  ${navRow('bellRing', 'Activity', 'Everything that has happened, whether or not a notification arrived.', unreadBadge(c, 2) + '<div style="width:8px"></div>')}
  ${navRow('users', 'Groups', 'Share with several people at once, and take it back the same way.', '')}
  ${navRow('shieldCheck', 'Sharing & privacy', 'Who can find you, and what a share of yours starts as.', '')}
  ${navRow('bell', 'Notifications', 'What you are told about, and on which device.', '')}

  <div style="height:1px;background:${c.hairline};margin:14px ${PAD}px 0"></div>
  ${settingsLabel(c, 'Data', 18)}
  ${navRow('sliders', 'Sync & data', 'Downloads, cached images, and deleting your account.', '')}
</div>`,
  });
}

/**
 * Rows that have not arrived yet.
 *
 * Sharing answered "loading" with a spinner in the middle of the screen, eight
 * times over. The rest of the app answers it with the shape of what is coming —
 * so nothing moves when it lands, and the reader can already see they are
 * waiting for a list of documents rather than for a screen.
 */
function sharedSkeleton() {
  return sharedInbox('skeleton');
}

/**
 * Changing what somebody may do, after the fact.
 *
 * The first pass could grant a permission and revoke it, and nothing in
 * between: `setPermission` existed on the client and no screen called it, so
 * promoting a reader to an annotator meant removing their access and sharing
 * again — which sends them a second notification for a document they already
 * have.
 */
function accessPermission() {
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
    title: 'What Grace can do',
    subtitle: doc.t,
    body: `<div style="padding-top:4px">
      ${readerRow(c, { glyph: 'eye', label: 'Can read', note: 'Open it and read it. Nothing is written back.' })}
      ${readerRow(c, { glyph: 'notebookPen', label: 'Can annotate', note: 'Keep passages and write notes on it. Theirs, and you see them.', checked: true })}
      <div style="height:1px;margin:6px ${PAD}px;background:${c.hairline}"></div>
      ${readerRow(c, { glyph: 'download', label: 'Can download a copy', note: 'Puts the file on their device. Removing access later does not take it back.' })}
      ${readerRow(c, { glyph: 'share2', label: 'Can share it on', note: 'Never more than they have themselves.' })}
      <div style="padding:12px ${PAD}px 4px">
        <div style="font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Narrowing what somebody can do takes effect on their next tap. Widening it does not send them a second notification — they already have the document.</div>
      </div>
    </div>`,
  })}
</div>`,
  });
}

/**
 * Leaving, with the consequence stated.
 *
 * `group-screen.tsx` fired delete-group and remove-member on tap, with no
 * confirmation, while `RemoveAccessDialog` sat two files away as the
 * established pattern for exactly this. Leaving a group takes documents with
 * it, and that is a sentence the reader should see before the tap.
 */
function groupLeaveConfirm() {
  const c = DARK;

  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${sharePage(c, {
    glyph: 'users',
    title: 'Reading group',
    subtitle: '6 members · 4 documents',
    segs: [
      { label: 'Members · 6', on: false },
      { label: 'Shared PDFs · 4', on: false },
      { label: 'Settings', on: true },
    ],
    body: `<div style="flex:1;min-height:0;padding-top:6px">
      ${settingsPick(c, { label: 'Name', value: 'Reading group' })}
      ${settingsPick(c, { label: 'Who can add members', note: 'Members can always leave.', value: 'Admins' })}
      <div style="height:1px;background:${c.hairline};margin:10px ${PAD}px"></div>
      <div style="display:flex;align-items:center;gap:14px;padding:11px ${PAD}px">
        ${icon('logOut', 19, c.destructive)}
        <div style="flex:1">
          <div style="font-size:15px;color:${c.destructive}">Leave this group</div>
          <div style="margin-top:2px;font-size:12px;color:${c.fgSubtle}">You lose access to the 4 documents shared here.</div>
        </div>
      </div>
    </div>`,
  })}
  <div style="position:absolute;inset:0;background:rgba(0,0,0,.55)"></div>
  <div style="position:absolute;left:26px;right:26px;top:280px;border-radius:${R};background:${c.elevated};box-shadow:0 0 0 1px ${c.border};padding:20px">
    <div style="font-size:17px;font-weight:700;letter-spacing:-.014em;color:${c.fg}">Leave Reading group?</div>
    <div style="margin-top:10px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">The four documents shared into this group stop opening for you. Anything you downloaded from them stays on this phone.</div>
    <div style="margin-top:10px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">Two of them are yours. Those stay shared with the group unless you remove them yourself.</div>
    <div style="margin-top:20px;display:flex;justify-content:flex-end;gap:10px">
      <div style="height:36px;display:flex;align-items:center;padding:0 14px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}"><span style="font-size:14px;color:${c.fg}">Cancel</span></div>
      <div style="height:36px;display:flex;align-items:center;padding:0 14px;border-radius:${R};background:${c.destructive}"><span style="font-size:14px;font-weight:500;color:#ffffff">Leave</span></div>
    </div>
  </div>
</div>`,
  });
}

/**
 * The reader's own name and face.
 *
 * Everything on this screen was previously read-only and, worse, frozen:
 * `useEnsureProfile` fired once in an account's lifetime, so the name and photo
 * other people saw were whatever Google said on the day of sign-up. Fixing that
 * refresh is most of the work; this is the half a person can see.
 *
 * **There is no field that accepts a photo URL.** A string the server then
 * renders on other people's screens is a tracking pixel and an SSRF probe, for
 * no gain over the two choices here.
 */
function profileEdit() {
  const c = DARK;

  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${sharePage(c, {
    glyph: 'user',
    title: 'Your profile',
    subtitle: 'What other people see',
    trailing: `<span style="font-size:14px;font-weight:500;color:${c.primary}">Save</span>`,
    body: `<div style="flex:1;min-height:0">
      <div style="display:flex;flex-direction:column;align-items:center;padding:22px 0 6px">
        ${faceOf(c, { n: 'Emmanuel Gichuhi', i: 'EG' }, 84)}
      </div>

      ${settingsLabel(c, 'Photo', 18)}
      ${readerRow(c, { glyph: 'user', label: 'Use my Google photo', note: 'Kept up to date when you change it there.', checked: true })}
      ${readerRow(c, { glyph: 'eyeOff', label: 'No photo', note: 'Your initials, everywhere your name appears.' })}

      ${settingsLabel(c, 'Name')}
      <div style="margin:0 ${PAD}px;height:44px;display:flex;align-items:center;padding:0 12px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.primary}">
        <span style="font-size:14px;color:${c.fg}">Emmanuel Gichuhi</span>
      </div>
      <div style="padding:8px ${PAD}px 0">
        <div style="font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Set your own and Pidom stops overwriting it with the one from Google. Clear it and it follows Google again.</div>
      </div>

      ${settingsLabel(c, 'Handle')}
      ${settingsPick(c, { label: 'Your handle', note: 'How people find you without knowing your email address.', value: '@emmanuel' })}

      ${quietNotice(c, 'lock', 'Your email address is never shown to anybody. It is only matched, exactly, by somebody who already has it.')}
    </div>`,
  })}
</div>`,
  });
}

/**
 * Devices, and when not to disturb.
 *
 * Both of these were half-built. The devices list rendered "Will be notified"
 * as text beside a `setDeviceEnabled` mutation nothing called, so a reader
 * could not mute the tablet they left at the office. And quiet hours was a
 * switch hardcoded to 22:00–07:00 in front of a backend that accepts any
 * minute — with an offset captured once and never refreshed, so the window
 * drifted by three hours if you flew anywhere.
 */
function notificationDevices() {
  const c = DARK;

  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${sharePage(c, {
    glyph: 'bell',
    title: 'Notifications',
    subtitle: 'On · quiet 22:00–07:00',
    body: `<div style="flex:1;min-height:0">
      ${settingsLabel(c, 'Quiet hours', 14)}
      ${settingsSwitch(c, { label: 'Hold notifications overnight', note: 'They arrive in the morning. Nothing is dropped.', on: true })}
      ${settingsPick(c, { label: 'From', value: '22:00' })}
      ${settingsPick(c, { label: 'Until', value: '07:00' })}
      ${quietNotice(c, 'clock', 'Your time zone is sent with this and refreshed whenever you open the app, so the window stays where you set it if you travel.')}

      <div style="height:1px;background:${c.hairline};margin:6px ${PAD}px"></div>
      ${settingsLabel(c, 'Devices', 14)}
      ${deviceRow(c, { name: 'Pixel 8', detail: 'Registered 12 August', on: true, thisOne: true })}
      ${deviceRow(c, { name: 'iPad', detail: 'Last seen 3 days ago', on: false })}
      <div style="display:flex;align-items:center;gap:14px;padding:11px ${PAD}px">
        ${icon('trash', 19, c.destructive)}
        <div style="flex:1">
          <div style="font-size:15px;color:${c.destructive}">Forget iPad</div>
          <div style="margin-top:2px;font-size:12px;color:${c.fgSubtle}">It registers again next time you open Pidom on it.</div>
        </div>
      </div>
      ${quietNotice(c, 'lock', 'A push token is never shown here and never leaves the server except toward Expo. Muting a device keeps the token; forgetting one deletes it.')}
    </div>`,
  })}
</div>`,
  });
}

/**
 * What moves, what is cached, and how to leave.
 *
 * Three things with no home before this. Downloads had no cellular guard even
 * though NetInfo already reports the connection type; the `expo-image` cache is
 * capped at 100 MB and was invisible and unclearable; and `sign-out-action.tsx`
 * said in as many words that deleting a library "is what delete means, and
 * there is a different button for that" — a button that did not exist.
 */
function syncData() {
  const c = DARK;

  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${sharePage(c, {
    glyph: 'sliders',
    title: 'Sync & data',
    subtitle: 'What moves, and what is kept',
    body: `<div style="flex:1;min-height:0">
      ${settingsLabel(c, 'Downloads', 14)}
      ${settingsSwitch(c, { label: 'Download over Wi-Fi only', note: 'Applies to documents and to anything shared with you. Reading what is already here never uses the network.', on: true })}
      ${settingsSwitch(c, { label: 'Download shared documents automatically', note: 'Off. A document arrives as a title and a name until you ask for the file.', on: false })}

      <div style="height:1px;background:${c.hairline};margin:10px ${PAD}px"></div>
      ${settingsLabel(c, 'On this device', 14)}
      ${settingsPick(c, { label: 'Documents', note: '1.4 GB across 11 documents.', value: 'Manage' })}
      <div style="display:flex;align-items:center;gap:14px;padding:11px ${PAD}px">
        ${icon('image', 19, c.fgMuted)}
        <div style="flex:1">
          <div style="font-size:15px;color:${c.fg}">Covers and thumbnails</div>
          <div style="margin-top:2px;font-size:12px;color:${c.fgSubtle}">48 MB. Rebuilt as you read; clearing it costs nothing but a moment.</div>
        </div>
        <span style="font-size:13px;color:${c.primary}">Clear</span>
      </div>

      <div style="height:1px;background:${c.hairline};margin:10px ${PAD}px"></div>
      ${settingsLabel(c, 'Account', 14)}
      <div style="display:flex;align-items:center;gap:14px;padding:11px ${PAD}px">
        ${icon('trash', 19, c.destructive)}
        <div style="flex:1">
          <div style="font-size:15px;color:${c.destructive}">Delete my account</div>
          <div style="margin-top:2px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Every document, every note, and every share — both the ones you sent and the ones sent to you.</div>
        </div>
      </div>
    </div>`,
  })}
</div>`,
  });
}

/**
 * The one dialog that asks somebody to type a word.
 *
 * Everything else destructive in this app is one tap behind a sentence, and
 * that is right for a document that can be downloaded again. This cannot be
 * undone by anything, so it is deliberately harder than a tap — and it is
 * honest about the one thing it cannot reach.
 */
function deleteAccount() {
  const c = DARK;

  return dc({
    w: 390,
    h: 844,
    bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  <div style="position:absolute;inset:0;background:${c.bg};opacity:.4"></div>
  <div style="position:absolute;inset:0;background:rgba(0,0,0,.6)"></div>
  <div style="position:absolute;left:24px;right:24px;top:200px;border-radius:${R};background:${c.elevated};box-shadow:0 0 0 1px ${c.border};padding:22px">
    <div style="display:flex;align-items:center;gap:10px">
      ${icon('shieldAlert', 20, c.destructive, 2)}
      <div style="font-size:17px;font-weight:700;letter-spacing:-.014em;color:${c.fg}">Delete your account?</div>
    </div>

    <div style="margin-top:14px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">This removes 11 documents from your account, the notes and bookmarks on them, the 6 documents you have shared out, and everything shared with you. It cannot be undone.</div>

    <div style="margin-top:14px;padding:12px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}">
      <div style="display:flex;align-items:flex-start;gap:9px">
        ${icon('info', 14, c.fgSubtle, 2)}
        <div style="flex:1;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">People you gave downloads to keep the copies already on their phones. No account deletion can reach a file on somebody else's disk.</div>
      </div>
    </div>

    <div style="margin-top:16px;font-size:12px;color:${c.fgSubtle}">Type <b style="color:${c.fg}">delete</b> to confirm</div>
    <div style="margin-top:8px;height:44px;display:flex;align-items:center;padding:0 12px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.destructive}">
      <span style="font-size:14px;color:${c.fg}">delete</span>
    </div>

    <div style="margin-top:20px;display:flex;justify-content:flex-end;gap:10px">
      <div style="height:38px;display:flex;align-items:center;padding:0 16px;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}"><span style="font-size:14px;color:${c.fg}">Cancel</span></div>
      <div style="height:38px;display:flex;align-items:center;padding:0 16px;border-radius:${R};background:${c.destructive}"><span style="font-size:14px;font-weight:500;color:#ffffff">Delete everything</span></div>
    </div>
  </div>
</div>`,
  });
}

/* =========================== DOWNLOADS ============================ *
 * What opens on a plane, and why any given document does not yet.
 *
 * The machinery underneath was already good: a signed URL that lives
 * five minutes, a `.download` temp file, three checks on what arrived,
 * and an atomic move. What it had no vocabulary for was *waiting*.
 * `fileState` could say `missing`, `downloading`, `available` or
 * `corrupt` and nothing else — so a download held for Wi-Fi, one
 * queued behind two others, one paused halfway, and one that simply
 * failed were all the same word on the tile: `missing`. A reader about
 * to board a flight could not tell which of those four they were
 * looking at, which is exactly the moment the answer matters most.
 *
 * These boards are that vocabulary. Eleven states, each with one line
 * of plain words and at most one thing to do about it.
 * ------------------------------------------------------------------ */

/**
 * The eleven states, in the order a document moves through them.
 *
 * `glyph`, `tone` and `line` are the whole of a row's treatment, and they are
 * declared once here rather than at each call site so the Downloads screen, the
 * state chart and the anatomy board cannot drift apart — which is the same
 * reason `build.mjs` and `src/design/global.css` share a token list.
 */
const DL = (c) => ({
  missing: { glyph: 'cloudDown', tone: c.fgMuted, label: 'Not downloaded', line: 'In your account. A tap fetches it.' },
  queued: { glyph: 'clock', tone: c.fgSubtle, label: 'Queued', line: 'Waiting for the download before it.' },
  downloading: { glyph: 'cloudDown', tone: c.primary, label: 'Downloading', line: null },
  paused: { glyph: 'pause', tone: c.fgMuted, label: 'Paused', line: null },
  held: { glyph: 'wifiOff', tone: c.warn, label: 'Waiting for Wi-Fi', line: 'Held because downloads are set to Wi-Fi only.' },
  verifying: { glyph: 'shieldCheck', tone: c.primary, label: 'Checking', line: 'Making sure the whole file arrived.' },
  available: { glyph: 'cloudCheck', tone: c.ok, label: 'On this device', line: 'Opens with no connection.' },
  outdated: { glyph: 'refresh', tone: c.warn, label: 'A newer copy is in your account', line: 'This one still opens. Download again to catch up.' },
  corrupt: { glyph: 'shieldAlert', tone: c.destructive, label: "Didn't arrive whole", line: 'Nothing was kept. Try again on a steadier connection.' },
  failed: { glyph: 'circleSlash', tone: c.destructive, label: "Couldn't download", line: 'Eight attempts. Tap to try once more.' },
  removing: { glyph: 'trash', tone: c.fgSubtle, label: 'Removing', line: 'Freeing the space this took.' },
});

/**
 * One document on the Downloads screen.
 *
 * No cover, for the same reason `storageRow` has none: this screen is about
 * whether a file is here, not about which book to read next, and a column of
 * covers turns a management surface back into a shelf. The size is on the right
 * in tabular numerals so a column of them lines up — a download at `3.1 MB of
 * 8.4 MB` and one at `12.4 MB` should not make the eye re-find the decimal.
 *
 * The progress rule is the tile's two pixels rather than a component. The
 * vendored gluestack `Progress` is 8px on a tinted track and is not used
 * anywhere in this application; introducing it here would put two different
 * progress bars on two screens showing the same transfer.
 */
function downloadRow(c, state, doc, { pct = null, detail = null, sub = null, dim = false } = {}) {
  const s = DL(c)[state];
  const line = sub ?? s.line;
  return `<div style="display:flex;align-items:flex-start;gap:12px;padding:13px ${PAD}px;border-bottom:1px solid ${c.hairline};${dim ? 'opacity:.55;' : ''}">
      <div style="margin-top:2px">${icon(s.glyph, 16, s.tone, 2)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;letter-spacing:-.008em;color:${c.fg}" class="c2">${doc.t}</div>
        <div style="margin-top:3px;font-size:12px;line-height:17px;color:${s.tone === c.fgMuted || s.tone === c.fgSubtle ? c.fgSubtle : s.tone}" class="pretty tnum">${line ?? s.label}</div>
        ${pct === null ? '' : `<div style="margin-top:8px">${progressBar(c, pct)}</div>`}
      </div>
      <div style="flex:0 0 auto;display:flex;align-items:flex-start;gap:10px;padding-top:1px">
        <span style="font-size:12px;color:${c.fgMuted}" class="tnum">${detail ?? doc.size}</span>
        ${icon('more', 16, c.fgSubtle, 2)}
      </div>
    </div>`;
}

/**
 * The screen shell. `sharePage` verbatim — a fifth header would be a fifth application.
 *
 * The `position:relative` wrapper is not decoration: `sharePage` lays itself out
 * with `inset:0`, so without a positioned box of a known height it collapses to
 * nothing and the board renders blank.
 */
function downloadsPage(c, { subtitle, active, body }) {
  return `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">${sharePage(c, {
    glyph: 'cloudDown',
    title: 'Downloads',
    subtitle,
    trailing: icon('sliders', 19, c.fgMuted, 2),
    segs: [
      { label: 'All', on: active === 'all' },
      { label: 'On this device', on: active === 'device' },
      { label: 'Waiting', on: active === 'waiting' },
      { label: 'Problems', on: active === 'problems' },
    ],
    body,
  })}</div>`;
}

/**
 * The screen with a mixture on it, which is the state it is usually in.
 *
 * Deliberately not sorted by state. A reader looking for one book scans titles,
 * and grouping by state would move a document every time its state changed —
 * the row under the thumb at the moment a download finishes would be a
 * different row. Largest-first is `/storage`'s ordering because that screen is
 * about quantity; this one is newest-activity-first, because it is about what
 * just happened and what is about to.
 */
function downloads(dark) {
  const c = dark ? DARK : LIGHT;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: downloadsPage(c, {
      subtitle: '6 on this device · 1.4 GB',
      active: 'all',
      body: `<div style="flex:1;overflow:hidden">
        ${downloadRow(c, 'downloading', byTitle('Designing Data'), { pct: 37, detail: '4.6 MB of 12.4 MB', sub: 'Downloading' })}
        ${downloadRow(c, 'queued', byTitle('Sapiens'))}
        ${downloadRow(c, 'available', byTitle('Thinking,'))}
        ${downloadRow(c, 'outdated', byTitle('The Pragmatic'))}
        ${downloadRow(c, 'available', byTitle('Convex Backend'))}
        ${downloadRow(c, 'corrupt', byTitle('Kubernetes'))}
        ${downloadRow(c, 'missing', byTitle('Structure and'))}
      </div>`,
    }),
  });
}

/**
 * Nothing downloaded, and the sentence that says what this screen is for.
 *
 * The empty state is the only thing on the screen, so it sits in the middle of
 * it — `docs/design.md` is explicit that a list starts at the top and a single
 * message does not, and this screen is the second kind until somebody downloads
 * something.
 */
function downloadsEmpty() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: downloadsPage(c, {
      subtitle: 'Nothing on this device',
      active: 'device',
      body: emptyState(c, {
        glyph: 'cloudDown',
        title: 'Nothing downloaded yet',
        body: 'A downloaded document opens with no connection — on a plane, underground, or with the account unreachable. Everything else needs a network.',
        action: quietButton(c, 'Choose what to keep offline', { glyph: 'bookOpen' }),
      }),
    }),
  });
}

/**
 * The queue, which is the half of this feature that did not exist.
 *
 * One at a time by default, and the order is visible. A queue whose order
 * nobody can see is a queue that looks stuck: the reader taps four downloads,
 * watches one bar move, and has no way to know the other three are coming
 * rather than lost.
 */
function downloadsQueue() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: downloadsPage(c, {
      subtitle: '3 waiting · 1 moving',
      active: 'waiting',
      body: `<div style="flex:1;overflow:hidden">
        ${downloadRow(c, 'downloading', byTitle('Designing Data'), { pct: 37, detail: '4.6 MB of 12.4 MB', sub: 'Downloading · about 40 seconds left' })}
        ${downloadRow(c, 'paused', byTitle('Sapiens'), { pct: 62, detail: '4.2 MB of 6.8 MB', sub: 'Paused. Resuming keeps what has arrived.' })}
        ${downloadRow(c, 'queued', byTitle('The Pragmatic'), { sub: 'Next.' })}
        ${downloadRow(c, 'queued', byTitle('Kubernetes'), { sub: 'Waiting for the two before it.' })}
        ${quietNotice(c, 'info', 'One at a time, so a queue of ten does not make the one you are waiting for the slowest. Change that under <b style="color:' + c.fg + '">Downloads settings</b>.')}
      </div>`,
    }),
  });
}

/**
 * The actions on one downloaded document.
 *
 * An `Actionsheet`, not a `BottomSheet`. gluestack's is built on
 * `@gorhom/bottom-sheet`, which this project does not install — and this list
 * is seven rows that will never be a hundred, so it has no height that is the
 * reader's data and needs no snap points.
 *
 * **Remove download and Delete are not the same row and never share one.** One
 * frees space and costs a tap to undo; the other destroys the only copy. They
 * are separated by a rule and only one of them is ever in the destructive
 * colour.
 */
function downloadActions() {
  const c = DARK;
  const doc = byTitle('Designing Data');
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  <div style="position:absolute;inset:0;background:${c.bg};opacity:.45"></div>
  <div style="position:absolute;inset:0;background:rgba(0,0,0,.55)"></div>
  ${readerSheet(c, {
    glyph: 'cloudCheck',
    title: doc.t,
    subtitle: 'On this device · 12.4 MB · checked 2 days ago',
    body: `<div style="padding-top:4px">
      ${readerRow(c, { glyph: 'bookOpen', label: 'Open' })}
      ${readerRow(c, { glyph: 'pause', label: 'Pause download', note: 'Keeps what has arrived. Resuming picks up where it stopped.' })}
      ${readerRow(c, { glyph: 'refresh', label: 'Download again', note: 'Replaces the copy here with the one in your account.' })}
      ${readerRow(c, { glyph: 'fileCheck', label: 'Check this file', note: 'Reads it back and compares it against what your account holds.' })}
      <div style="height:1px;margin:6px ${PAD}px;background:${c.hairline}"></div>
      ${readerRow(c, { glyph: 'folderPlus', label: 'Add to a collection' })}
      ${readerRow(c, { glyph: 'heart', label: 'Favourite' })}
      ${readerRow(c, { glyph: 'share2', label: 'Share' })}
      <div style="height:1px;margin:6px ${PAD}px;background:${c.hairline}"></div>
      <div style="min-height:52px;display:flex;align-items:center;gap:14px;padding:9px ${PAD}px">
        ${icon('trash', 19, c.destructive)}
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;color:${c.destructive}">Remove from this device</div>
          <div style="margin-top:2px;font-size:12px;line-height:16px;color:${c.fgSubtle}" class="pretty">Frees 12.4&nbsp;MB. It stays in your account.</div>
        </div>
      </div>
    </div>`,
  })}
</div>`,
  });
}

/**
 * The two ways a download can end badly, and what each one kept.
 *
 * The answer is "nothing", both times, and saying so is the point. A file that
 * arrived truncated is deleted rather than left under the name the scan reads
 * as "this document is on this device" — a reader who opens a broken PDF with
 * no explanation has been told a lie by a filename.
 */
function downloadsFailed() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: downloadsPage(c, {
      subtitle: '2 need attention',
      active: 'problems',
      body: `<div style="flex:1;overflow:hidden">
        ${downloadRow(c, 'corrupt', byTitle('Kubernetes'), { detail: '7.2 MB', sub: "Didn't arrive whole — the file was the wrong size. Nothing was kept." })}
        ${downloadRow(c, 'failed', byTitle('Sapiens'), { detail: '6.8 MB', sub: 'Eight attempts over half an hour. Your account could not be reached.' })}
        ${quietNotice(c, 'shieldAlert', 'A download is checked before it counts as here: the size your account recorded, the first five bytes reading <b style="color:' + c.fg + '">%PDF-</b>, and the file’s own hash. A file that fails any of the three is deleted rather than left looking ready.', c.fgSubtle)}
        <div style="padding:4px ${PAD}px 0">${primaryButton(c, 'Try both again', { glyph: 'refresh' })}</div>
      </div>`,
    }),
  });
}

/**
 * The copy in the account moved on.
 *
 * This is the state the first design did not have, and its absence was a quiet
 * wrong answer: a document replaced on another device left this phone holding
 * an older file that opened perfectly and was not the document any more.
 * `outdated` is not an error — the local file is still readable, and saying so
 * is what stops this reading as a failure. It is an offer.
 */
function downloadsOutdated() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: downloadsPage(c, {
      subtitle: '6 on this device · 1 behind',
      active: 'all',
      body: `<div style="flex:1;overflow:hidden">
        ${downloadRow(c, 'outdated', byTitle('The Pragmatic'), { detail: '3.3 MB', sub: 'Replaced in your account on 4 September. The copy here still opens.' })}
        <div style="display:flex;gap:10px;padding:2px ${PAD}px 16px">
          <div style="flex:1">${primaryButton(c, 'Download the new one', { glyph: 'cloudDown' })}</div>
          <div style="flex:1">${quietButton(c, 'Keep this one')}</div>
        </div>
        <div style="height:1px;background:${c.hairline}"></div>
        ${downloadRow(c, 'available', byTitle('Thinking,'))}
        ${downloadRow(c, 'available', byTitle('Convex Backend'))}
        ${downloadRow(c, 'available', byTitle('Domain-Driven'))}
      </div>`,
    }),
  });
}

/**
 * Held, and by which of the two rules.
 *
 * Wi-Fi only is a switch somebody set; the cellular ceiling is a number. They
 * are different sentences because they have different answers — one is turned
 * off, the other is agreed to once for this document. Both say what is
 * happening rather than sitting silent, which is what the previous behaviour
 * did: a refused download was a toast that had already gone by the time
 * anybody wondered why nothing was moving.
 */
function downloadsHeld() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: downloadsPage(c, {
      subtitle: '3 held · on mobile data',
      active: 'waiting',
      body: `<div style="flex:1;overflow:hidden">
        ${quietNotice(c, 'wifiOff', 'You are on mobile data. Three downloads are held until Wi‑Fi.', c.warn)}
        ${downloadRow(c, 'held', byTitle('Designing Data'), { detail: '12.4 MB' })}
        ${downloadRow(c, 'held', byTitle('Sapiens'), { detail: '6.8 MB', sub: 'Over the 25 MB mobile-data ceiling you set.' })}
        ${downloadRow(c, 'held', byTitle('Kubernetes'), { detail: '7.2 MB' })}
        <div style="display:flex;gap:10px;padding:8px ${PAD}px 16px">
          <div style="flex:1">${quietButton(c, 'Download anyway', { glyph: 'cloudDown' })}</div>
          <div style="flex:1">${quietButton(c, 'Settings', { glyph: 'sliders' })}</div>
        </div>
        ${quietNotice(c, 'info', 'They start on their own the moment you are on Wi‑Fi. Nothing has to be tapped again.')}
      </div>`,
    }),
  });
}

/**
 * Download settings — everything this handset decides for itself.
 *
 * **Every value here stays on the device.** `preferences-store.ts` says why in
 * one sentence: syncing a phone's answer about its data plan to a tablet that
 * has none is applying an answer to a question that device never asked. The
 * account settings screens are next door and hold the opposite kind of thing —
 * who may find this reader, what they want to be told — which follow them to a
 * new phone and should.
 */
function downloadSettings(part) {
  const c = DARK;
  const top = part === 'top';
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">${sharePage(c, {
      glyph: 'sliders',
      title: 'Downloads',
      subtitle: 'What this device pulls down, and keeps',
      body: top
        ? `<div style="flex:1;overflow:hidden">
        ${settingsLabel(c, 'Network', 14)}
        ${settingsSwitch(c, { label: 'Download over Wi‑Fi only', note: 'Holds full documents until you are on Wi‑Fi. Reading what is already here is unaffected.', on: true })}
        ${settingsPick(c, { label: 'Ask on mobile data above', note: 'Anything larger waits for you to agree to it, once, for that document.', value: '25 MB' })}
        ${settingsSwitch(c, { label: 'Resume when Wi‑Fi returns', note: 'Held downloads start on their own rather than waiting to be tapped again.', on: true })}
        <div style="height:1px;margin:8px ${PAD}px 0;background:${c.hairline}"></div>
        ${settingsLabel(c, 'Keep offline automatically')}
        ${settingsSwitch(c, { label: 'Documents shared with me', note: 'Fetches a shared PDF when you accept it, so it is there before you need it.', on: false })}
        ${settingsSwitch(c, { label: 'Favourites', note: 'Anything you have hearted stays on this device.', on: true })}
        ${settingsPick(c, { label: 'Recently opened', note: 'The last few you read are kept here whatever else happens.', value: '5 documents' })}
        ${quietNotice(c, 'info', 'Automatic downloads obey everything above them: they wait for Wi‑Fi, they respect the ceiling, and they never start when the disk is nearly full.')}
      </div>`
        : `<div style="flex:1;overflow:hidden">
        ${settingsLabel(c, 'Storage', 14)}
        ${settingsPick(c, { label: 'Keep at most', note: '1.4 GB of 2 GB used. Downloads stop at the ceiling rather than filling the phone.', value: '2 GB' })}
        ${settingsPick(c, { label: 'When full, remove', note: 'Only documents your account still holds. Never the only copy of anything.', value: 'Least recently opened' })}
        ${settingsSwitch(c, { label: 'Never remove finished books', note: 'A book you marked finished stays until you remove it yourself.', on: false })}
        ${settingsPick(c, { label: 'What is on this device', note: 'The downloaded documents themselves, largest first.', value: '11' })}
        <div style="height:1px;margin:8px ${PAD}px 0;background:${c.hairline}"></div>
        ${settingsLabel(c, 'Integrity')}
        ${settingsPick(c, { label: 'Check a file before opening', note: 'Reads it back and compares it against what your account holds.', value: 'Weekly' })}
        ${settingsPick(c, { label: 'Check every download now', note: '11 documents, about 20 seconds.', value: '' })}
        <div style="height:1px;margin:8px ${PAD}px 0;background:${c.hairline}"></div>
        ${settingsLabel(c, 'Queue')}
        ${settingsPick(c, { label: 'At once', note: 'More is not faster on one connection; it only makes the first one slower.', value: '1' })}
        ${settingsSwitch(c, { label: 'Retry on its own', note: 'Eight attempts, spacing out. Then it waits for you.', on: true })}
        ${quietNotice(c, 'phone', 'All of this is about <b style="color:' + c.fg + '">this</b> handset and stays on it. Another device you sign in to answers these for itself.')}
      </div>`,
    })}</div>`,
  });
}

/**
 * The storage ceiling, and the one thing it must never do.
 *
 * A cap that could delete the only copy of a document would be a cap that loses
 * somebody's work to a number they set six months ago. So eviction is only ever
 * offered documents the account still holds, and the sheet says which of the
 * two kinds it is looking at before anything is removed.
 */
function downloadStorageCap() {
  const c = DARK;
  const pick = (label, note, on) =>
    `<div style="display:flex;align-items:center;gap:14px;padding:11px ${PAD}px">
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;color:${c.fg}">${label}</div>
        ${note ? `<div style="margin-top:2px;font-size:12px;color:${c.fgSubtle}">${note}</div>` : ''}
      </div>
      ${on ? icon('check', 18, c.primary, 2) : ''}
    </div>`;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  <div style="position:absolute;inset:0;background:${c.bg};opacity:.45"></div>
  <div style="position:absolute;inset:0;background:rgba(0,0,0,.55)"></div>
  ${readerSheet(c, {
    glyph: 'hardDrive',
    title: 'Keep at most',
    subtitle: '1.4 GB used now · 8.2 GB free on this device',
    body: `<div style="padding-top:4px">
      ${pick('No limit', 'Downloads stop only when the phone is full.', false)}
      ${pick('1 GB', 'About 80 books at this library’s average size.', false)}
      ${pick('2 GB', '', true)}
      ${pick('5 GB', '', false)}
      ${pick('10 GB', '', false)}
      <div style="height:1px;margin:6px ${PAD}px;background:${c.hairline}"></div>
      ${quietNotice(c, 'shieldCheck', 'At the ceiling, the least recently opened document <b style="color:' + c.fg + '">that your account still holds</b> is removed. A document that exists only on this phone is never removed to make room — it would be the only copy, and no number you set should be able to destroy one.', c.fgSubtle)}
    </div>`,
  })}
</div>`,
  });
}

/**
 * Refused for space, with the way out on the same screen.
 *
 * `space.ts` has always refused an import with "remove a download or two and
 * try again" and never said which ones were large. This is that sentence
 * finished: the three biggest, what removing each costs, and how much it frees.
 */
function downloadNoSpace() {
  const c = DARK;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: downloadsPage(c, {
      subtitle: '412 MB free',
      active: 'device',
      body: `<div style="flex:1;overflow:hidden">
        ${quietNotice(c, 'alert', 'There is not enough room for <b style="color:' + c.fg + '">Designing Data-Intensive Applications</b> (12.4 MB). Removing one of these makes room, and none of them are lost.', c.destructive)}
        ${storageRow(c, { title: 'The Complete Works — scanned, 1,340 pages', detail: 'On this phone only. Removing it deletes it for good.', size: '1.9 GB', recoverable: false })}
        ${storageRow(c, { title: 'Designing Data-Intensive Applications', detail: 'In your account. Removing it here downloads again in a tap.', size: '12.4 MB', recoverable: true })}
        ${storageRow(c, { title: 'Sapiens: A Brief History of Humankind', detail: 'In your account. Removing it here downloads again in a tap.', size: '6.8 MB', recoverable: true })}
        <div style="padding:16px ${PAD}px">${quietButton(c, 'What is on this device', { glyph: 'hardDrive' })}</div>
      </div>`,
    }),
  });
}

/**
 * The confirmation, in both of the shapes it takes.
 *
 * The same gesture has two consequences and the dialog is the only place a
 * reader finds out which one they are about to get. `device-storage.tsx` wrote
 * these two sentences; this board is here so the difference between them is
 * something somebody can see side by side rather than reason about.
 */
function downloadRemoveConfirm() {
  const c = DARK;
  const panel = (title, body, label, tone) =>
    `<div style="border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border};padding:16px;background:${c.elevated}">
      <div style="font-size:16px;font-weight:700;letter-spacing:-.012em;color:${c.fg}">${title}</div>
      <div style="margin-top:8px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">${body}</div>
      <div style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px">
        <div style="height:34px;padding:0 14px;display:flex;align-items:center;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border}"><span style="font-size:13px;color:${c.fg}">Cancel</span></div>
        <div style="height:34px;padding:0 14px;display:flex;align-items:center;border-radius:${R};background:${tone}"><span style="font-size:13px;font-weight:500;color:${c.onPrimary}">${label}</span></div>
      </div>
    </div>`;
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="height:844px;background:${c.bg};padding:44px ${PAD}px;display:flex;flex-direction:column;gap:20px">
  <div>
    <div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">One gesture, two consequences</div>
    <div style="margin-top:8px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">Which sheet a reader gets is decided by one fact — whether the account still holds the file — and it is the only thing standing between "free some space" and "lose it".</div>
  </div>
  ${panel(
    'Remove from this device?',
    '<b style="color:' + c.fg + '">Designing Data-Intensive Applications</b> stays in your account. It will need downloading again to read it here, and reading it offline will not be possible until you do.',
    'Remove',
    c.primary,
  )}
  ${panel(
    'This is the only copy',
    '<b style="color:' + c.fg + '">Lease Agreement — 14 Kilimani Road</b> is not in your account, so removing it here deletes it for good. Sync it first if you want to keep it.',
    'Delete',
    c.destructive,
  )}
  ${quietNotice(c, 'shieldCheck', 'Removing a download and deleting a document are never the same row, never adjacent, and only one of them is ever in the destructive colour.')}
</div>`,
  });
}

/**
 * All eleven states on one board, which is the thing the code could not say.
 *
 * A state machine that lives only in a TypeScript union is a state machine
 * nobody reviews. Drawn out, two things become obvious that were not: `held`
 * and `queued` are different waits and want different sentences, and `outdated`
 * is the only state on this chart that is not a problem.
 */
function downloadStates() {
  const c = DARK;
  const s = DL(c);
  const order = ['missing', 'queued', 'held', 'downloading', 'paused', 'verifying', 'available', 'outdated', 'corrupt', 'failed', 'removing'];
  const does = {
    missing: 'Download',
    queued: 'Move to front · Cancel',
    held: 'Download anyway · Settings',
    downloading: 'Pause · Cancel',
    paused: 'Resume · Cancel',
    verifying: '—',
    available: 'Open · Check · Remove',
    outdated: 'Download again · Keep this one',
    corrupt: 'Try again',
    failed: 'Try again',
    removing: '—',
  };
  const row = (k) =>
    `<div style="display:flex;align-items:flex-start;gap:14px;padding:12px 0;border-bottom:1px solid ${c.hairline}">
      <div style="width:20px;margin-top:1px">${icon(s[k].glyph, 16, s[k].tone, 2)}</div>
      <div style="width:190px;flex:0 0 auto">
        <div style="font-size:13px;font-weight:600;color:${s[k].tone}">${s[k].label}</div>
        <div style="margin-top:3px;font-size:11px;font-family:ui-monospace,Menlo,monospace;color:${c.fgDisabled}">${k}</div>
      </div>
      <div style="flex:1;min-width:0;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${s[k].line ?? 'Progress and the exact byte count take the place of a sentence.'}</div>
      <div style="width:230px;flex:0 0 auto;font-size:12px;line-height:17px;color:${c.fgMuted}">${does[k]}</div>
    </div>`;

  return dc({
    w: 1024, h: 760, bg: c.bg,
    body: `<div style="padding:36px 40px">
  <div style="font-size:22px;font-weight:700;letter-spacing:-.02em;color:${c.fg}">Where a file is, and what it is waiting for</div>
  <div style="margin-top:8px;max-width:700px;font-size:13px;line-height:20px;color:${c.fgMuted}" class="pretty">Four of these did not exist. A download held for Wi‑Fi, one queued behind two others, one paused halfway and one that simply failed were all <b style="color:${c.fg}">missing</b> on the tile — the same word as a document nobody had ever asked for. This is the vocabulary that fixes that, and no state on it is reachable without a writer.</div>

  <div style="margin-top:26px;display:flex;gap:14px;padding-bottom:10px;border-bottom:1px solid ${c.border}">
    <div style="width:34px"></div>
    <div style="width:190px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">State</div>
    <div style="flex:1;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">What the row says</div>
    <div style="width:230px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">What it offers</div>
  </div>
  ${order.map(row).join('')}

  <div style="margin-top:22px;font-size:12px;line-height:18px;color:${c.fgSubtle};max-width:860px" class="pretty"><b style="color:${c.fg}">Nothing on this chart exists on the server.</b> <b style="color:${c.fg}">documentFiles</b> is the one table with no counterpart in the account, and deliberately: only the phone can honestly say whether a file is on it and whether it opens. A field on the server reading "downloaded" would be a stale flag on the one screen whose entire job is to answer that question.</div>
</div>`,
  });
}

/**
 * The row, taken apart.
 *
 * Six things and their order, because the order is the argument: the state
 * glyph is first so a column of them can be scanned without reading a word, and
 * the size is last and right-aligned so a column of numbers lines up. The
 * progress rule is under the text rather than beside it — beside it, a long
 * title shortens the bar, and the bar’s length would then mean two things.
 */
function downloadRowAnatomy() {
  const c = DARK;
  const note = (n, title, body) =>
    `<div style="display:flex;gap:12px;padding:9px 0">
      <div style="width:20px;height:20px;border-radius:9999px;background:${c.primaryTint};display:flex;align-items:center;justify-content:center;flex:0 0 auto"><span style="font-size:11px;font-weight:600;color:${c.primary}">${n}</span></div>
      <div style="flex:1"><div style="font-size:13px;font-weight:600;color:${c.fg}">${title}</div><div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${body}</div></div>
    </div>`;
  return dc({
    w: 900, h: 560, bg: c.bg,
    body: `<div style="padding:36px 40px">
  <div style="font-size:22px;font-weight:700;letter-spacing:-.02em;color:${c.fg}">The download row</div>
  <div style="margin-top:24px;display:flex;gap:40px;align-items:flex-start">
    <div style="width:390px;flex:0 0 auto;border-radius:${R};box-shadow:inset 0 0 0 1px ${c.border};overflow:hidden">
      ${downloadRow(c, 'downloading', byTitle('Designing Data'), { pct: 37, detail: '4.6 MB of 12.4 MB', sub: 'Downloading · about 40 seconds left' })}
      ${downloadRow(c, 'available', byTitle('Thinking,'))}
      ${downloadRow(c, 'outdated', byTitle('The Pragmatic'))}
    </div>
    <div style="flex:1;min-width:0">
      ${note(1, 'The state glyph', 'First, and the only coloured thing in the row. Eleven states, eleven glyphs, and a column of them reads without a single word being parsed.')}
      ${note(2, 'The title', 'Two lines, clamped. Never truncated to one — a library is full of documents that differ only in their last three words.')}
      ${note(3, 'One sentence of state', 'In the state’s own colour when that colour means something, and <b style="color:' + c.fg + '">fg-subtle</b> when it does not. Quiet states do not get to shout.')}
      ${note(4, 'The exact bytes', 'Tabular numerals, right-aligned. <b style="color:' + c.fg + '">4.6 MB of 12.4 MB</b>, not 37% — a percentage cannot be compared against the free space on the phone, and that is the comparison somebody is actually making.')}
      ${note(5, 'Two pixels of progress', 'The tile’s bar, not the vendored <b style="color:' + c.fg + '">Progress</b> component — which is eight pixels on a tinted track and is used nowhere in this application. Two bars for one transfer on two screens would be one bar too many.')}
      ${note(6, 'The overflow', 'Everything else. The row itself opens the document; nothing destructive is ever one stray tap away.')}
    </div>
  </div>
</div>`,
  });
}

/**
 * The pipeline, and the column headed Never.
 *
 * Written down because the order of these steps is the whole security argument
 * and it is not recoverable from reading any one file. The thing worth staring
 * at is the third column: the two facts that never leave the device, and the
 * one credential that never outlives five minutes.
 */
function downloadModel() {
  const c = DARK;
  const box = (title, lines, { tone = null, w = 232 } = {}) =>
    `<div style="width:${w}px;border-radius:${R};padding:14px 16px;box-shadow:inset 0 0 0 1px ${tone === 'danger' ? c.destructive : tone === 'ok' ? c.ok : c.border}">
       <div style="font-size:13px;font-weight:600;letter-spacing:-.008em;color:${tone === 'danger' ? c.destructive : tone === 'ok' ? c.ok : c.fg}">${title}</div>
       ${lines.map((l) => `<div style="margin-top:7px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${l}</div>`).join('')}
     </div>`;
  const arrow = () => `<div style="display:flex;align-items:center;justify-content:center;width:38px">${icon('arrowRight', 17, c.fgMuted, 2)}</div>`;
  const label = (t) => `<div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle};margin-bottom:12px">${t}</div>`;

  return dc({
    w: 900, h: 760, bg: c.bg,
    body: `<div style="padding:36px 40px">
  <div style="font-size:22px;font-weight:700;letter-spacing:-.02em;color:${c.fg}">How a PDF gets onto this phone</div>
  <div style="margin-top:8px;max-width:660px;font-size:13px;line-height:20px;color:${c.fgMuted}" class="pretty">Six steps, and the order of them is the argument. A file that finished downloading is not the same fact as a document that opens, so the move into place happens after the checks and never before.</div>

  <div style="margin-top:30px">${label('The path the bytes take')}
    <div style="display:flex;align-items:stretch">
      ${box('Authorised first', ['<b style="color:' + c.fg + '">library.downloadUrl</b> is a mutation, not a query — a cached URL outliving its signature is a download that fails for no visible reason. Ownership is checked before a URL exists.'])}
      ${arrow()}
      ${box('Into a temp name', ['<b style="color:' + c.fg + '">&lt;id&gt;.download</b>, beside where it is going. A half-arrived file must never sit under the name the scan reads as “this is here”.'])}
      ${arrow()}
      ${box('Checked three ways', ['The size the account recorded. The first five bytes reading <b style="color:' + c.fg + '">%PDF-</b>. The file’s hash — the whole thing under 32 MB, head and tail above it.'])}
    </div>
    <div style="display:flex;align-items:stretch;margin-top:16px">
      ${box('Moved, atomically', ['One rename. There is no moment at which a partial file is visible under the real name, on any platform.'])}
      ${arrow()}
      ${box('Recorded locally', ['<b style="color:' + c.fg + '">documentFiles</b> goes to <b style="color:' + c.fg + '">available</b> with the verified hash and the moment it was checked. This row is the only truth about offline availability.'])}
      ${arrow()}
      ${box('And that is the end', ['Nothing is sent. Opening it afterwards touches no network, resolves no URL and waits on no subscription.'], { tone: 'ok' })}
    </div>
  </div>

  <div style="margin-top:32px">${label('Never')}
    <div style="display:flex;align-items:stretch;gap:18px">
      ${box('A path on the wire', ['<b style="color:' + c.fg + '">/data/user/0/…</b> means something on exactly one device. It is never an argument, never a column, never a log line.'], { tone: 'danger', w: 250 })}
      ${box('A field saying “downloaded”', ['The account has no idea which devices hold which files, and should not. It would be a stale flag on the one screen whose job is to answer that.'], { tone: 'danger', w: 250 })}
      ${box('A URL that outlives its use', ['Five minutes, signed, minted after the ownership check. A paused download stores one only inside the encrypted database, and clears it the moment the transfer settles.'], { tone: 'danger', w: 250 })}
    </div>
  </div>

  <div style="margin-top:30px;padding-top:18px;border-top:1px solid ${c.hairline};font-size:12px;line-height:18px;color:${c.fgSubtle};max-width:820px" class="pretty"><b style="color:${c.fg}">The filename is the document id, and that is a security control rather than a convention.</b> A PDF the reader imported as <b style="color:${c.fg}">../../../shared_prefs/auth.xml</b> is a title and nothing else — traversal is closed by construction rather than by sanitising a hostile string and hoping the sanitiser is complete.</div>
</div>`,
  });
}

/* ------------------------ the intelligence surfaces --------------- */

/**
 * Where a document's index can be, and what each state offers.
 *
 * Eleven, and the shape is `DL`'s on purpose: a reader who has learned what the
 * Downloads screen's glyph column means has learned this one too. The tones are
 * the same five and carry the same meaning — `warn` is waiting on a condition
 * the reader can change, `destructive` is spent, `ok` is done, and everything
 * quiet is `fgSubtle` so the two rows that need attention are not buried under
 * ninety-eight green ones.
 */
const IX = (c) => ({
  none: { glyph: 'scanText', tone: c.fgMuted, label: 'Not indexed', line: 'Findable by its words. Not yet by what it means.' },
  waiting: { glyph: 'cloudUp', tone: c.fgSubtle, label: 'Waiting for its text', line: 'The account has not finished reading this one yet.' },
  queued: { glyph: 'clock', tone: c.fgSubtle, label: 'Queued', line: 'Waiting for the document before it.' },
  model: { glyph: 'cpu', tone: c.warn, label: 'Needs the model', line: 'The search model has not been downloaded to this phone.' },
  wifi: { glyph: 'wifiOff', tone: c.warn, label: 'Waiting for Wi-Fi', line: 'Held because indexing is set to Wi-Fi only.' },
  cap: { glyph: 'hardDrive', tone: c.warn, label: 'At the index ceiling', line: 'Raise it, or let an older index be dropped.' },
  chunking: { glyph: 'layers', tone: c.primary, label: 'Reading the pages', line: null },
  embedding: { glyph: 'sparkles', tone: c.primary, label: 'Preparing search', line: null },
  ready: { glyph: 'fileCheck', tone: c.ok, label: 'Searchable by meaning', line: 'Works with no connection.' },
  stale: { glyph: 'refresh', tone: c.warn, label: 'Built by an older model', line: 'Still searchable. Rebuilding improves what it finds.' },
  failed: { glyph: 'circleSlash', tone: c.destructive, label: "Couldn't be indexed", line: 'Eight attempts. Its words are still searchable.' },
});

/**
 * The transcript, in a design system with no bubbles in it.
 *
 * Every chat interface reaches for two coloured capsules, and this one cannot:
 * `docs/design.md` has no cards, one accent, and a 6px radius everywhere. So a
 * turn is a role label over a paragraph — the same `settingsLabel` typography
 * every section heading in the app already uses — separated by whitespace
 * rather than by a filled shape. It reads as a document, which is the right
 * register for something sitting on top of one.
 */
function askTurn(c, { role, body, sources = null, streaming = false }) {
  const you = role === 'you';
  return `<div style="padding:14px ${PAD}px 0">
    <div style="display:flex;align-items:center;gap:6px">
      ${you ? '' : icon('sparkles', 12, c.primary, 2)}
      <span style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${you ? c.fgSubtle : c.primary}">${you ? 'You' : 'Pidom'}</span>
    </div>
    <div style="margin-top:6px;font-size:${you ? 15 : 14}px;line-height:${you ? 21 : 21}px;color:${you ? c.fg : c.fg}" class="pretty">${body}${streaming ? `<span style="display:inline-block;width:7px;height:14px;margin-left:2px;vertical-align:-2px;background:${c.primary};border-radius:1px"></span>` : ''}</div>
    ${sources === null ? '' : `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:11px">${sources
      .map((p) => `<div style="display:flex;align-items:center;gap:4px;padding:5px 9px;border-radius:${R};background:${c.primaryTint}">${icon('quote', 11, c.primary, 2)}<span style="font-size:12px;color:${c.primary}" class="tnum">page ${p}</span></div>`)
      .join('')}</div>`}
  </div>`;
}

/**
 * Ask, full screen.
 *
 * It was a sheet at a fixed 70%, and that was living with the problem rather
 * than solving it. `docs/design.md` draws the line: a control must not hang off
 * a box whose height is the reader's data, which is why the navigator became a
 * route. A transcript is that data and a composer is that control, so this is a
 * route too — the answer this document already gives for every surface that
 * holds a list.
 *
 * The chrome is `sharePage`'s, because a sixth slightly different header would
 * be a sixth application. What sits under it is gluestack's Chat AI, vendored
 * and audited: its `PromptInput` is `absolute bottom-4` and rides the keyboard
 * on a shared value, which is a layout that wants a whole screen and was
 * fighting the sheet for its last few hundred pixels.
 */
function askScreen(c, { subtitle, body, composer = true, placeholder = 'Ask about this document', trailing = '' }) {
  return `<div style="position:absolute;inset:0;background:${c.bg};display:flex;flex-direction:column">
    <div style="display:flex;align-items:center;padding:44px ${PAD}px 12px;flex:0 0 auto">
      ${icon('arrowLeft', 22, c.fg, 2)}
      <div style="margin-left:10px;flex:0 0 auto">${icon('sparkles', 18, c.fgMuted)}</div>
      <div style="flex:1;min-width:0;margin-left:10px">
        <div style="font-size:15px;font-weight:600;letter-spacing:-.01em;color:${c.fg}">Ask</div>
        <div style="margin-top:2px;font-size:12px;color:${c.fgSubtle};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${subtitle}</div>
      </div>
      ${trailing}
    </div>
    <div style="height:1px;background:${c.hairline};flex:0 0 auto"></div>

    <div style="flex:1;min-height:0;overflow:hidden">${body}</div>

    ${composer
      ? `<div style="flex:0 0 auto;padding:0 ${PAD}px 28px">
           <div style="border-radius:22px;background:${c.hover};padding:10px 12px">
             <div style="font-size:16px;color:${c.fgSubtle};padding:4px 4px 10px">${placeholder}</div>
             <div style="display:flex;align-items:center;justify-content:space-between">
               <div style="display:flex;align-items:center;gap:8px">
                 <div style="width:34px;height:34px;border-radius:9999px;background:${c.primaryTint};display:flex;align-items:center;justify-content:center"><span style="font-size:20px;color:${c.primary}">+</span></div>
                 <div style="height:34px;display:flex;align-items:center;padding:0 12px;border-radius:9999px;background:${c.primaryTint}"><span style="font-size:13px;color:${c.primary}">gpt-4o-mini</span></div>
               </div>
               <div style="width:36px;height:36px;border-radius:9999px;background:${c.primary};display:flex;align-items:center;justify-content:center"><span style="font-size:17px;color:${c.onPrimary}">↑</span></div>
             </div>
           </div>
         </div>`
      : '<div style="height:28px;flex:0 0 auto"></div>'}
  </div>`;
}

/**
 * The reader, with the one control this feature adds.
 *
 * Not a seventh glyph in the top bar. `reader-chrome.tsx` says in as many words
 * that the bar carries six already and a seventh is the one that finally turns
 * the title into an ellipsis, so Ask sits on the bottom bar beside the page
 * count, where there has always been room and where the reader's thumb already
 * is. It is the only labelled control in either bar, because it is the only one
 * whose glyph does not say what it does.
 */
function askClosed() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  return dc({
    w: 390, h: 844, bg: PAPER.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${PAPER.bg}">
  <div style="padding:116px 40px 0">${readerPage({ top: 0, side: 0 })}</div>
  ${folio(142)}
  ${readerTop(c, { title: doc.t })}

  <div style="position:absolute;left:0;right:0;bottom:0;height:88px;background:${c.bg};box-shadow:0 -1px 0 ${c.hairline}">
    <div style="padding:16px ${PAD}px 0">
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:12px;color:${c.fgMuted}" class="tnum">142 of ${doc.p}</span>
        <div style="flex:1"></div>
        <div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:${R};background:${c.primaryTint}">
          ${icon('sparkles', 14, c.primary, 2)}<span style="font-size:12px;font-weight:500;color:${c.primary}">Ask</span>
        </div>
        ${icon('settings', 19, c.fgMuted, 2)}
      </div>
      <div style="margin-top:10px;height:2px;border-radius:${R};background:${c.border}">
        <div style="width:28%;height:100%;border-radius:${R};background:${c.primary}"></div>
      </div>
    </div>
  </div>
</div>`,
  });
}

/** A question, answered from four pages of a five-hundred-page book. */
function ask() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${askScreen(c, {
    subtitle: doc.t,
    trailing: `<div style="display:flex;align-items:center;gap:5px;padding:4px 8px;border-radius:${R};background:${c.surface}">${icon('clock', 11, c.fgSubtle, 2)}<span style="font-size:11px;color:${c.fgSubtle}">28 days</span></div>`,
    body: `
      ${askTurn(c, { role: 'you', body: 'Why does he think small samples mislead people who should know better?' })}
      ${askTurn(c, {
        role: 'pidom',
        body: 'Because the intuition that judges a sample never asks how large it is. Kahneman’s argument is that statisticians reading their own results fall for it too — they trust a result from twelve subjects with the confidence a result from twelve hundred would earn, since the mind evaluates <i>how convincing the story is</i> rather than <i>how much evidence produced it</i>. Small samples produce more extreme results, so they tell better stories.',
        sources: [152, 153, 156],
      })}
      <div style="padding:16px ${PAD}px 0;display:flex;align-items:center;gap:8px">
        ${icon('highlighter', 14, c.fgSubtle, 2)}<span style="font-size:12px;color:${c.fgSubtle}">Keep this answer</span>
      </div>`,
  })}
</div>`,
  });
}

/**
 * Where the answer came from, which is not a footnote.
 *
 * The passages are the product. A model given four pages of a book and asked to
 * summarise them is doing a small, checkable job, and the only way a reader can
 * check it is to be shown the four pages and taken to them in one tap. So the
 * citations expand into the passages themselves, each one a row that goes to
 * the page — `search-inside-screen.tsx`'s result row, in a sheet.
 */
function askSources() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  const source = (page, text, why) =>
    `<div style="padding:12px ${PAD}px;border-bottom:1px solid ${c.hairline}">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}" class="tnum">page ${page}</span>
        <div style="flex:1"></div>
        <span style="font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:${why === 'meaning' ? c.primary : c.fgSubtle}">${why}</span>
        ${icon('chevronRight', 14, c.fgSubtle, 2)}
      </div>
      <div style="margin-top:5px;font-size:12px;line-height:18px;color:${c.fgMuted}" class="c2">${text}</div>
    </div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${askScreen(c, {
    subtitle: doc.t,
    trailing: icon('close', 18, c.fgSubtle, 2),
    body: `
      <div style="padding:14px ${PAD}px 10px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">Four pages went to the model</div>
      ${source(152, 'The phenomenon we were studying is so common and so important in the everyday world that you should know its name: it is an anchoring effect, and it survives being pointed out.', 'meaning')}
      ${source(153, 'Any number that you are asked to consider as a possible solution to an estimation problem will induce an effect of the same kind.', 'meaning')}
      ${source(156, 'Our thoughts and our behaviour are influenced by contexts we are not aware of, and by samples far too small to carry the conclusions drawn from them.', 'both')}
      ${source(31, 'A random event, by definition, does not lend itself to explanation, but collections of random events do behave in a highly regular fashion.', 'words')}
      <div style="display:flex;align-items:flex-start;gap:10px;padding:14px ${PAD}px">
        ${icon('lock', 15, c.fgSubtle, 2)}
        <div style="flex:1;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">This phone sent four page numbers. Your account read those four pages and sent them on. Nothing else in the book left it.</div>
      </div>`,
    composer: false,
  })}
</div>`,
  });
}

/**
 * A passage, carried in as the question's context.
 *
 * `selection-bar.tsx` had three buttons and now has four, which is the whole
 * change: the selection is already bounded at `PAGE_TEXT_MAX` and already never
 * logged, so Ask inherits both rules rather than restating them. The quoted
 * block at the top of the sheet is the reader's own selection, shown back so
 * there is no doubt what the answer is about.
 */
function askFromSelection() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${askScreen(c, {
    subtitle: doc.t,
    placeholder: 'What would you like to know?',
    body: `
      <div style="margin:14px ${PAD}px 0;padding:12px 14px;border-radius:${R};background:${c.surface};box-shadow:inset 0 0 0 1px ${c.hairline}">
        <div style="display:flex;align-items:center;gap:6px">
          ${icon('quote', 12, c.fgSubtle, 2)}
          <span style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}" class="tnum">page 142 · selected</span>
        </div>
        <div style="margin-top:7px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="c5">“The exaggerated faith of researchers in what can be learned from a few observations is closely related to the halo effect, the sense we often get that we know and understand a person about whom we actually know very little.”</div>
      </div>
      <div style="padding:16px ${PAD}px 0;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">Or start with</div>
      ${['Explain this in plain language', 'What is the halo effect?', 'Where else does he argue this?']
        .map((q) => `<div style="display:flex;align-items:center;gap:12px;padding:11px ${PAD}px">${icon('sparkles', 15, c.fgMuted, 2)}<span style="flex:1;font-size:14px;color:${c.fg}">${q}</span>${icon('chevronRight', 14, c.fgSubtle, 2)}</div>`)
        .join('')}`,
  })}
</div>`,
  });
}

/**
 * With no connection, and the honest answer.
 *
 * The index is on the phone and the model that writes prose is not, so the half
 * that still works runs and says which half it is. This is the board that
 * exists to refuse the obvious shortcut: a greyed-out send button teaches a
 * reader nothing, and an apology teaches them less than four passages they can
 * open. Finding the right pages was always the hard part; the sentences on top
 * of them are what needs a network.
 */
function askOffline() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  const passage = (page, text) =>
    `<div style="padding:12px ${PAD}px;border-bottom:1px solid ${c.hairline}">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}" class="tnum">page ${page}</span>
        <div style="flex:1"></div>
        ${icon('chevronRight', 14, c.fgSubtle, 2)}
      </div>
      <div style="margin-top:5px;font-size:12px;line-height:18px;color:${c.fgMuted}" class="c2">${text}</div>
    </div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${askScreen(c, {
    subtitle: doc.t,
    trailing: icon('wifiOff', 17, c.warn, 2),
    placeholder: 'Find passages about…',
    body: `
      ${askTurn(c, { role: 'you', body: 'Why do small samples mislead?' })}
      <div style="display:flex;align-items:flex-start;gap:10px;padding:16px ${PAD}px 12px">
        ${icon('wifiOff', 15, c.warn, 2)}
        <div style="flex:1;font-size:12px;line-height:17px;color:${c.warn}" class="pretty">No connection, so nothing is written for you. The four passages your phone found on its own are below.</div>
      </div>
      ${passage(152, 'The phenomenon we were studying is so common and so important in the everyday world that you should know its name: it is an anchoring effect.')}
      ${passage(31, 'A random event, by definition, does not lend itself to explanation, but collections of random events do behave in a highly regular fashion.')}
      ${passage(156, 'Our thoughts and our behaviour are influenced by contexts we are not aware of, and by samples far too small to carry the conclusions drawn from them.')}`,
  })}
</div>`,
  });
}

/**
 * The gate, asked once, before anything leaves.
 *
 * Not a banner and not a checkbox in settings somebody scrolls past. Everything
 * up to this point happened on the phone; this is the first moment any part of
 * a document crosses to a company that did not write it, and the sentence that
 * says so is the whole screen rather than a line under a button.
 *
 * Refusing is not a dead end, which is why the second control is a real one:
 * the passages still work, and the reader who says no keeps the half of the
 * feature that never needed permission.
 */
function askConsent() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  const point = (glyph, title, body, tone = null) =>
    `<div style="display:flex;align-items:flex-start;gap:12px;padding:11px ${PAD}px">
      <div style="margin-top:1px">${icon(glyph, 16, tone ?? c.fgMuted, 2)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;color:${tone ?? c.fg}">${title}</div>
        <div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${body}</div>
      </div>
    </div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${askScreen(c, {
    subtitle: doc.t,
    composer: false,
    body: `
      <div style="padding:16px ${PAD}px 4px">
        <div style="font-size:17px;font-weight:600;letter-spacing:-.014em;color:${c.fg}">What leaves this phone</div>
        <div style="margin-top:7px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">Searching by meaning has been running here the whole time. Answering in sentences cannot.</div>
      </div>
      ${point('send', 'Your question, and at most eight pages', 'Your phone picks the pages. It sends their numbers; your account reads them and passes the text to the model.')}
      ${point('clock', 'Conversations are deleted after a month', 'Anything you keep — a passage, a note — is yours and stays.')}
      ${point('ban', 'Never the whole document', 'Not the file, not the index, not a page you did not ask about.', c.ok)}
      <div style="padding:14px ${PAD}px 0">
        ${primaryButton(c, 'Turn on Ask')}
        <div style="margin-top:10px">${quietButton(c, 'Just find the passages')}</div>
      </div>`,
  })}
</div>`,
  });
}

/**
 * Conversations about one document, and how much of their month is left.
 *
 * The expiry is on every row rather than in a paragraph somewhere, because a
 * month is long enough to forget and the row is the only place a reader looks.
 * `documentShares` already puts "Expires in 12 days" on a share for the same
 * reason, and this is that line, applied to something that deletes itself
 * rather than to something that stops working.
 */
function askThreads() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  const thread = (title, when, left, warn = false) =>
    `<div style="display:flex;align-items:flex-start;gap:12px;padding:12px ${PAD}px;border-bottom:1px solid ${c.hairline}">
      <div style="margin-top:2px">${icon('messageSquare', 15, c.fgMuted, 2)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;letter-spacing:-.008em;color:${c.fg}" class="c2">${title}</div>
        <div style="margin-top:3px;font-size:12px;color:${c.fgSubtle}">${when}</div>
      </div>
      <span style="flex:0 0 auto;font-size:11px;padding-top:2px;color:${warn ? c.warn : c.fgSubtle}" class="tnum">${left}</span>
    </div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${askScreen(c, {
    subtitle: doc.t,
    composer: false,
    trailing: icon('plus', 19, c.fg, 2),
    body: `
      <div style="padding:14px ${PAD}px 10px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">Conversations</div>
      ${thread('Why do small samples mislead?', 'Yesterday · 6 messages', '28 days')}
      ${thread('The difference between System 1 and System 2, in his words rather than the summaries', '11 March · 14 messages', '19 days')}
      ${thread('What does he mean by an availability cascade?', '24 February · 3 messages', '2 days', true)}
      <div style="display:flex;align-items:flex-start;gap:10px;padding:14px ${PAD}px">
        ${icon('clock', 15, c.fgSubtle, 2)}
        <div style="flex:1;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Conversations are deleted a month after they start, on the server rather than hidden here. Passages and notes you kept are not conversations and are never touched.</div>
      </div>`,
  })}
</div>`,
  });
}

/**
 * The budget, spent.
 *
 * A limit nobody can see is a failure with no cause, which is the whole reason
 * `outcome.ts` treats `RATE_LIMITED` as its own outcome rather than as an
 * error: the queue already knows to wait rather than to count the attempt. This
 * is that fact given a sentence and a time, and the passages still work, which
 * is the point worth making twice.
 */
function askLimited() {
  const c = DARK;
  const doc = byTitle('Thinking,');
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${askScreen(c, {
    subtitle: doc.t,
    composer: false,
    body: `
      ${askTurn(c, { role: 'you', body: 'And what about the planning fallacy?' })}
      <div style="display:flex;align-items:flex-start;gap:10px;padding:16px ${PAD}px 0">
        ${icon('clock', 15, c.warn, 2)}
        <div style="flex:1">
          <div style="font-size:14px;color:${c.warn}">You have asked a lot today</div>
          <div style="margin-top:4px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Answers come back at about forty an hour, and this hour is spent. The next one is available in about eleven minutes. Nothing was lost — your question is still here.</div>
        </div>
      </div>
      <div style="padding:16px ${PAD}px 0">
        ${quietButton(c, 'Find the passages instead', { glyph: 'textSearch' })}
      </div>
      <div style="display:flex;align-items:flex-start;gap:10px;padding:16px ${PAD}px">
        ${icon('info', 15, c.fgSubtle, 2)}
        <div style="flex:1;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Searching by meaning has no limit at all. It runs on this phone and costs nobody anything.</div>
      </div>`,
  })}
</div>`,
  });
}

/**
 * A document Ask cannot answer about yet, and what it is waiting for.
 *
 * Three conditions in order, because they happen in order and only one of them
 * is ever the reader's to fix. A document that is on this phone and not in the
 * account has no text anywhere in the system — `react-native-pdf` has no text
 * API, so the words only exist once the account has read the file — and saying
 * "not indexed" would name the symptom rather than the cause.
 */
function askNotIndexed() {
  const c = DARK;
  const doc = byTitle('Lease Agreement') ?? DOCS[0];
  const step = (state, label, note, done) =>
    `<div style="display:flex;align-items:flex-start;gap:12px;padding:11px ${PAD}px">
      <div style="margin-top:1px">${icon(done ? 'check' : IX(c)[state].glyph, 16, done ? c.ok : IX(c)[state].tone, 2)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;color:${done ? c.fgMuted : c.fg}">${label}</div>
        <div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${note}</div>
      </div>
    </div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">
  ${askScreen(c, {
    subtitle: doc.t,
    composer: false,
    body: `
      <div style="padding:16px ${PAD}px 4px">
        <div style="font-size:17px;font-weight:600;letter-spacing:-.014em;color:${c.fg}">Not ready for this one yet</div>
        <div style="margin-top:7px;font-size:13px;line-height:19px;color:${c.fgMuted}" class="pretty">Three things have to be true before a document can be asked about. Two of them are.</div>
      </div>
      ${step('ready', 'In your account', 'Synced, and its text read out of the copy there.', true)}
      ${step('ready', 'On this phone', 'Downloaded, so its pages can be read without a connection.', true)}
      ${step('model', 'Indexed on this phone', 'The search model has not been downloaded. It is 129 MB and only ever downloads on Wi-Fi.', false)}
      <div style="padding:16px ${PAD}px 0">
        ${primaryButton(c, 'Download the model', { glyph: 'cpu' })}
      </div>
      <div style="display:flex;align-items:flex-start;gap:10px;padding:16px ${PAD}px">
        ${icon('textSearch', 15, c.fgSubtle, 2)}
        <div style="flex:1;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Searching this document by its words works now and always has. The model adds searching it by what it means.</div>
      </div>`,
  })}
</div>`,
  });
}

/**
 * Two ways of finding the same thing, side by side and labelled.
 *
 * The chip row is `Segments` — the same control the navigator and the sharing
 * screens use, which is why this app has no `Tabs`. What is new is the label on
 * each result: a hit is there because the words matched, because the meaning
 * matched, or because both did, and hiding that would make the one surprising
 * result of the four look like a bug.
 *
 * The page-31 hit is the argument for the whole feature. It does not contain
 * the word "sample" anywhere.
 */
function searchMeaning() {
  const c = DARK;
  const hit = (title, page, text, why) =>
    `<div style="padding:14px ${PAD}px;border-bottom:1px solid ${c.hairline}">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="flex:1;font-size:13px;font-weight:600;letter-spacing:-.008em;color:${c.fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</div>
        <span style="font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:${why === 'words' ? c.fgSubtle : c.primary};flex:0 0 auto">${why}</span>
        <span style="font-size:11px;color:${c.fgSubtle};flex:0 0 auto" class="tnum">page ${page}</span>
      </div>
      <div style="margin-top:5px;font-size:12px;line-height:18px;color:${c.fgMuted}" class="c2">${text}</div>
    </div>`;

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="height:844px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;gap:10px;padding:52px ${PAD}px 0">
    ${icon('arrowLeft', 22, c.fg, 2)}
    <div style="flex:1;height:40px;display:flex;align-items:center;gap:10px;padding:0 12px;border-radius:${R};background:${c.surface};box-shadow:inset 0 0 0 1px ${c.hairline}">
      ${icon('search', 16, c.fgSubtle)}
      <span style="font-size:14px;color:${c.fg}">why a small sample fools an expert</span>
    </div>
  </div>

  ${segments(c, [{ label: 'Meaning', on: true }, { label: 'Words', on: false }, { label: 'Titles', on: false }])}
  <div style="height:1px;background:${c.hairline}"></div>

  <div style="padding:14px ${PAD}px 10px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">9 passages in 3 documents</div>

  <div style="flex:1;border-top:1px solid ${c.hairline};overflow:hidden">
    ${hit('Thinking, Fast and Slow', 153, 'The exaggerated faith of researchers in what can be learned from a few observations is closely related to the halo effect.', 'meaning')}
    ${hit('Thinking, Fast and Slow', 31, 'A random event, by definition, does not lend itself to explanation, but collections of random events do behave in a highly regular fashion.', 'meaning')}
    ${hit('Thinking, Fast and Slow', 152, 'Any number that you are asked to consider as a possible solution to an estimation problem will induce an effect of the same kind.', 'both')}
    ${hit('The Design of Everyday Things', 88, 'Five users will find most of the problems, which is true of the problems five users can find.', 'meaning')}
    ${hit('Designing Data-Intensive Applications', 14, 'Percentiles from a small sample of requests are noisy, and the tail is where the noise lives.', 'words')}

    <div style="display:flex;align-items:flex-start;gap:12px;padding:16px ${PAD}px">
      ${icon('sparkles', 17, c.fgSubtle, 2)}
      <div style="flex:1">
        <div style="font-size:13px;color:${c.fgMuted}">Page 31 does not contain any of these words</div>
        <div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">It is here because it is about the same thing. That is the whole difference between the two chips above.</div>
      </div>
    </div>

    <div style="display:flex;align-items:flex-start;gap:12px;padding:0 ${PAD}px 16px">
      ${icon('scanText', 17, c.fgSubtle, 2)}
      <div style="flex:1">
        <div style="font-size:13px;color:${c.fgMuted}">6 documents have no index yet</div>
        <div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Four are being prepared now. Two are on this phone only, so there is no text to read.</div>
      </div>
    </div>
  </div>
</div>`,
  });
}

/**
 * The library while an index is being built, which is most of a long evening.
 *
 * One line of metadata on one tile, in the slot the page count already
 * occupies. A book being indexed is not a book you cannot read — every other
 * thing about it works — so it gets the tile's quietest line and not a banner,
 * a badge or a spinner. `docs/design.md`'s rule for `Badge` is that it carries
 * a number somebody has to act on, and a percentage that finishes on its own is
 * not one.
 */
function homeIndexing() {
  const c = DARK;
  const t = (title, opts) => tile(byTitle(title), { dark: true, ...opts });
  const indexing = (title, pct) => {
    const doc = byTitle(title);
    return `<div style="width:${COVER_W}px;flex:0 0 auto">
      ${pageCover(doc, { w: COVER_W })}
      <div style="margin-top:8px;font-size:12px;line-height:16px;letter-spacing:-.006em;color:${c.fg}" class="c2">${doc.t}</div>
      <div style="margin-top:7px;height:2px;border-radius:${R};background:${c.border};overflow:hidden"><div style="width:${pct}%;height:100%;border-radius:${R};background:${c.primary}"></div></div>
      <div style="margin-top:5px;display:flex;align-items:center;gap:5px;font-size:10px;line-height:13px;color:${c.fgSubtle}">
        ${icon('sparkles', 11, c.fgSubtle, 2)}<span class="tnum">Preparing search · ${pct}%</span>
      </div>
    </div>`;
  };

  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `${header(c)}
${searchTrigger(c)}
${rail('Recently added', [
    indexing('Designing Data', 38),
    t('Annual Report', { real: true }),
    t('Lease Agreement', { real: true }),
    t('Sapiens', { real: true }),
  ], c)}
${rail('Continue reading', [
    t('Thinking,', { showProgress: true, real: true }),
    t('The Design of', { showProgress: true, real: true }),
    t('Convex Backend', { showProgress: true }),
    t('Kubernetes', { showProgress: true, real: true }),
  ], c)}
<div style="margin:26px ${PAD}px 0;display:flex;align-items:flex-start;gap:10px">
  ${icon('sparkles', 13, c.fgSubtle, 2)}
  <span style="font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">Designing Data-Intensive Applications is being prepared for search by meaning — 2,100 of 5,400 passages. It opens, reads and searches by word right now, and picks up where it stopped if you close the app.</span>
</div>`,
  });
}

/**
 * Two screens' worth of settings, and the line down the middle of them.
 *
 * Everything under Search and Indexing is this handset's answer and stays on
 * it, for `preferences-store.ts`'s reason: a phone's answer about its data plan
 * is not an answer a tablet ever gave. Everything under Ask and Conversations
 * is the account's, because a conversation started here has to be readable
 * there. The screen says which is which on each group rather than leaving the
 * reader to discover it on a second device.
 *
 * `downloadSettings` is the shape, down to the two parts: one screen is taller
 * than an artboard, and pretending otherwise draws a screen nobody can reach
 * the bottom of.
 */
function intelligence(part) {
  const c = DARK;
  const top = part === 'top';
  return dc({
    w: 390, h: 844, bg: c.bg,
    body: `<div style="position:relative;height:844px;overflow:hidden;background:${c.bg}">${sharePage(c, {
      glyph: 'sparkles',
      title: 'Search & Ask',
      subtitle: 'Finding what a document means',
      body: top
        ? `<div style="flex:1;overflow:hidden">
        ${settingsLabel(c, 'On this phone', 14)}
        ${settingsSwitch(c, { label: 'Search by meaning', note: 'Finds a passage that is about what you typed, not only one that contains it.', on: true })}
        ${settingsPick(c, { label: 'Model', note: 'multilingual-e5-small, 94 languages. Runs here; nothing it reads is sent anywhere.', value: '129 MB' })}
        <div style="height:1px;margin:8px ${PAD}px 0;background:${c.hairline}"></div>
        ${settingsLabel(c, 'Indexing')}
        ${settingsSwitch(c, { label: 'Index new documents automatically', note: 'A document is indexed once its text has arrived from your account.', on: true })}
        ${settingsSwitch(c, { label: 'Index over Wi-Fi only', note: 'Indexing itself uses no data. This holds the text it needs to fetch first.', on: true })}
        ${settingsPick(c, { label: 'Stop indexing below', note: 'Never runs the battery down finishing a book you are not reading.', value: '20% battery' })}
        ${settingsPick(c, { label: 'Keep at most', note: '340 MB of 2 GB used. The oldest index is dropped first, and rebuilds when you open it.', value: '2 GB' })}
        ${quietNotice(c, 'cpu', 'The model never leaves this phone and never phones home. It is downloaded once, checked against a known fingerprint before it is used, and deleted whenever you say so.')}
      </div>`
        : `<div style="flex:1;overflow:hidden">
        ${settingsLabel(c, 'Library', 14)}
        ${settingsPick(c, { label: 'Indexed', note: '4 waiting for their text · 2 on this phone only · 1 needs rebuilding', value: '31 of 38' })}
        ${settingsPick(c, { label: 'Index size', note: 'About 400 KB a book. Removing an index does not remove the book.', value: '340 MB' })}
        <div style="height:1px;margin:8px ${PAD}px 0;background:${c.hairline}"></div>
        ${settingsLabel(c, 'Ask · your account')}
        ${settingsSwitch(c, { label: 'Allow Ask', note: 'Sends your question and the pages your phone picked. Off, and Ask still finds passages.', on: true })}
        ${settingsPick(c, { label: 'Pages sent per question', note: 'More pages is a better answer and more of your book leaving the phone.', value: '8' })}
        ${settingsPick(c, { label: 'Keep conversations for', note: 'Deleted on the server when the time is up, not hidden here.', value: '30 days' })}
        ${settingsPick(c, { label: 'Documents other people shared with me', note: 'Their book, their decision. Yours is on Sharing & privacy.', value: '2 allow it' })}
        ${quietNotice(c, 'ban', 'Your library is never used to train anything, and no part of a document is stored by the model. What you keep from a conversation becomes a note and outlives it.', c.ok)}
      </div>`,
    })}</div>`,
  });
}

/**
 * The Ask screen, taken apart, and the decision that is worth writing down.
 *
 * It was a sheet. The first version pinned it to a fixed 70% of the screen, and
 * the note on this board argued for that height at some length — which was the
 * tell. `docs/design.md` already had the rule: **a control must not hang off a
 * box whose height is the reader's data.** The navigator became a route because
 * of it, after Contents at 355 rows and Bookmarks at one moved its segmented
 * control two-thirds up the screen between them and the next tap landed on the
 * backdrop.
 *
 * A transcript is that data and a composer is that control, so pinning the box
 * was living with the problem. A route is the answer, and it is the answer this
 * document already gave for every other surface that holds a list.
 */
function askAnatomy() {
  const c = DARK;
  const note = (n, title, body) =>
    `<div style="display:flex;gap:12px;padding:9px 0">
      <div style="width:20px;height:20px;border-radius:9999px;background:${c.primaryTint};display:flex;align-items:center;justify-content:center;flex:0 0 auto"><span style="font-size:11px;font-weight:600;color:${c.primary}">${n}</span></div>
      <div style="flex:1"><div style="font-size:13px;font-weight:600;color:${c.fg}">${title}</div><div style="margin-top:3px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${body}</div></div>
    </div>`;

  return dc({
    w: 900, h: 560, bg: c.bg,
    body: `<div style="padding:36px 40px">
  <div style="font-size:22px;font-weight:700;letter-spacing:-.02em;color:${c.fg}">The Ask screen</div>
  <div style="margin-top:24px;display:flex;gap:40px;align-items:flex-start">
    <div style="width:280px;flex:0 0 auto;position:relative;height:420px;border-radius:${R};overflow:hidden;box-shadow:inset 0 0 0 1px ${c.border};background:${c.bg}">
      <div style="display:flex;align-items:center;padding:18px 16px 10px">
        ${icon('arrowLeft', 18, c.fg, 2)}
        <div style="margin-left:8px">${icon('sparkles', 15, c.fgMuted)}</div>
        <div style="flex:1;min-width:0;margin-left:8px">
          <div style="font-size:13px;font-weight:600;color:${c.fg}">Ask</div>
          <div style="margin-top:1px;font-size:11px;color:${c.fgSubtle};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Thinking, Fast and Slow</div>
        </div>
        <div style="padding:3px 7px;border-radius:${R};background:${c.surface}"><span style="font-size:10px;color:${c.fgSubtle}">28 days</span></div>
      </div>
      <div style="height:1px;background:${c.hairline}"></div>
      <div style="padding:14px 16px 0">
        <div style="font-size:9px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">You</div>
        <div style="margin-top:4px;font-size:12px;line-height:17px;color:${c.fg}">Why do small samples mislead?</div>
        <div style="margin-top:14px;font-size:9px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.primary}">Pidom</div>
        <div style="margin-top:4px;font-size:12px;line-height:17px;color:${c.fg}" class="c5">Because the intuition that judges a sample never asks how large it is. Small samples produce more extreme results, so they tell better stories.</div>
        <div style="display:flex;gap:5px;margin-top:9px">
          ${[152, 153, 156].map((p) => `<div style="padding:3px 7px;border-radius:${R};background:${c.primaryTint}"><span style="font-size:10px;color:${c.primary}">page ${p}</span></div>`).join('')}
        </div>
        <div style="display:flex;gap:10px;margin-top:10px">
          ${icon('highlighter', 14, c.fgMuted, 2)}${icon('copy', 14, c.fgMuted, 2)}
        </div>
      </div>
      <div style="position:absolute;left:14px;right:14px;bottom:14px;border-radius:18px;background:${c.hover};padding:9px 10px">
        <div style="font-size:12px;color:${c.fgSubtle};padding:2px 2px 8px">Ask about this document</div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:26px;height:26px;border-radius:9999px;background:${c.primaryTint};display:flex;align-items:center;justify-content:center"><span style="font-size:15px;color:${c.primary}">+</span></div>
            <div style="height:26px;display:flex;align-items:center;padding:0 9px;border-radius:9999px;background:${c.primaryTint}"><span style="font-size:11px;color:${c.primary}">gpt-4o-mini</span></div>
          </div>
          <div style="width:28px;height:28px;border-radius:9999px;background:${c.primary};display:flex;align-items:center;justify-content:center"><span style="font-size:13px;color:${c.onPrimary}">↑</span></div>
        </div>
      </div>
    </div>
    <div style="flex:1;min-width:0">
      ${note(1, 'A route, not a sheet', 'A transcript\u2019s height is the reader\u2019s data and a composer is a control, which is the pair <b style="color:' + c.fg + '">docs/design.md</b> says must not be attached to each other. The navigator became a route for the same reason; pinning a sheet to 70% was living with the problem.')}
      ${note(2, 'Pushed, so the document stays', 'The reader is one screen behind this, still mounted. Coming back is not reopening a 400-page file \u2014 which is why <b style="color:' + c.fg + '">navigator</b> and <b style="color:' + c.fg + '">bookmark</b> are pushed rather than presented too.')}
      ${note(3, 'The composer owns the bottom', 'It is <b style="color:' + c.fg + '">absolute bottom-4</b> and rides the keyboard on a shared value from <b style="color:' + c.fg + '">KeyboardProvider</b>. On a whole screen that is simply where it sits; in a sheet it was competing with the sheet for the same last few hundred pixels.')}
      ${note(4, 'No bubbles', 'There are no cards in this application and one accent colour in it. A turn is a role label over a paragraph \u2014 the typography every <b style="color:' + c.fg + '">Section</b> heading already uses.')}
      ${note(5, 'Citations are controls', 'Each goes to its page and drops back to the reader. An answer nobody can check against the book is an answer <i>about</i> a book rather than <i>from</i> one.')}
      ${note(6, 'Two actions, both wired', 'Keep writes an annotation through the path a selected passage already takes, so it outlives the month. Copy copies. The component ships a third slot and it is empty rather than decorative.')}
    </div>
  </div>
</div>`,
  });
}

/**
 * Every state a document's index can be in, the sentence its row says, and the
 * one thing it offers.
 *
 * `DownloadStates` exists for the reason this does: a state machine that lives
 * only in a TypeScript union is a state machine nobody reviews, and four of the
 * download states had been collapsed into "missing" for a year because nothing
 * ever laid them out side by side. Eleven here, and three of them — waiting,
 * model, cap — are conditions the reader can act on, which is why they are the
 * only ones in `warn`.
 */
function indexStates() {
  const c = DARK;
  const s = IX(c);
  const order = ['none', 'waiting', 'queued', 'model', 'wifi', 'cap', 'chunking', 'embedding', 'ready', 'stale', 'failed'];
  const does = {
    none: 'Index this one',
    waiting: '—',
    queued: 'Move to front · Cancel',
    model: 'Download the model · Settings',
    wifi: 'Index anyway · Settings',
    cap: 'Raise the ceiling · Drop the oldest',
    chunking: 'Pause · Cancel',
    embedding: 'Pause · Cancel',
    ready: 'Search · Ask · Remove index',
    stale: 'Rebuild · Leave it',
    failed: 'Try again',
  };
  const progress = { chunking: 'Reading page 412 of 613.', embedding: '2,100 of 5,400 passages. Resumes where it stopped.' };
  const row = (k) =>
    `<div style="display:flex;align-items:flex-start;gap:14px;padding:12px 0;border-bottom:1px solid ${c.hairline}">
      <div style="width:20px;margin-top:1px">${icon(s[k].glyph, 16, s[k].tone, 2)}</div>
      <div style="width:210px;flex:0 0 auto">
        <div style="font-size:13px;font-weight:600;color:${s[k].tone}">${s[k].label}</div>
        <div style="margin-top:3px;font-size:11px;font-family:ui-monospace,Menlo,monospace;color:${c.fgDisabled}">${k}</div>
      </div>
      <div style="flex:1;min-width:0;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${s[k].line ?? progress[k]}</div>
      <div style="width:240px;flex:0 0 auto;font-size:12px;line-height:17px;color:${c.fgMuted}">${does[k]}</div>
    </div>`;

  return dc({
    w: 1024, h: 760, bg: c.bg,
    body: `<div style="padding:36px 40px">
  <div style="font-size:22px;font-weight:700;letter-spacing:-.02em;color:${c.fg}">Where an index is, and what it is waiting for</div>
  <div style="margin-top:8px;max-width:720px;font-size:13px;line-height:20px;color:${c.fgMuted}" class="pretty">Three of these are conditions somebody can change and eight are not, which is the only distinction the colour makes. Nothing on this chart stops a document being opened, read, or searched by its words — an index that has not been built costs the reader one of four ways of finding a page, and the row says which.</div>

  <div style="margin-top:24px;display:flex;gap:14px;padding-bottom:10px;border-bottom:1px solid ${c.border}">
    <div style="width:34px"></div>
    <div style="width:210px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">State</div>
    <div style="flex:1;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">What the row says</div>
    <div style="width:240px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle}">What it offers</div>
  </div>
  ${order.map(row).join('')}

  <div style="margin-top:20px;display:flex;gap:28px;max-width:940px">
    <div style="flex:1;font-size:12px;line-height:18px;color:${c.fgSubtle}" class="pretty"><b style="color:${c.fg}">A crash is a state too, and it is not on this chart.</b> <b style="color:${c.fg}">chunking</b> and <b style="color:${c.fg}">embedding</b> are rewritten to <b style="color:${c.fg}">queued</b> at launch, the way an interrupted download is rewritten to <b style="color:${c.fg}">paused</b>. The cursor on the row is the last passage that was written, so a book abandoned at page 643 resumes at page 643 rather than at page one.</div>
    <div style="flex:1;font-size:12px;line-height:18px;color:${c.fgSubtle}" class="pretty"><b style="color:${c.fg}">stale is not an error.</b> An index built by an older model still answers, and is left alone until the reader asks otherwise. A model upgrade writes a second index alongside the first and switches to it when it is complete — nothing is ever half-rebuilt while somebody is searching it.</div>
  </div>
</div>`,
  });
}

/**
 * What stays on the phone, what crosses to the account, what reaches the model,
 * and the column headed Never.
 *
 * `DownloadModel` is the precedent and the reason: the order of these steps is
 * the entire privacy argument, and it is not recoverable by reading any one
 * file. The thing to stare at is the second row. The device sends four
 * integers. It is the account — which already holds the text, already knows who
 * owns the document, and already refuses a stranger — that reads the pages and
 * passes them on, which is what makes a citation something other than a claim.
 */
function aiBoundary() {
  const c = DARK;
  const box = (title, lines, { tone = null, w = 232 } = {}) =>
    `<div style="width:${w}px;border-radius:${R};padding:14px 16px;box-shadow:inset 0 0 0 1px ${tone === 'danger' ? c.destructive : tone === 'ok' ? c.ok : c.border}">
       <div style="font-size:13px;font-weight:600;letter-spacing:-.008em;color:${tone === 'danger' ? c.destructive : tone === 'ok' ? c.ok : c.fg}">${title}</div>
       ${lines.map((l) => `<div style="margin-top:7px;font-size:12px;line-height:17px;color:${c.fgSubtle}" class="pretty">${l}</div>`).join('')}
     </div>`;
  const arrow = () => `<div style="display:flex;align-items:center;justify-content:center;width:38px">${icon('arrowRight', 17, c.fgMuted, 2)}</div>`;
  const label = (t) => `<div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${c.fgSubtle};margin-bottom:12px">${t}</div>`;
  const b = (t) => `<b style="color:${c.fg}">${t}</b>`;

  return dc({
    w: 900, h: 760, bg: c.bg,
    body: `<div style="padding:36px 40px">
  <div style="font-size:22px;font-weight:700;letter-spacing:-.02em;color:${c.fg}">Where a question goes</div>
  <div style="margin-top:8px;max-width:700px;font-size:13px;line-height:20px;color:${c.fgMuted}" class="pretty">Two planes, and the line between them is not where it usually is. Every expensive, private thing — reading the book, cutting it into passages, turning them into vectors, deciding which four matter — happens on the handset. What crosses is a question and four page numbers.</div>

  <div style="margin-top:28px">${label('On this phone, always')}
    <div style="display:flex;align-items:stretch">
      ${box('The index is built here', ['A 129 MB model, downloaded once and checked against a known fingerprint. It reads the pages your account already extracted and turns each passage into 384 numbers.'])}
      ${arrow()}
      ${box('And stored here', ['Inside the same SQLCipher database as your library, under the same key. 388 bytes a passage, about 400 KB a book. No vector has ever left a phone.'])}
      ${arrow()}
      ${box('And searched here', ['With no connection, no account and no permission. Searching by meaning is not a feature you are lent — it is on the device and it stays working.'], { tone: 'ok' })}
    </div>
  </div>

  <div style="margin-top:26px">${label('What crosses, when you ask a question')}
    <div style="display:flex;align-items:stretch">
      ${box('Four integers and a sentence', [`${b('{ documentId, pages: [152, 153, 156, 31] }')} and what you typed. The phone does not send the passages it found — it sends where they are.`])}
      ${arrow()}
      ${box('Your account reads them', ['The same ownership check the reader passes, then those four rows out of ' + b('documentPages') + '. A client cannot put words in a book’s mouth, because it never supplies any.'])}
      ${arrow()}
      ${box('The model sees a bounded window', ['At most eight pages, 64 KB, fenced and labelled as quoted material. The agent has no tools, so nothing it writes can reach anything.'])}
    </div>
  </div>

  <div style="margin-top:26px">${label('Never')}
    <div style="display:flex;align-items:stretch;gap:18px">
      ${box('The document', ['Not the file, not the index, not a page nobody asked about. A 613-page book sends at most eight of them, and only the eight the reader’s own question selected.'], { tone: 'danger', w: 250 })}
      ${box('A key on the handset', ['The model is reached from the deployment. No API key is bundled, shipped in an update, or held in ' + b('EXPO_PUBLIC_*') + ' where anybody with the APK can read it.'], { tone: 'danger', w: 250 })}
      ${box('Somebody else’s book, by default', ['A document shared with you is not yours to send. ' + b('allowAiOnSharedDocuments') + ' is the owner’s switch, it is off, and the sheet says so rather than failing.'], { tone: 'danger', w: 250 })}
    </div>
  </div>

  <div style="margin-top:26px;padding-top:18px;border-top:1px solid ${c.hairline};font-size:12px;line-height:18px;color:${c.fgSubtle};max-width:820px" class="pretty"><b style="color:${c.fg}">A passage from a PDF is untrusted input, and it is treated as such.</b> Anybody can put “ignore your instructions” in a document and share it. The context block is fenced and labelled as quotation, the agent ships with no tools at all, and nothing the model returns chooses a page, fetches a URL or writes a row — so the worst a hostile document can do is make one answer wrong.</div>
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

  /* Round two. */
  'Activity.dc.html': activityScreen(false),
  'ActivityEmpty.dc.html': activityScreen(true),
  'SharedInboxBadge.dc.html': sharedBadge(),
  'SharedSkeleton.dc.html': sharedSkeleton(),
  'ShareDownloading.dc.html': shareDetail('downloading'),
  'ShareDetailScrolled.dc.html': shareDetail('pending'),
  'AccessPermission.dc.html': accessPermission(),
  'GroupLeaveConfirm.dc.html': groupLeaveConfirm(),
  'ProfileEdit.dc.html': profileEdit(),
  'NotificationDevices.dc.html': notificationDevices(),
  'SyncData.dc.html': syncData(),
  'DeleteAccount.dc.html': deleteAccount(),

  /* Downloads and offline availability. */
  'Downloads.dc.html': downloads(true),
  'DownloadsLight.dc.html': downloads(false),
  'DownloadsEmpty.dc.html': downloadsEmpty(),
  'DownloadsQueue.dc.html': downloadsQueue(),
  'DownloadActions.dc.html': downloadActions(),
  'DownloadFailed.dc.html': downloadsFailed(),
  'DownloadOutdated.dc.html': downloadsOutdated(),
  'DownloadHeld.dc.html': downloadsHeld(),
  'DownloadSettings.dc.html': downloadSettings('top'),
  'DownloadSettingsScrolled.dc.html': downloadSettings('rest'),
  'DownloadStorageCap.dc.html': downloadStorageCap(),
  'DownloadNoSpace.dc.html': downloadNoSpace(),
  'DownloadRemoveConfirm.dc.html': downloadRemoveConfirm(),
  'DownloadStates.dc.html': downloadStates(),
  'DownloadRowAnatomy.dc.html': downloadRowAnatomy(),
  'DownloadModel.dc.html': downloadModel(),

  /* Search by meaning, and Ask. */
  'AskClosed.dc.html': askClosed(),
  'Ask.dc.html': ask(),
  'AskSources.dc.html': askSources(),
  'AskFromSelection.dc.html': askFromSelection(),
  'AskOffline.dc.html': askOffline(),
  'AskConsent.dc.html': askConsent(),
  'AskThreads.dc.html': askThreads(),
  'AskLimited.dc.html': askLimited(),
  'AskNotIndexed.dc.html': askNotIndexed(),
  'SearchMeaning.dc.html': searchMeaning(),
  'HomeIndexing.dc.html': homeIndexing(),
  'Intelligence.dc.html': intelligence('top'),
  'IntelligenceScrolled.dc.html': intelligence('rest'),
  'AskAnatomy.dc.html': askAnatomy(),
  'IndexStates.dc.html': indexStates(),
  'AiBoundary.dc.html': aiBoundary(),
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

    { file: 'Activity.dc.html', title: 'Activity — what has happened', x: 0, y: 19964, w: 390, h: 844 },
    { file: 'ActivityEmpty.dc.html', title: 'Activity — nothing yet', x: 490, y: 19964, w: 390, h: 844 },
    { file: 'SharedInboxBadge.dc.html', title: 'Account — with what is waiting', x: 980, y: 19964, w: 390, h: 844 },
    { file: 'SharedSkeleton.dc.html', title: 'Shared — the shape of what is coming', x: 1470, y: 19964, w: 390, h: 844 },
    { file: 'ShareDownloading.dc.html', title: 'A share — arriving', x: 1960, y: 19964, w: 390, h: 844 },
    { file: 'ShareDetailScrolled.dc.html', title: 'A share — redrawn, content at the top', x: 2450, y: 19964, w: 390, h: 844 },

    { file: 'AccessPermission.dc.html', title: 'Changing what somebody can do', x: 0, y: 20928, w: 390, h: 844 },
    { file: 'GroupLeaveConfirm.dc.html', title: 'Leaving a group, and what it costs', x: 490, y: 20928, w: 390, h: 844 },
    { file: 'ProfileEdit.dc.html', title: 'Your profile', x: 980, y: 20928, w: 390, h: 844 },
    { file: 'NotificationDevices.dc.html', title: 'Notifications — devices and quiet hours', x: 1470, y: 20928, w: 390, h: 844 },
    { file: 'SyncData.dc.html', title: 'Sync & data', x: 1960, y: 20928, w: 390, h: 844 },
    { file: 'DeleteAccount.dc.html', title: 'Deleting an account, and what it cannot reach', x: 2450, y: 20928, w: 390, h: 844 },

    /* Downloads and offline availability. */
    { file: 'Downloads.dc.html', title: 'Downloads — a mixture, dark', x: 0, y: 21900, w: 390, h: 844 },
    { file: 'DownloadsLight.dc.html', title: 'Downloads — light', x: 490, y: 21900, w: 390, h: 844 },
    { file: 'DownloadsEmpty.dc.html', title: 'Downloads — nothing here yet', x: 980, y: 21900, w: 390, h: 844 },
    { file: 'DownloadsQueue.dc.html', title: 'Downloads — the queue', x: 1470, y: 21900, w: 390, h: 844 },
    { file: 'DownloadActions.dc.html', title: 'Download actions', x: 1960, y: 21900, w: 390, h: 844 },
    { file: 'DownloadFailed.dc.html', title: 'Downloads — what went wrong', x: 2450, y: 21900, w: 390, h: 844 },
    { file: 'DownloadOutdated.dc.html', title: 'Downloads — a newer copy exists', x: 2940, y: 21900, w: 390, h: 844 },
    { file: 'DownloadHeld.dc.html', title: 'Downloads — held for Wi-Fi', x: 3430, y: 21900, w: 390, h: 844 },
    { file: 'DownloadSettings.dc.html', title: 'Download settings — network and automatic', x: 0, y: 22864, w: 390, h: 844 },
    { file: 'DownloadSettingsScrolled.dc.html', title: 'Download settings — storage, integrity, queue', x: 490, y: 22864, w: 390, h: 844 },
    { file: 'DownloadStorageCap.dc.html', title: 'Storage ceiling', x: 980, y: 22864, w: 390, h: 844 },
    { file: 'DownloadNoSpace.dc.html', title: 'Downloads — not enough room', x: 1470, y: 22864, w: 390, h: 844 },
    { file: 'DownloadRemoveConfirm.dc.html', title: 'Remove a download — the two sheets', x: 1960, y: 22864, w: 390, h: 844 },
    { file: 'DownloadStates.dc.html', title: 'Where a file is, and what it waits for', x: 0, y: 23828, w: 1024, h: 760 },
    { file: 'DownloadRowAnatomy.dc.html', title: 'The download row — anatomy', x: 1124, y: 23828, w: 900, h: 560 },
    { file: 'DownloadModel.dc.html', title: 'How a PDF gets onto this phone', x: 2124, y: 23828, w: 900, h: 760 },

    /* Search by meaning, and Ask. */
    { file: 'AskClosed.dc.html', title: 'Reader \u2014 where Ask sits', x: 0, y: 24792, w: 390, h: 844 },
    { file: 'Ask.dc.html', title: 'Ask \u2014 a question, answered from four pages', x: 490, y: 24792, w: 390, h: 844 },
    { file: 'AskSources.dc.html', title: 'Ask \u2014 where the answer came from', x: 980, y: 24792, w: 390, h: 844 },
    { file: 'AskFromSelection.dc.html', title: 'Ask \u2014 about this passage', x: 1470, y: 24792, w: 390, h: 844 },
    { file: 'AskOffline.dc.html', title: 'Ask \u2014 with no connection', x: 1960, y: 24792, w: 390, h: 844 },
    { file: 'AskConsent.dc.html', title: 'Ask \u2014 what leaves this phone', x: 2450, y: 24792, w: 390, h: 844 },

    { file: 'AskThreads.dc.html', title: 'Ask \u2014 conversations, and what is left of the month', x: 0, y: 25756, w: 390, h: 844 },
    { file: 'AskLimited.dc.html', title: 'Ask \u2014 today\u2019s budget, spent', x: 490, y: 25756, w: 390, h: 844 },
    { file: 'AskNotIndexed.dc.html', title: 'Ask \u2014 this document is not ready', x: 980, y: 25756, w: 390, h: 844 },
    { file: 'SearchMeaning.dc.html', title: 'Search inside \u2014 meaning and words', x: 1470, y: 25756, w: 390, h: 844 },
    { file: 'HomeIndexing.dc.html', title: 'Home \u2014 preparing search', x: 1960, y: 25756, w: 390, h: 844 },

    { file: 'Intelligence.dc.html', title: 'Search & Ask \u2014 model and indexing', x: 0, y: 26720, w: 390, h: 844 },
    { file: 'IntelligenceScrolled.dc.html', title: 'Search & Ask \u2014 library, Ask, conversations', x: 490, y: 26720, w: 390, h: 844 },

    { file: 'IndexStates.dc.html', title: 'Where an index is, and what it waits for', x: 0, y: 27684, w: 1024, h: 760 },
    { file: 'AskAnatomy.dc.html', title: 'The Ask sheet \u2014 anatomy', x: 1124, y: 27684, w: 900, h: 560 },
    { file: 'AiBoundary.dc.html', title: 'Where a question goes', x: 2124, y: 27684, w: 900, h: 760 },
  ],
  annotations: [
    { id: 'note-downloads', x: 0, y: 21730, w: 880, text: 'Four of these states did not exist, and their absence was a wrong answer rather than a missing feature.\nA download held for Wi-Fi, one queued behind two others, one paused halfway and one that had simply failed were all \u201cmissing\u201d on the tile \u2014 the same word as a document nobody had ever asked for. A reader about to board a flight could not tell which of the four they were looking at, which is the one moment the answer matters.\nNothing here reaches the account. documentFiles is the only table with no counterpart on the server, because only the phone can honestly say whether a file is on it and whether it opens.' },
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
    { id: 'note-roundtwo', x: 0, y: 19814, w: 880, text: 'The feature was built and was not reachable.\nNothing about sharing was live \u2014 the library had a Convex subscription so a favourite crossed devices in a second, and shares waited on a 30-second heartbeat that would not run while the outbox had anything in it. The event feed had a table, a sync pass and an unread count, and no screen. Avatars were frozen at sign-up because the profile refresh fired once per account rather than once per launch. And the content sat low: an empty state 64px down, a share detail with a hard spacer pushing its buttons to the bezel and no way to scroll past a long title.\nThese are the surfaces that close that, and the layout rule they all now follow: content starts at the top, loading shows the shape of what is coming, and nothing is centred unless being centred is the point.' },
    { id: 'note-delete', x: 2450, y: 20778, w: 380, text: 'The one dialog that asks for a typed word. Everything else destructive here is one tap behind a sentence, which is right for a document that downloads again. This is not, and it is honest about the one thing it cannot reach.' },
    { id: 'note-notify', x: 2940, y: 18886, w: 380, text: 'A push says a PDF was shared with you and who by. Never the title \u2014 it renders on a locked screen. The rest arrives from an authenticated query once the app is open and the recipient has been checked.' },
    { id: 'note-ask', x: 0, y: 24622, w: 880, text: 'Finding the right four pages was always the hard part.\nA reader who remembers an argument and not its wording had no way back to it \u2014 FTS5 answers \u201cwhich page contains this string\u201d and nothing else, so a 1,000-page book was searchable only in the vocabulary its author happened to use. Every passage on this phone is now 384 numbers as well as its words, and the two indexes are asked the same question and their answers fused.\nWhich is why Ask is a small feature rather than a large one. The model is handed at most eight pages and asked to write about them; the work that makes the answer right happened on the device before the question left it.\nThe surface is gluestack\u2019s Chat AI, vendored and audited on the way in \u2014 two styled imports repointed at the shim, three colour classes that named nothing pointed at tokens, and a dozen type errors the generator shipped, one of which was a ReferenceError that would have thrown the moment a branch rendered.' },
    { id: 'note-nobubbles', x: 2450, y: 24622, w: 380, text: 'A route rather than a sheet, and the rule is already written down: a control must not hang off a box whose height is the reader\u2019s data. A transcript is that data and a composer is that control.' },
    { id: 'note-index-local', x: 0, y: 27594, w: 880, text: 'The line between the two planes is not where it usually is.\nReading the book, cutting it into passages, embedding them and deciding which four matter all happen on the handset, offline, in the same encrypted database as the library. What crosses the wire when somebody asks a question is a sentence and four integers \u2014 the account reads its own pages back, which is what makes a citation something other than a claim.\nNothing here adds a workpool. convex.config.ts spends 4 + 2 + 2 of the deployment\u2019s twenty already, and an index that ran in the cloud would be thousands of writes per book for an answer the phone can compute for free.' },
    { id: 'note-device-storage', x: 0, y: 14030, w: 880, text: 'The screen the refusal always assumed.\nAn import with no room says to remove a download or two, and until now nothing said which ones were large — the account’s Storage section reported what was in the account, which is the other half.\nEvery row says what removing it costs. A document in the account comes back on a tap; a document that is only here does not come back at all. Same gesture, two consequences, so the row says which before the reader commits. And no covers: this is the one library surface where a document is a quantity rather than something to open.' },
  ],
  launch: { view: 'canvas' },
};
writeFileSync(new URL('./canvas.json', import.meta.url), JSON.stringify(canvas, null, 2));
console.log('wrote', Object.keys(out).length, 'artboards + canvas.json');
