import { app, autoUpdater, net, shell } from 'electron';
import type { UpdatePhase, UpdatePrefs, UpdateState } from '../../shared/ipc';
import { extractVersion, isNewer, parseProbeResponse } from './versions';

/**
 * The desktop auto-update service (Windows, packaged only).
 *
 * Two mechanisms, deliberately split so "auto-download" is a real toggle:
 *   • DETECT — a lightweight HTTPS GET to `update.electronjs.org` learns the new
 *     version + release notes WITHOUT downloading (204 up to date, 200 JSON when
 *     an update exists). This backs `check()` and the periodic auto-check.
 *   • DOWNLOAD + APPLY — only on `download()` (user opt-in, or auto-download) do
 *     we point Electron's built-in Squirrel `autoUpdater` at the same feed and
 *     call `checkForUpdates()`, which fetches and stages the package; `restart()`
 *     then calls `quitAndInstall()`. Squirrel also applies a staged update on the
 *     next normal quit.
 *
 * We drive Electron's built-in `autoUpdater` directly rather than pulling in
 * `update-electron-app`: that wrapper couples check-and-download on its own
 * interval, which would defeat the detect/download split above — and driving the
 * ~15 lines of `autoUpdater` wiring ourselves avoids the extra dependency.
 *
 * Everything is gated on `app.isPackaged && win32`; elsewhere the phase stays
 * `unsupported` and every method is inert, so the renderer surface stays
 * inspectable in dev without ever touching Squirrel (which throws off-Squirrel).
 * The feed owner/repo are hardcoded — the renderer can never supply a URL — and
 * the untrusted feed JSON is zod-parsed before any of it reaches the UI.
 */

/** The public GitHub repo the feed reads releases from. */
const OWNER = 'PiDom-app';
const REPO = 'pidom';

/** Electron's free hosted update feed for public repos. HTTPS only. */
const FEED_HOST = 'https://update.electronjs.org';

/** The release page opened by "What's new" — a fixed github.com URL, never feed
 *  data, so it always passes the shell's https guard. */
const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`;

/** How often auto-check re-probes while the app runs (6h); launch probes once. */
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Defaults: check + download automatically, indicator visible (quiet off). */
const DEFAULT_PREFS: UpdatePrefs = { autoCheck: true, autoDownload: true, quiet: false };

type UpdateListener = (state: UpdateState) => void;

export class UpdateService {
  private readonly listeners = new Set<UpdateListener>();
  private readonly supported: boolean;
  private readonly currentVersion = app.getVersion();
  private prefs: UpdatePrefs = { ...DEFAULT_PREFS };

  private phase: UpdatePhase;
  private availableVersion: string | null = null;
  private notes: string | null = null;
  private notesUrl: string | null = null;
  private lastCheckedAt: number | null = null;
  private error: string | null = null;

  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private squirrelWired = false;
  private probing = false;

  constructor() {
    this.supported = app.isPackaged && process.platform === 'win32';
    this.phase = this.supported ? 'idle' : 'unsupported';
  }

  onChange(listener: UpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }

  /** A full snapshot — the only thing the renderer ever sees. No path, no URL
   *  from feed data; just phase, version strings, plain-text notes, timestamp. */
  getState(): UpdateState {
    return {
      phase: this.phase,
      currentVersion: this.currentVersion,
      availableVersion: this.availableVersion,
      notes: this.notes,
      notesUrl: this.notesUrl,
      lastCheckedAt: this.lastCheckedAt,
      error: this.error,
    };
  }

  private setPhase(phase: UpdatePhase): void {
    this.phase = phase;
    this.emit();
  }

  /** Wire auto-check and run the first probe. Called once the window is ready. */
  start(): void {
    if (!this.supported) return;
    this.applyAutoCheck();
    if (this.prefs.autoCheck) void this.check();
  }

  /** Stop the periodic timer (on quit). */
  dispose(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.checkTimer = null;
  }

  setPrefs(prefs: UpdatePrefs): void {
    this.prefs = {
      autoCheck: Boolean(prefs.autoCheck),
      autoDownload: Boolean(prefs.autoDownload),
      quiet: Boolean(prefs.quiet),
    };
    if (this.supported) this.applyAutoCheck();
  }

  private applyAutoCheck(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    if (this.prefs.autoCheck) {
      this.checkTimer = setInterval(() => void this.check(), AUTO_CHECK_INTERVAL_MS);
    }
  }

  /**
   * Detection only — never downloads. Probes the feed; a `204` means up to date
   * (→ `idle`), a `200` with a genuinely newer version means an update exists
   * (→ `available`, and auto-download if enabled). Won't clobber an in-progress
   * download or a staged (`ready`) update.
   */
  async check(): Promise<void> {
    if (!this.supported || this.probing) return;
    if (this.phase === 'downloading' || this.phase === 'ready') return;
    this.probing = true;
    this.setPhase('checking');
    try {
      const found = await this.probe();
      this.lastCheckedAt = Date.now();
      this.error = null;
      if (!found) {
        this.availableVersion = null;
        this.notes = null;
        this.notesUrl = null;
        this.setPhase('idle');
        return;
      }
      this.availableVersion = found.version;
      this.notes = found.notes;
      this.notesUrl = RELEASES_URL;
      this.setPhase('available');
      if (this.prefs.autoDownload) void this.download();
    } catch {
      this.error = 'check-failed';
      this.setPhase('error');
    } finally {
      this.probing = false;
    }
  }

  /**
   * A single HTTPS GET to the feed via Electron `net` (honours system proxy,
   * follows redirects). Resolves null when up to date (204), when there is no
   * matching update to offer (404), or when the feed advertises a version that
   * is not actually newer; resolves the version + notes when a real update
   * exists; rejects only on a genuine failure (other non-2xx/parse/network error).
   */
  private probe(): Promise<{ version: string | null; notes: string | null } | null> {
    return new Promise((resolve, reject) => {
      const url = `${FEED_HOST}/${OWNER}/${REPO}/win32/${encodeURIComponent(this.currentVersion)}`;
      const request = net.request({ method: 'GET', url });
      request.on('response', (response) => {
        const status = response.statusCode;
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          if (status === 204) return resolve(null);
          // A 404 is not a failure: the feed has no matching update to offer —
          // no releases published yet, no asset matching this platform, or a
          // brief GitHub rate-limit (update.electronjs.org collapses all of
          // these to 404). Treat it exactly like a 204 "up to date" so the UI
          // never shows "Couldn't check for updates" for the common, benign
          // case of there simply being nothing newer to install.
          if (status === 404) return resolve(null);
          if (status !== 200) return reject(new Error(`feed status ${status}`));
          try {
            const parsed = parseProbeResponse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            if (!parsed) return resolve(null);
            const version = extractVersion(parsed.name ?? null, parsed.url ?? null);
            // Defence in depth: the server gates on semver, but if we can read a
            // version, refuse to advertise one that isn't strictly newer.
            if (version && !isNewer(version, this.currentVersion)) return resolve(null);
            resolve({ version, notes: parsed.notes ?? null });
          } catch {
            reject(new Error('feed parse failed'));
          }
        });
      });
      request.on('error', () => reject(new Error('feed network error')));
      request.end();
    });
  }

  /**
   * Downloads + stages the update through Squirrel. `checkForUpdates()` both
   * checks and downloads on Squirrel.Windows (no byte progress is emitted, hence
   * the indeterminate UI); `update-downloaded` moves us to `ready`.
   */
  async download(): Promise<void> {
    if (!this.supported) return;
    if (this.phase === 'downloading' || this.phase === 'ready') return;
    try {
      this.wireSquirrel();
      const feed = `${FEED_HOST}/${OWNER}/${REPO}/win32/${encodeURIComponent(this.currentVersion)}`;
      autoUpdater.setFeedURL({ url: feed });
      this.error = null;
      this.setPhase('downloading');
      autoUpdater.checkForUpdates();
    } catch {
      this.error = 'download-failed';
      this.setPhase('error');
    }
  }

  /** Attach the Squirrel listeners once, lazily (they must not run off-Squirrel). */
  private wireSquirrel(): void {
    if (this.squirrelWired) return;
    this.squirrelWired = true;
    autoUpdater.on('error', () => {
      this.error = 'update-error';
      this.setPhase('error');
    });
    autoUpdater.on('update-not-available', () => {
      // A download that found nothing (rare race) falls back to idle.
      if (this.phase === 'downloading') this.setPhase('idle');
    });
    autoUpdater.on('update-downloaded', () => {
      this.error = null;
      this.setPhase('ready');
    });
  }

  /** Quits and applies a staged update, relaunching into the new version. */
  restart(): void {
    if (!this.supported || this.phase !== 'ready') return;
    autoUpdater.quitAndInstall();
  }

  /** Opens the release page in the system browser (fixed github.com https URL). */
  async openNotes(): Promise<void> {
    await shell.openExternal(RELEASES_URL);
  }
}
