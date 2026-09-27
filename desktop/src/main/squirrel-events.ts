import { app } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * Windows "Open With" file association for `.pdf`, and the Squirrel install-time
 * lifecycle that maintains it.
 *
 * Windows 10+ forbids an app from programmatically seizing the *default* handler
 * for an extension — that stays the user's explicit choice in Settings. What an
 * app may do is register itself as an *available* handler: a ProgId under
 * `HKCU\Software\Classes` plus an entry in the extension's `OpenWithProgids`
 * list. That is exactly what puts "Pidom" in the right-click "Open with" menu and
 * the "Choose another app" dialog, without hijacking anything.
 *
 * Everything here writes only under `HKCU` (per-user, no elevation) and only ever
 * touches keys namespaced to our own ProgId, so uninstall removes precisely what
 * install added. On any non-Windows platform every function is an inert no-op.
 */

/** Our private ProgId. Namespaced so nothing here collides with another app's. */
const PROG_ID = 'Pidom.Document.pdf';

const CLASSES = 'HKCU\\Software\\Classes';
const PROG_ID_KEY = `${CLASSES}\\${PROG_ID}`;
const OPEN_WITH_KEY = `${CLASSES}\\.pdf\\OpenWithProgids`;

const run = promisify(execFile);

/** True only on Windows; every registry action short-circuits elsewhere. */
function isWindows(): boolean {
  return process.platform === 'win32';
}

/** Invokes `reg.exe` with the given args, resolving to its exit success. Never
 *  throws — a registry call that fails leaves the association simply absent. */
async function reg(args: string[]): Promise<boolean> {
  try {
    await run('reg.exe', args, { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** The command Windows runs to open a `.pdf` with Pidom: the app exe, then the
 *  file path as its first argument. Re-registered on update so a new versioned
 *  install directory is always reflected. */
function openCommand(): string {
  return `"${process.execPath}" "%1"`;
}

/** Registers the ProgId and adds it to `.pdf`'s available-handlers list. Returns
 *  whether the association is present afterwards. */
export async function registerAssociation(): Promise<boolean> {
  if (!isWindows()) return false;
  await reg(['add', PROG_ID_KEY, '/ve', '/d', 'Pidom PDF Document', '/f']);
  await reg(['add', `${PROG_ID_KEY}\\DefaultIcon`, '/ve', '/d', `${process.execPath},0`, '/f']);
  await reg(['add', `${PROG_ID_KEY}\\shell\\open\\command`, '/ve', '/d', openCommand(), '/f']);
  await reg(['add', OPEN_WITH_KEY, '/v', PROG_ID, '/t', 'REG_NONE', '/d', '', '/f']);
  return getPdfAssociation();
}

/** Removes every key and value this module added. Idempotent. Returns whether the
 *  association is present afterwards (false when the removal succeeded). */
export async function unregisterAssociation(): Promise<boolean> {
  if (!isWindows()) return false;
  await reg(['delete', OPEN_WITH_KEY, '/v', PROG_ID, '/f']);
  await reg(['delete', PROG_ID_KEY, '/f']);
  return getPdfAssociation();
}

/** Whether Pidom is currently registered as an available `.pdf` handler. */
export async function getPdfAssociation(): Promise<boolean> {
  if (!isWindows()) return false;
  return reg(['query', OPEN_WITH_KEY, '/v', PROG_ID]);
}

/** Toggles the association on or off, returning the resulting state. Drives the
 *  Settings toggle; the Squirrel lifecycle uses the register/unregister pair. */
export async function setPdfAssociation(on: boolean): Promise<boolean> {
  return on ? registerAssociation() : unregisterAssociation();
}

/**
 * Handles the Squirrel install lifecycle events Windows passes on the command
 * line, maintaining the file association alongside the shortcuts
 * `electron-squirrel-startup` manages. Returns true when an event was handled and
 * the process should quit immediately (install/uninstall are one-shot and must
 * not go on to open a window). Always false on non-Windows or a normal launch.
 */
export function handleSquirrelAssociation(): boolean {
  if (!isWindows()) return false;
  const arg = process.argv[1];
  switch (arg) {
    case '--squirrel-install':
    case '--squirrel-updated':
      // Fire-and-forget: the process is quit by electron-squirrel-startup; give
      // the registry write a beat to land before exit.
      void registerAssociation().finally(() => setTimeout(() => app.quit(), 300));
      return true;
    case '--squirrel-uninstall':
      void unregisterAssociation().finally(() => setTimeout(() => app.quit(), 300));
      return true;
    case '--squirrel-obsolete':
      return true;
    default:
      return false;
  }
}
