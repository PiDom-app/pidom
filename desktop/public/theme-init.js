// Pre-paint theme setter — avoids a flash of the wrong theme on launch.
// Mirrors the mobile app's src/components/ui/gluestack-ui-provider/script.ts.
//
// Deliberately a same-origin external file (served from public/ → `/theme-init.js`
// in dev, copied to the bundle root and served over `app://bundle/theme-init.js`
// packaged) rather than an inline <script> in index.html. That is what lets the
// packaged Content-Security-Policy (src/main/index.ts) use `script-src 'self'`
// with no `'unsafe-inline'`: an inline script would be blocked. Loaded
// synchronously in <head> before the app bundle, so it still runs before paint.
(function () {
  try {
    var stored = localStorage.getItem('pidom.theme') || 'system';
    var isSystem = stored === 'system';
    var theme = isSystem
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : stored;
    var el = document.documentElement;
    el.classList.remove(theme === 'light' ? 'dark' : 'light');
    el.classList.add(theme);
    el.style.colorScheme = theme;
  } catch (e) {
    /* no-op */
  }
})();
