import { z } from 'zod';

/**
 * Pure, dependency-free version helpers for the updater. Kept out of
 * `update-service.ts` so they can be unit-tested without booting Electron.
 *
 * Detection itself is decided by the server: `update.electronjs.org` returns
 * `204` when up to date and `200 { name, notes, url }` when an update exists
 * (it runs `semver.lte` server-side). These helpers only (a) re-verify that an
 * advertised version is genuinely newer — defence against a misconfigured feed
 * advertising the same or an older build — and (b) parse the untrusted feed
 * JSON into a bounded, typed shape before any of it reaches the UI.
 */

/** A dotted numeric version like `1.2.0`. Prerelease/build metadata is ignored
 *  (the feed serves only stable, non-prerelease releases). */
const VERSION_RE = /\b(\d+)\.(\d+)\.(\d+)\b/;

/**
 * Compares two dotted versions numerically. Returns -1 if `a < b`, 1 if
 * `a > b`, 0 if equal. Non-numeric or missing segments compare as 0, so a
 * malformed string never throws — it simply sorts as `0.0.0`.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseParts(a);
  const pb = parseParts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

/** True when `candidate` is a strictly newer version than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

function parseParts(v: string): [number, number, number] {
  const m = VERSION_RE.exec(v);
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Best-effort extraction of a `x.y.z` version from the feed's `name` (a release
 * title such as "Pidom Desktop 1.2.0") or, failing that, its asset `url`
 * (…/pidom-1.2.0-full.nupkg). Returns null when neither carries one — the UI
 * then says "a new version is available" without a number rather than inventing one.
 */
export function extractVersion(name: string | null, url: string | null): string | null {
  for (const source of [name, url]) {
    if (!source) continue;
    const m = VERSION_RE.exec(source);
    if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  }
  return null;
}

/**
 * The shape of an `update.electronjs.org` 200 response. Every field is bounded
 * and optional-tolerant: `notes` is release-body text that we render as PLAIN
 * text (never HTML/markdown), so it is length-capped here to keep a hostile or
 * oversized release body from bloating the pushed state. `url` is parsed but not
 * surfaced — the "What's new" link is built from a hardcoded github.com URL.
 */
export const ProbeResponseSchema = z.object({
  name: z.string().max(200).nullish(),
  notes: z.string().max(20_000).nullish(),
  url: z.string().max(4096).nullish(),
});

export type ProbeResponse = z.infer<typeof ProbeResponseSchema>;

/** Parses raw feed JSON into a typed shape, or null if it does not match. */
export function parseProbeResponse(raw: unknown): ProbeResponse | null {
  const result = ProbeResponseSchema.safeParse(raw);
  return result.success ? result.data : null;
}
