import * as Linking from 'expo-linking';

import { log } from '@/lib/logger';

const SCOPE = 'reader-link';

/**
 * A link written into a PDF.
 *
 * A PDF is a file somebody else wrote. `enableAnnotationRendering` is on —
 * links are legitimate content and a document with dead cross-references is a
 * worse document — so the guard is here: nothing opens without the reader
 * seeing where it goes, over a scheme worth opening, to a host that is what it
 * looks like.
 *
 * ## Why this does not lean on `URL`
 *
 * It parses with `URL`, and it decides with its own rules, because the two
 * candidate parsers disagree and neither is sufficient.
 *
 * React Native ships a homemade `URL` whose constructor never validates a
 * single-argument call and whose every getter is a regex over the raw string.
 * Expo overwrites it: `expo/src/Expo.fx.tsx` imports `./winter` as its first
 * statement, and that installs `whatwg-url-minimum`. So this app gets a real
 * WHATWG parser — and that package's own README says it *"drops
 * punycode/unicode support"*.
 *
 * No IDNA is the part that matters, because the host is the entire security
 * control here. `https://аpple.com` with a Cyrillic `а` keeps its Cyrillic host
 * through parsing and renders identically to `apple.com` in the dialog whose
 * whole purpose is letting somebody judge the host. A real `URL` would have
 * shown `xn--pple-43d.com`.
 *
 * So the host is validated rather than trusted: printable ASCII only, and only
 * the characters a hostname is allowed to contain. A citation link in a
 * document is ASCII. A lookalike is not.
 *
 * ## The rules
 *
 * **Printable ASCII, before parsing.** One check that closes homographs, a
 * right-to-left override reversing the displayed host, and a newline or tab
 * clipping it — all of which are attacks on the *display* and survive any
 * parser.
 *
 * **`https:` only**, compared case-insensitively. An allowlist of one scheme,
 * not a blocklist of `javascript:` and `data:` — a blocklist is a list of the
 * attacks somebody thought of. One scheme also covers `file:` and `content:`,
 * the interesting ones given this app registers itself as a handler for both.
 *
 * **No credentials.** `https://x@paypal.com@evil.com` goes to `evil.com`, and
 * userinfo has no business in a link a document offers a reader.
 *
 * **A bounded host.** 253 characters, labels of 63, which is what DNS allows —
 * and it stops `paypal.com.aaa…evil.com` from being a host that displays as
 * `paypal.com…`. The dialog also ellipsises from the head, so the rightmost
 * labels, which are the ones that decide trust, are the ones always shown.
 */

/** What the reader is asked to confirm. */
export type PdfLink = {
  /** Validated: lowercase, ASCII, DNS-shaped. What the sentence leads with. */
  host: string;
  /** Rebuilt from validated parts, never the string the document supplied. */
  url: string;
};

/** Long enough for a real citation URL, short enough not to be a payload. */
const URL_MAX = 2048;

/** Space through `~`. Excludes every control character and everything non-ASCII. */
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

/** What DNS allows, and nothing that merely looks like it. */
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const HOST_MAX = 253;
const LABEL_MAX = 63;

function hostIsSane(host: string): boolean {
  if (host.length === 0 || host.length > HOST_MAX || !HOST.test(host)) {
    return false;
  }
  return host.split('.').every((label) => label.length > 0 && label.length <= LABEL_MAX);
}

/**
 * Reads a link out of a document, or refuses it.
 *
 * Returns `null` rather than throwing: a bad link is a thing documents contain,
 * not an error condition, and the reader should carry on reading.
 */
export function readPdfLink(raw: string): PdfLink | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > URL_MAX) {
    return null;
  }
  // Before parsing, so a control character cannot reach the parser and a
  // non-ASCII character cannot reach the dialog.
  if (!PRINTABLE_ASCII.test(raw) || raw.includes('\\')) {
    log.debug(SCOPE, 'refused a link that was not printable ASCII');
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol.toLowerCase() !== 'https:') {
    log.debug(SCOPE, 'refused a link over an unsupported scheme');
    return null;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    log.debug(SCOPE, 'refused a link carrying credentials');
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!hostIsSane(host)) {
    log.debug(SCOPE, 'refused a link to a host that is not a hostname');
    return null;
  }

  // Rebuilt rather than passed through: the host shown and the host visited are
  // then the same string by construction, not by the parser agreeing with the
  // one that runs next.
  const port = parsed.port === '' ? '' : `:${parsed.port}`;
  const url = `https://${host}${port}${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (url.length > URL_MAX) {
    return null;
  }
  return { host, url };
}

/**
 * Hands a confirmed link to the browser.
 *
 * Only ever called with a `PdfLink` the reader has agreed to, and only ever
 * with `link.url` — which `readPdfLink` built out of parts it checked.
 */
export async function openPdfLink(link: PdfLink): Promise<void> {
  try {
    await Linking.openURL(link.url);
  } catch (error) {
    // No browser, or the system refused. Nothing a reader could act on, and
    // failing to leave the app is not a failure to read the book.
    log.debug(SCOPE, 'could not open a link', error);
  }
}
