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
const FEED_PLATFORM = `win32-${process.arch}`;

/** The release page opened by "What's new" — a fixed github.com URL, never feed
 *  data, so it always passes the shell's https guard. */
const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`;

/** How often auto-check re-probes while the app runs (6h); launch probes once. */
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Extra probe attempts before a check is declared failed, and the gap between
 *  them. The launch probe often races a network that isn't ready yet, and the
 *  hosted feed can cold-start with a transient 5xx; a couple of short retries
 *  turn those blips into a clean result instead of "Couldn't check for updates". */
const PROBE_RETRIES = 2;
const PROBE_RETRY_DELAY_MS = 3000;

/** After a check genuinely fails, re-check this soon (5m) rather than waiting the
 *  full 6h auto-check interval — so a transient outage self-heals quickly. */
const ERROR_RETRY_MS = 5 * 60 * 1000;
const INITIAL_NETWORK_RETRY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;
const SQUIRREL_FIRST_RUN_DELAY_MS = 10_000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private squirrelWired = false;
  private probing = false;
  private startTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (!this.prefs.autoCheck) return;
    // Squirrel holds a file lock during first-run setup. Electron documents
    // that autoUpdater requests can fail during this window.
    if (process.argv.includes('--squirrel-firstrun')) {
      this.startTimer = setTimeout(() => {
        this.startTimer = null;
        void this.check();
      }, SQUIRREL_FIRST_RUN_DELAY_MS);
      return;
    }
    void this.check();
  }

  /** Stop the periodic timer (on quit). */
  dispose(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.checkTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
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
    if (!this.prefs.autoCheck && this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
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
      const found = await this.probeWithRetries();
      this.lastCheckedAt = Date.now();
      this.error = null;
      this.clearErrorRetry();
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
    } catch (error) {
      const reason = error instanceof Error && error.message.startsWith('feed ')
        ? error.message
        : 'check-failed';
      if (this.lastCheckedAt === null && (reason === 'feed network error' || reason === 'feed-timeout')) {
        this.error = null;
        this.setPhase('idle');
        this.scheduleErrorRetry(INITIAL_NETWORK_RETRY_MS);
        return;
      }
      this.error = reason;
      this.setPhase('error');
      this.scheduleErrorRetry();
    } finally {
      this.probing = false;
    }
  }

  /**
   * Runs `probe()` up to `PROBE_RETRIES + 1` times with a short backoff, so a
   * transient failure (network not ready at launch, feed cold-start 5xx, a
   * GitHub blip that isn't a clean 404) doesn't strand the UI on
   * "Couldn't check for updates". Rethrows the last error only if every attempt
   * fails. Note: `probe()` already resolves (not rejects) for the benign 204/404
   * and "not actually newer" cases, so those short-circuit without retrying.
   */
  private async probeWithRetries(): Promise<{ version: string | null; notes: string | null } | null> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= PROBE_RETRIES; attempt++) {
      try {
        return await this.probe();
      } catch (err) {
        lastError = err;
        if (attempt < PROBE_RETRIES) await delay(PROBE_RETRY_DELAY_MS);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('probe failed');
  }

  /** Schedule a single near-term re-check after a persistent failure, so the app
   *  recovers in minutes rather than waiting the full 6h auto-check interval.
   *  Guards against stacking timers; the periodic auto-check still runs too. */
  private scheduleErrorRetry(delayMs = ERROR_RETRY_MS): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.check();
    }, delayMs);
  }

  /** Cancel a pending error re-check (a normal check has since succeeded). */
  private clearErrorRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
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
      let settled = false;
      const url = `${FEED_HOST}/${OWNER}/${REPO}/${FEED_PLATFORM}/${encodeURIComponent(this.currentVersion)}`;
      const request = net.request({ method: 'GET', url });
      const complete = <T>(fn: (value: T) => void, value: T): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        fn(value);
      };
      const timeout = setTimeout(() => {
        complete(reject, new Error('feed-timeout'));
        request.abort();
      }, REQUEST_TIMEOUT_MS);
      request.on('response', (response) => {
        const status = response.statusCode;
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          if (status === 204) return complete(resolve, null);
          // A 404 is not a failure: the feed has no matching update to offer —
          // no releases published yet, no asset matching this platform, or a
          // brief GitHub rate-limit (update.electronjs.org collapses all of
          // these to 404). Treat it exactly like a 204 "up to date" so the UI
          // never shows "Couldn't check for updates" for the common, benign
          // case of there simply being nothing newer to install.
          if (status === 404) return complete(resolve, null);
          if (status !== 200) {
            return complete(reject, new Error(`feed status ${status}`));
          }
          try {
            const parsed = parseProbeResponse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            if (!parsed) {
              return complete(reject, new Error('feed parse failed'));
            }
            const version = extractVersion(parsed.name ?? null, parsed.url ?? null);
            if (!version) {
              return complete(reject, new Error('feed version missing'));
            }
            // Defence in depth: the server gates on semver, but if we can read a
            // version, refuse to advertise one that isn't strictly newer.
            if (!isNewer(version, this.currentVersion)) return complete(resolve, null);
            complete(resolve, { version, notes: parsed.notes ?? null });
          } catch {
            complete(reject, new Error('feed parse failed'));
          }
        });
      });
      request.on('error', () => {
        complete(reject, new Error('feed network error'));
      });
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
      const feed = `${FEED_HOST}/${OWNER}/${REPO}/${FEED_PLATFORM}/${encodeURIComponent(this.currentVersion)}`;
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
