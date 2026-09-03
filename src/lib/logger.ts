/**
 * Development logging.
 *
 * Silent in release builds. Auth code runs through paths that are awkward to
 * step through in a debugger — a native sheet, a silent refresh on a timer, a
 * websocket reconnect — so it needs to be able to say what it is doing without
 * that ending up in a shipped binary.
 *
 * Never pass a token, an authorization header, or anything else that would
 * authenticate a request. `redact` is here for the cases where the shape of a
 * value is the useful part.
 */

const enabled = __DEV__;

export const log = {
  debug(scope: string, message: string, detail?: unknown): void {
    if (enabled) {
      console.log(`[${scope}] ${message}`, detail ?? '');
    }
  },
  warn(scope: string, message: string, detail?: unknown): void {
    if (enabled) {
      console.warn(`[${scope}] ${message}`, detail ?? '');
    }
  },
  error(scope: string, message: string, detail?: unknown): void {
    // Errors survive into release: a crash reporter needs something to attach
    // to, and these carry no credential material.
    console.error(`[${scope}] ${message}`, detail ?? '');
  },
};

/** Describes a secret without disclosing it — `"present (1103 chars)"`. */
export function redact(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return 'absent';
  }
  return `present (${value.length} chars)`;
}
