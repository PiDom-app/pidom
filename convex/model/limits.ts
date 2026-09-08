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

/** `application/vnd.openxmlformats-officedocument.wordprocessingml.document` is 71. */
export const MIME_TYPE_MAX = 128;

/** Items per home rail. The rail shows four and scrolls a few more. */
export const RAIL_LIMIT = 12;
/** Collections on the home screen. Past this, the all-library screen is the answer. */
export const COLLECTION_LIMIT = 12;
/** Covers in a collection tile's mosaic. */
export const COLLECTION_COVER_LIMIT = 4;

/** Search results. Convex scans at most 1024 documents per search query anyway. */
export const SEARCH_LIMIT = 25;
/** Terms past this are noise; Convex caps a search expression at 16 words. */
export const SEARCH_TERM_MAX = 120;

/** No PDF has more pages than this, and a bad client should not claim one does. */
export const PAGE_COUNT_MAX = 100_000;

/**
 * Past this many pages the reader stops offering a thumbnail strip and offers
 * the scrubber alone.
 *
 * A thumbnail is a live PDF render, so a strip is a handful of native views
 * being recycled as it scrolls — fine over a few hundred pages, and a way to
 * spend a second of a reader's time scrolling past nothing over a few thousand.
 * The scrubber reaches any page in one drag regardless of length, so nothing is
 * lost past the cap.
 *
 * Here rather than in the client because the reader and the artboards both
 * quote it, and a number in two places is a number that disagrees with itself.
 */
export const THUMBNAIL_PAGE_MAX = 1_200;

/**
 * How far the renderer's own pinch is allowed to go.
 *
 * `react-native-pdf` defaults to 3, which is not enough to read a footnote on a
 * scan. 4 is, and past it a page is a texture rather than text.
 */
export const READER_ZOOM_MAX = 4;

/**
 * How long the reader waits before telling the server where somebody got to.
 *
 * A write per page turn is a write per swipe, replicated to every device the
 * account owns and re-running the home query on all of them. Fifteen seconds is
 * long enough that ordinary reading produces almost none, and short enough that
 * a phone that dies mid-chapter loses one paragraph rather than one chapter.
 * The local write is not debounced this far — see `use-reader-session.ts`.
 */
export const PROGRESS_DEBOUNCE_MS = 15_000;

/**
 * A jump big enough to write immediately rather than wait out the debounce.
 *
 * Somebody who taps a Contents entry has moved deliberately, and losing that to
 * a force-quit inside the debounce window would lose the one page they went
 * looking for. Ten pages is past what any amount of swiping does in a moment.
 */
export const PROGRESS_JUMP_PAGES = 10;

/**
 * A bookmark's own name.
 *
 * Shorter than a document title, because it is a line in a list beside a page
 * number and anything longer is ellipsis. Most bookmarks will have none at all.
 */
export const BOOKMARK_LABEL_MAX = 120;

/**
 * How many pages one document can have marked.
 *
 * Generous for the thing it is — somebody working through a textbook marks
 * tens, not hundreds — and low enough that the list is one bounded read the
 * reader renders without paging. Past it the answer is Contents, not more
 * bookmarks.
 */
export const BOOKMARKS_PER_DOCUMENT = 200;

/**
 * A passage kept out of a document.
 *
 * Deliberately a quarter of `PAGE_TEXT_MAX`. A selection can reach a whole
 * page — `selection-bar.ts` truncates to `PAGE_TEXT_MAX` before the clipboard
 * — and a whole page stored per row is a book in a list of two-line items. Two
 * thousand characters is several paragraphs, which is longer than anything
 * anybody quotes on purpose.
 */
export const ANNOTATION_TEXT_MAX = 2_000;

/**
 * What the reader wrote about it.
 *
 * The same bound as the passage, because a note about a paragraph is
 * occasionally longer than the paragraph. Anything past this is a document of
 * its own and Pidom is not a place to write one.
 */
export const ANNOTATION_NOTE_MAX = 2_000;

/**
 * How many one document can hold.
 *
 * Higher than the bookmark ceiling because these are made while reading rather
 * than to come back to: somebody working through a textbook marks tens of pages
 * and quotes hundreds of lines. Still low enough that the list is one bounded
 * read the reader renders without paging, and low enough that the cascade
 * clears in one mutation.
 */
export const ANNOTATIONS_PER_DOCUMENT = 500;

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

/* ── processing ──────────────────────────────────────────────────────── */

/**
 * Entries kept from a document's table of contents.
 *
 * `react-native-pdf` hands back whatever the PDF declares, and a PDF can
 * declare a bookmark per paragraph. 500 covers a textbook's every section and
 * still fits one Convex document with room to spare.
 */
export const OUTLINE_ENTRY_MAX = 500;

/**
 * Nesting kept, as a depth rather than a tree.
 *
 * Three levels is part, chapter, section. A fourth is indented off the side of
 * a 390px sheet, so it is flattened into the third rather than rendered.
 */
export const OUTLINE_DEPTH_MAX = 3;

/** One line of a Contents sheet, at the size the sheet sets. */
export const OUTLINE_TITLE_MAX = 200;

/**
 * The largest document the server will parse for text.
 *
 * A Node action gets 512 MiB, and pdf.js holds several multiples of a file's
 * size while parsing it — so this is well under `CLOUD_BYTE_MAX` on purpose.
 * A document past this syncs and downloads exactly as before; it is only its
 * text that is not extracted, and `textStatus` says so.
 */
export const EXTRACT_BYTE_MAX = 32 * 1024 * 1024;

/** Pages parsed. Past this the document is a data dump, not something read. */
export const EXTRACT_PAGE_MAX = 2_000;

/**
 * How long extraction gets before it is abandoned.
 *
 * unpdf's serverless build parses on the event loop with no worker to kill, so
 * a malformed PDF that sends it spinning cannot be interrupted — only outlived.
 * A Node action's own ceiling is ten minutes, which is nine and a half minutes
 * of a compute bill for a file that is never going to parse.
 */
export const EXTRACT_TIMEOUT_MS = 120_000;

/**
 * Text kept per page.
 *
 * A Convex document caps at 1 MiB, and a page carrying more than 8 KB of text
 * is a table of figures nobody searches by phrase. Truncated rather than
 * refused: most of a page still finds the page.
 */
export const PAGE_TEXT_MAX = 8 * 1024;

/** Pages written per mutation. A mutation writes 16 MiB and 16,000 documents. */
export const PAGE_BATCH = 50;

/**
 * Pages one mutation will delete in a pass.
 *
 * Deleting reads first, and a page holds up to `PAGE_TEXT_MAX`, so 400 of them
 * is around 3 MB against a mutation's 16 MiB read budget — headroom, rather
 * than a number chosen to sit on the edge. A book longer than this is finished
 * by the nightly prune, which is what a nightly prune is for.
 */
export const PAGE_DELETE_BUDGET = 400;

/**
 * Documents the nightly prune clears in one run.
 *
 * It drains `pagePruneQueue`, so every one of these is a document that really
 * does have text to clear — nothing is spent looking. Four of them at
 * `PAGE_DELETE_BUDGET` each is around 12 MB of reads against a mutation's
 * 16 MiB, which is the ceiling this number is set by.
 */
export const PRUNE_DOCUMENTS = 4;

/**
 * Finished workflows whose journals the nightly cleanup drops.
 *
 * The workflow component keeps a completed run's step journal until something
 * calls `cleanup`, and Pidom starts one per document per sync — so this is the
 * only thing standing between the component's tables and unbounded growth.
 * Fifty a night stays well ahead of any realistic import rate.
 */
export const WORKFLOW_CLEANUP_LIMIT = 50;

/** Characters either side of a search hit, for the line under the page number. */
export const SNIPPET_CHARS = 90;

/**
 * Pages the device pulls per request when mirroring text for offline search.
 *
 * A function returns 16 MiB and a page holds up to `PAGE_TEXT_MAX`, so 100 is
 * around 800 KB — a comfortable request on mobile data, and a 600-page book in
 * six of them. The mirror runs once per document and never again.
 */
export const PAGE_MIRROR_BATCH = 100;

/**
 * How long a job may claim to be running before the nightly sweep re-drives it.
 *
 * A Node action's own ceiling is ten minutes, so anything still `running` an
 * hour later is a job whose process died without ever writing a terminal state.
 */
export const JOB_STALE_MS = 60 * 60 * 1000;

/**
 * Extractions the nightly re-drive restarts in one run.
 *
 * Each one starts a workflow, and the workflow's pool runs four at a time — so
 * restarting a hundred at three in the morning would queue work into the
 * following afternoon and put a hundred scheduled functions in one mutation.
 * Twenty a night clears any realistic backlog within a week.
 */
export const JOB_SWEEP_LIMIT = 20;

/**
 * Rows the nightly orphan sweep looks at per run.
 *
 * A mutation gets one second. This keeps the sweep inside it whatever the
 * deployment holds; anything past the limit is swept on a later night rather
 * than timing the whole thing out.
 */
export const SWEEP_LIMIT = 2_000;

/* ── sharing ─────────────────────────────────────────────────────────── */

/**
 * A line to the person you are sharing with.
 *
 * Not a message thread. It is one field on one screen, read once beside the
 * document it arrived with, and anything past a short paragraph is a
 * conversation Pidom is not the place for.
 */
export const SHARE_MESSAGE_MAX = 500;

/**
 * The name somebody can be found by.
 *
 * Long enough for a real name plus a disambiguator, short enough to sit beside
 * a display name on a 390px row without becoming an ellipsis. The character
 * class is narrower than the length: lowercase, digits and underscore only, so
 * two handles cannot differ by an invisible character or by case alone.
 */
export const HANDLE_MAX = 24;
export const HANDLE_MIN = 3;
export const HANDLE_PATTERN = /^[a-z0-9_]+$/;

/** A group name is a row label, not a title. Shorter than a collection's. */
export const GROUP_NAME_MAX = 60;

/**
 * People in one group.
 *
 * Sharing with a group fans out to every member, so this is the real bound on
 * how much work one tap can create. Two hundred is a department; past it the
 * answer is several groups, not a bigger one — and the fan-out stays inside a
 * workflow that pages at `SHARE_FANOUT_BATCH` rather than one mutation.
 */
export const GROUP_MEMBER_MAX = 200;

/** Groups one account can own. The list is read unpaged, so it has to fit one screen's worth of scrolling. */
export const GROUPS_PER_OWNER = 30;

/**
 * People and groups one document can be shared with.
 *
 * The Manage Access list is one bounded read, the same way the bookmark list
 * is. A document that needs more than two hundred grants wants a group.
 */
export const SHARES_PER_DOCUMENT = 200;

/**
 * Shares one account can hold out at once, across every document.
 *
 * The bound the per-document limit does not give: two hundred documents each
 * shared with two hundred people is forty thousand rows from one account. This
 * is checked on create, against the sender rather than the document.
 */
export const SHARES_PER_OWNER = 2_000;

/** Rows the inbox and Manage Access read. Both are lists somebody scrolls, not archives. */
export const SHARE_LIST_LIMIT = 100;

/** Results a people or group search returns. Same reasoning as `SEARCH_LIMIT`. */
export const DISCOVERY_LIMIT = 20;

/**
 * The shortest prefix that will run a within-graph name search.
 *
 * Two characters over a group of two hundred is the whole group, which is a
 * listing rather than a search. Exact handle and email lookups have no minimum
 * — they are already exact.
 */
export const DISCOVERY_PREFIX_MIN = 2;

/**
 * Members walked per step of the group fan-out.
 *
 * Each one is a `documentShares` insert plus a `shareEvents` insert, so this is
 * fifty writes against a mutation's budget with room to spare — and a workflow
 * step that fails is retried at this size rather than restarting a group of
 * two hundred.
 */
export const SHARE_FANOUT_BATCH = 25;

/* ── notifications ───────────────────────────────────────────────────── */

/**
 * Messages per request to the Expo Push Service.
 *
 * Their number, not ours: the API accepts an array of at most 100 message
 * objects. Sending them one at a time would also walk straight into the
 * project-level ceiling of 600 notifications per second.
 */
export const PUSH_BATCH = 100;

/**
 * How long to wait before asking Expo whether a notification actually arrived.
 *
 * Their guidance is roughly fifteen minutes. Asking sooner returns nothing and
 * spends a request; not asking at all means a dead token is never noticed and
 * every later send to it is wasted.
 */
export const PUSH_RECEIPT_DELAY_MS = 15 * 60 * 1000;

/** Receipts fetched per poll. The same 100 the send call takes. */
export const PUSH_RECEIPT_BATCH = 100;

/**
 * Devices one account can have registered.
 *
 * A phone, a tablet, a spare, and room for reinstalls that minted a new token
 * before the old one was reported dead. Past this the oldest `lastSeenAt` is
 * dropped, because an account accumulating tokens is an account whose old ones
 * are not being cleaned up by the receipt poll.
 */
export const DEVICE_TOKENS_PER_USER = 10;

/** An `ExpoPushToken[…]` is about 41 characters. This refuses anything that is not one. */
export const PUSH_TOKEN_MAX = 200;

/**
 * Shares the hourly sweep expires per run.
 *
 * Each one is a patch on a row nobody is reading, and the sweep is the read
 * path's enforcement rather than the write path's — so it wants to be well
 * ahead of any realistic rate of expiry rather than exhaustive in one pass.
 * Two hundred an hour is far past what a deployment of readers produces.
 */
export const SHARE_EXPIRY_SWEEP = 200;

/**
 * Delivery rows the nightly prune drops.
 *
 * Reads first, then deletes, against a mutation's one-second budget. Five
 * hundred rows a night stays ahead of one account's notifications by orders of
 * magnitude, and a backlog is cleared over several nights rather than by a
 * mutation that does not finish.
 */
export const DELIVERY_PRUNE_LIMIT = 500;

/* ── presence ────────────────────────────────────────────────────────── */

/**
 * How often a device says it is still here.
 *
 * The component's own default. Named here because the client passes it and the
 * server checks it: a client asking for a one-second heartbeat would be asking
 * this deployment to run a mutation per second per open document.
 */
export const PRESENCE_INTERVAL_MS = 10_000;

/** The narrowest heartbeat the server will accept, whatever a client asks for. */
export const PRESENCE_INTERVAL_MIN_MS = 5_000;

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
