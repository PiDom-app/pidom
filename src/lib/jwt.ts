/**
 * Reads the `exp` claim out of a Google ID token.
 *
 * This decodes; it does not verify. Verification is Convex's job — it checks
 * the signature against Google's JWKS and the audience against the pinned
 * client ID. Nothing here should ever be treated as proof of anything. The
 * single use is scheduling: knowing when a token goes stale so the app can
 * refresh ahead of expiry instead of waiting for the backend to reject it
 * mid-query.
 *
 * A token that fails to parse is reported as expired. Anything unreadable is
 * not something to send to the backend, and refreshing is the cheap, safe
 * response.
 */

/** Refresh this far before `exp`, to cover clock skew and a slow round trip. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

function decodeBase64Url(segment: string): string | null {
  // JWT uses base64url; `atob` wants standard base64 with padding. Hermes has
  // provided `atob` since RN 0.74.
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  try {
    return atob(padded);
  } catch {
    return null;
  }
}

/** The token's expiry in epoch milliseconds, or `null` if it cannot be read. */
export function readExpiry(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const payload = decodeBase64Url(parts[1]);
  if (payload === null) {
    return null;
  }

  try {
    const claims: unknown = JSON.parse(payload);
    if (typeof claims !== 'object' || claims === null) {
      return null;
    }
    const exp = (claims as { exp?: unknown }).exp;
    // `exp` is seconds since the epoch, per RFC 7519.
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Whether a token should be replaced before it is used again.
 *
 * True for an unparseable token, and true from `margin` before the real expiry
 * rather than at it.
 */
export function isExpiring(token: string, margin = TOKEN_REFRESH_MARGIN_MS): boolean {
  const expiry = readExpiry(token);
  return expiry === null || expiry - margin <= Date.now();
}

/**
 * Whether a token is past its expiry outright, with no margin.
 *
 * The distinction from `isExpiring` matters after a refresh attempt: a token
 * inside the margin is fine to keep using, but one that is genuinely expired
 * means the refresh failed and the session is over.
 */
export function isExpired(token: string): boolean {
  return isExpiring(token, 0);
}
