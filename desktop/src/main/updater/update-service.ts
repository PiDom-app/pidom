import { app, shell } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import type { UpdatePhase, UpdatePrefs, UpdateState } from '../../shared/ipc';

const OWNER = 'PiDom-app';
const REPO = 'pidom';
const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`;
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ERROR_RETRY_MS = 5 * 60 * 1000;

const DEFAULT_PREFS: UpdatePrefs = {
  autoCheck: true,
  autoDownload: true,
  quiet: false,
};

type UpdateListener = (state: UpdateState) => void;

function isSupportedPlatform(): boolean {
  if (!app.isPackaged) return false;
  if (process.platform === 'win32' || process.platform === 'darwin') return true;
  return process.platform === 'linux' && Boolean(process.env.APPIMAGE);
}

function releaseNotes(info: UpdateInfo): string | null {
  if (typeof info.releaseNotes === 'string') return info.releaseNotes.slice(0, 20_000);
  if (!Array.isArray(info.releaseNotes)) return null;
  return info.releaseNotes
    .map((note) => (typeof note.note === 'string' ? note.note : ''))
    .filter(Boolean)
    .join('\n')
    .slice(0, 20_000) || null;
}

export class UpdateService {
  private readonly listeners = new Set<UpdateListener>();
  private readonly supported = isSupportedPlatform();
  private readonly currentVersion = app.getVersion();
  private prefs: UpdatePrefs = { ...DEFAULT_PREFS };
  private phase: UpdatePhase = this.supported ? 'idle' : 'unsupported';
  private availableVersion: string | null = null;
  private notes: string | null = null;
  private notesUrl: string | null = null;
  private lastCheckedAt: number | null = null;
  private downloadProgress: number | null = null;
  private error: string | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private wired = false;

  onChange(listener: UpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): UpdateState {
    return {
      phase: this.phase,
      currentVersion: this.currentVersion,
      availableVersion: this.availableVersion,
      notes: this.notes,
      notesUrl: this.notesUrl,
      lastCheckedAt: this.lastCheckedAt,
      downloadProgress: this.downloadProgress,
      error: this.error,
    };
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }

  private setPhase(phase: UpdatePhase): void {
    this.phase = phase;
    this.emit();
  }

  start(): void {
    if (!this.supported) return;
    this.wireUpdater();
    this.applyAutoCheck();
    if (this.prefs.autoCheck) void this.check();
  }

  dispose(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.checkTimer = null;
    this.retryTimer = null;
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
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.checkTimer = null;
    if (this.prefs.autoCheck) {
      this.checkTimer = setInterval(() => void this.check(), AUTO_CHECK_INTERVAL_MS);
    }
  }

  async check(): Promise<void> {
    if (!this.supported || this.phase === 'checking' || this.phase === 'downloading' || this.phase === 'ready') {
      return;
    }
    this.wireUpdater();
    this.error = null;
    this.setPhase('checking');
    try {
      await autoUpdater.checkForUpdates();
      this.lastCheckedAt = Date.now();
      this.clearRetry();
      if (this.phase !== 'available') this.setPhase('idle');
    } catch {
      this.error = 'update-check-failed';
      this.setPhase('error');
      this.scheduleRetry();
    }
  }

  async download(): Promise<void> {
    if (!this.supported || this.phase !== 'available') return;
    this.wireUpdater();
    this.error = null;
    this.downloadProgress = 0;
    this.setPhase('downloading');
    try {
      await autoUpdater.downloadUpdate();
    } catch {
      this.error = 'update-download-failed';
      this.setPhase('error');
      this.scheduleRetry();
    }
  }

  restart(): void {
    if (!this.supported || this.phase !== 'ready') return;
    autoUpdater.quitAndInstall(false, true);
  }

  async openNotes(): Promise<void> {
    await shell.openExternal(RELEASES_URL);
  }

  private wireUpdater(): void {
    if (this.wired) return;
    this.wired = true;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on('checking-for-update', () => {
      if (this.phase !== 'downloading' && this.phase !== 'ready') this.setPhase('checking');
    });
    autoUpdater.on('update-available', (info) => this.onAvailable(info));
    autoUpdater.on('update-not-available', () => {
      this.lastCheckedAt = Date.now();
      this.availableVersion = null;
      this.notes = null;
      this.downloadProgress = null;
      this.setPhase('idle');
    });
    autoUpdater.on('download-progress', (progress) => {
      this.downloadProgress = Math.max(0, Math.min(100, progress.percent));
      this.setPhase('downloading');
    });
    autoUpdater.on('update-downloaded', (info) => {
      this.availableVersion = info.version;
      this.notes = releaseNotes(info);
      this.downloadProgress = 100;
      this.error = null;
      this.setPhase('ready');
    });
    autoUpdater.on('error', () => {
      this.error = 'update-error';
      this.setPhase('error');
      this.scheduleRetry();
    });
  }

  private onAvailable(info: UpdateInfo): void {
    this.availableVersion = info.version;
    this.notes = releaseNotes(info);
    this.notesUrl = RELEASES_URL;
    this.lastCheckedAt = Date.now();
    this.downloadProgress = null;
    this.setPhase('available');
    if (this.prefs.autoDownload) void this.download();
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.check();
    }, ERROR_RETRY_MS);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
