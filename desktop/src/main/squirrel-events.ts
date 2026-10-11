import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * Windows "Open With" file association for supported document formats.
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
const PROG_ID = 'Pidom.Document';

const SUPPORTED_EXTENSIONS = [
  'pdf', 'txt', 'text', 'log', 'md', 'markdown', 'html', 'htm', 'epub', 'doc', 'docx', 'odt',
  'rtf', 'csv', 'xls', 'xlsx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'avif',
] as const;

const CLASSES = 'HKCU\\Software\\Classes';
const PROG_ID_KEY = `${CLASSES}\\${PROG_ID}`;
function openWithKey(extension: string): string {
  return `${CLASSES}\\.${extension}\\OpenWithProgids`;
}

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

/** The command Windows runs to open a supported document with Pidom: the app exe, then the
 *  file path as its first argument. Re-registered on update so a new versioned
 *  install directory is always reflected. */
function openCommand(): string {
  return `"${process.execPath}" "%1"`;
}

/** Registers the ProgId and adds it to every supported extension's available-handlers list. */
export async function registerAssociation(): Promise<boolean> {
  if (!isWindows()) return false;
  await reg(['add', PROG_ID_KEY, '/ve', '/d', 'Pidom Document', '/f']);
  await reg(['add', `${PROG_ID_KEY}\\DefaultIcon`, '/ve', '/d', `${process.execPath},0`, '/f']);
  await reg(['add', `${PROG_ID_KEY}\\shell\\open\\command`, '/ve', '/d', openCommand(), '/f']);
  await Promise.all(
    SUPPORTED_EXTENSIONS.map((extension) =>
      reg(['add', openWithKey(extension), '/v', PROG_ID, '/t', 'REG_NONE', '/d', '', '/f']),
    ),
  );
  return getDocumentAssociation();
}

/** Removes every key and value this module added. Idempotent. Returns whether the
 *  association is present afterwards (false when the removal succeeded). */
export async function unregisterAssociation(): Promise<boolean> {
  if (!isWindows()) return false;
  await Promise.all(
    SUPPORTED_EXTENSIONS.map((extension) =>
      reg(['delete', openWithKey(extension), '/v', PROG_ID, '/f']),
    ),
  );
  await reg(['delete', PROG_ID_KEY, '/f']);
  return getDocumentAssociation();
}

/** Whether Pidom is currently registered as an available handler for supported formats. */
export async function getDocumentAssociation(): Promise<boolean> {
  if (!isWindows()) return false;
  const results = await Promise.all(
    SUPPORTED_EXTENSIONS.map((extension) => reg(['query', openWithKey(extension), '/v', PROG_ID])),
  );
  return results.some(Boolean);
}

/** Toggles the association on or off, returning the resulting state. Drives the
 *  Settings toggle. */
export async function setDocumentAssociation(on: boolean): Promise<boolean> {
  return on ? registerAssociation() : unregisterAssociation();
}

/** Backwards-compatible names for the existing IPC service. */
export const getPdfAssociation = getDocumentAssociation;
export const setPdfAssociation = setDocumentAssociation;
