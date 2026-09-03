import { ConvexError } from 'convex/values';

/**
 * The bounds the public surface enforces, in one place.
 *
 * `v.string()` accepts a megabyte and `v.number()` accepts `-1` and `Infinity`.
 * The validators on a public function prove a value is the right *type*; these
 * prove it is a usable *value*. Without them a client can write a title that
 * breaks every list it appears in, or a page number that puts the progress bar
 * off the end of its track.
 *
 * Every constant carries the reason for its number. A limit with no reason gets
 * raised the first time somebody hits it.
 */

/** Long enough for a real academic title, short enough to stay one row. */
export const TITLE_MAX = 300;
export const AUTHOR_MAX = 200;
/** A collection name has to fit a 148px tile in two lines at 13px. */
export const COLLECTION_NAME_MAX = 80;

/** Items per home rail. The rail shows four and scrolls a few more. */
export const RAIL_LIMIT = 12;
/** Collections on the home screen. Past this, the all-library screen is the answer. */
export const COLLECTION_LIMIT = 12;
/** Covers in a collection tile's mosaic. */
export const COLLECTION_COVER_LIMIT = 4;

/**
 * Ids `library.byIds` will answer for in one call.
 *
 * The device sends the ids it holds on disk. A library larger than this pages
 * through the all-library screen rather than asking for everything at once.
 */
export const IDS_MAX = 200;

/** Search results. Convex scans at most 1024 documents per search query anyway. */
export const SEARCH_LIMIT = 25;
/** Terms past this are noise; Convex caps a search expression at 16 words. */
export const SEARCH_TERM_MAX = 120;

/** No PDF has more pages than this, and a bad client should not claim one does. */
export const PAGE_COUNT_MAX = 100_000;

/**
 * The largest file the library will *record*. 512 MB — past this the device
 * would struggle to render it anyway.
 */
export const BYTE_SIZE_MAX = 512 * 1024 * 1024;

/**
 * The largest file the library will *carry*, which is a different number.
 *
 * This used to be 20 MiB, and that was Convex's number rather than a
 * preference: an HTTP action response is capped there on every plan, downloads
 * went through one, and a file that uploads but can never come back down is
 * worse than one honestly refused.
 *
 * Files live in Cloudflare R2 now, which has neither cap, so this is a product
 * decision again. 100 MB covers a scanned textbook and still leaves R2's 10 GB
 * free tier holding around a hundred documents — with no egress charge, which
 * is the part that used to make a second device expensive.
 */
export const CLOUD_BYTE_MAX = 100 * 1024 * 1024;

/**
 * How long a download URL stays valid.
 *
 * The component defaults to 900. A download starts the moment the URL arrives,
 * so the window has no reason to be wider than the act it authorises.
 */
export const DOWNLOAD_URL_SECONDS = 300;

/** A 600px JPEG has no business exceeding this. */
export const COVER_BYTE_MAX = 512 * 1024;

/**
 * Rows the nightly orphan sweep looks at per run.
 *
 * A mutation gets one second. This keeps the sweep inside it whatever the
 * deployment holds; anything past the limit is swept on a later night rather
 * than timing the whole thing out.
 */
export const SWEEP_LIMIT = 2_000;

/** Thrown when a value is the right type but not a usable one. */
export function invalid(message: string): never {
  throw new ConvexError({ code: 'INVALID', message });
}

/** C0 and C1 control characters. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** Zero-width space through right-to-left mark, line/paragraph separators, BOM. */
const INVISIBLE = /[\u200b-\u200f\u2028\u2029\u2060\ufeff]/g;

/**
 * Normalises reader-supplied text, or rejects it.
 *
 * Control characters become spaces and the zero-width run is dropped, rather
 * than either being rejected: they arrive in real PDF filenames and in
 * copy-paste, they are invisible, and refusing an import over a character
 * nobody can see would be its own bug. Length is checked after stripping, so
 * padding a title with zero-width joiners cannot get it past the limit.
 */
export function cleanText(value: string, max: number, field: string): string {
  const stripped = value
    .replace(CONTROL, ' ')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (stripped === '') {
    invalid(`${field} cannot be empty.`);
  }
  if (stripped.length > max) {
    invalid(`${field} is longer than ${max} characters.`);
  }
  return stripped;
}

/** The optional variant. An absent or all-whitespace value becomes `undefined`. */
export function cleanOptionalText(
  value: string | undefined,
  max: number,
  field: string,
): string | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  return cleanText(value, max, field);
}

/** Forces a number into range. `NaN` and `Infinity` land on `min`. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
