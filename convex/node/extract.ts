'use node';

import { v, type Infer } from 'convex/values';
import { NonRetryableError } from '@convex-dev/workpool';
import { getDocumentProxy, getMeta } from 'unpdf';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import { r2 } from '../r2';
import {
  AUTHOR_MAX,
  EXTRACT_BYTE_MAX,
  EXTRACT_PAGE_MAX,
  EXTRACT_PROGRESS_EVERY,
  EXTRACT_TIMEOUT_MS,
  PAGE_TEXT_MAX,
  TEXT_BYTE_MAX,
  TITLE_MAX,
} from '../model/limits';

/**
 * Reading a synced PDF's text out of the copy in R2.
 *
 * This is the one place in Pidom that parses a PDF on a server, and it exists
 * because it is the only place that can: the device holds the file, so the
 * device does the cover and the outline, and the server can only see a document
 * the reader chose to sync. That is also why `textStatus` is optional on the
 * row — a local-only document has no text status because nothing could give it
 * one.
 *
 * **`"use node"` is required**, not stylistic. `unpdf` ships Mozilla's PDF.js
 * built for serverless runtimes, and it wants Node built-ins the Convex runtime
 * does not have. The trade is real and worth naming: a Node action gets 512 MiB
 * and ten minutes against the Convex runtime's 64 MiB and thirty, and its
 * arguments cap at 5 MiB rather than 16.
 *
 * **The text never comes back through the return value.** It goes straight from
 * here into R2 as one object, because the workflow component caps a run's total
 * step arguments and returns at 1 MB and a 600-page book is far past that. What
 * comes back is counts.
 *
 * That object replaced a table. Page text used to be a row per page, each one
 * also copied into a search index that is metered separately and priced higher,
 * which put a few hundred books between the whole deployment and a full
 * database. One object per document, in a bucket with ten gigabytes free and no
 * egress charge, is the same text for a twentieth of the bill — and the search
 * it used to serve is answered by the FTS5 index on the reader's own device,
 * which works with no connection.
 *
 * **This parses a file Pidom did not write**, which is the whole security
 * posture below: no font machinery, a size bound, a page bound, and a timeout
 * the parse cannot outlive.
 */

/** What the action reports back to the workflow. Counts, never content. */
const resultValidator = v.object({
  /** Pages that carried text and went into the object. */
  written: v.number(),
  /** Pages the document has, as pdf.js counted them. */
  totalPages: v.number(),
  /** False for a scan: it parsed, and there was no text layer in it. */
  hasText: v.boolean(),
  /** Size of the stored object, or `null` when nothing was stored. */
  textBytes: v.union(v.number(), v.null()),
  /** From the PDF's own metadata, when it carries any worth having. */
  title: v.union(v.string(), v.null()),
  author: v.union(v.string(), v.null()),
});

export const extractText = internalAction({
  args: {
    documentId: v.id('documents'),
    /** Minted server-side in `library.uploadUrl`; never an argument the client set. */
    storageKey: v.string(),
    /** Minted server-side in `workflows.document.target`, from the row's own ids. */
    textStorageKey: v.string(),
    byteSize: v.number(),
  },
  returns: resultValidator,
  // The return type is annotated rather than inferred, and it has to be: this
  // action reaches for `internal` to mint a signed URL, `internal` includes
  // this action, and TypeScript cannot infer a type that refers to itself. It
  // gives up with `implicitly has type 'any'` — on the handler and on every
  // `await` inside it. `Infer` reads the shape off the validator that is
  // already the contract, so the two cannot drift.
  handler: async (ctx, args): Promise<Infer<typeof resultValidator>> => {
    if (args.byteSize > EXTRACT_BYTE_MAX) {
      // The workflow checks this too, from the row. This is the second check,
      // against the size the caller passed, and it exists because the value the
      // parse actually depends on should be bounded where the parse happens.
      //
      // `NonRetryableError` throughout this action: the pool retries three
      // times with backoff by default, and a file that is too large will still
      // be too large in forty seconds. Retrying a terminal answer is thirty
      // seconds of compute to reach it again.
      throw new NonRetryableError('TOO_LARGE');
    }

    const url = await ctx.runAction(internal.workflows.document.signedUrl, {
      storageKey: args.storageKey,
    });

    const response = await fetch(url);
    if (!response.ok) {
      // Retryable, and the one thing here that genuinely is: R2 refusing a
      // request, or a signed URL that expired between minting and use. A 404
      // is not — the object is gone, and it will still be gone next time.
      if (response.status === 404) {
        throw new NonRetryableError('OBJECT_MISSING');
      }
      throw new Error(`FETCH_FAILED_${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());

    // Everything past this point is parsing somebody else's file, so it all
    // runs inside one timeout. unpdf's serverless build parses on the event
    // loop with no worker to kill, so a PDF that sends pdf.js spinning cannot
    // be interrupted — only outlived.
    return await race(parse(ctx, args.documentId, args.textStorageKey, bytes), EXTRACT_TIMEOUT_MS);
  },
});

/** One page, under the shortest names that still read. */
type StoredPage = { p: number; t: string };

/**
 * The stored shape, versioned.
 *
 * `v` is there because the reader on the other end is an app store build that
 * may be months old by the time this changes. A device that does not recognise
 * a version can say so and re-mirror later, which is a far better failure than
 * silently parsing a shape it half understands.
 *
 * `p`/`t` rather than `page`/`text`: the names repeat once per page, and at two
 * thousand pages the long ones are twelve kilobytes of nothing.
 */
const FORMAT_VERSION = 1;

async function parse(
  ctx: ActionCtx,
  documentId: Id<'documents'>,
  textStorageKey: string,
  bytes: Uint8Array,
) {
  const pdf = await openDocument(bytes);

  const totalPages = pdf.numPages;
  if (totalPages > EXTRACT_PAGE_MAX) {
    throw new NonRetryableError('TOO_MANY_PAGES');
  }

  const meta = await getMeta(pdf).catch(() => null);
  const info = (meta?.info ?? {}) as { Title?: unknown; Author?: unknown };

  const pages: StoredPage[] = [];
  // Tracked as the pages accumulate rather than measured at the end, so a
  // pathological document is stopped while it is still cheap to stop. The
  // figure is the text alone; the JSON around it adds about fifteen bytes a
  // page, which `TEXT_BYTE_MAX` has room for.
  let textBytes = 0;

  for (let page = 1; page <= totalPages; page += 1) {
    // Page by page rather than `extractText(pdf)`, so the text of a 2,000-page
    // book is never all in memory at once and the Details sheet can say
    // "218 of 499" instead of spinning.
    const content = await (await pdf.getPage(page)).getTextContent();
    const raw = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, PAGE_TEXT_MAX);

    // An image-only page is skipped rather than stored empty, so the object
    // holds only pages a search could match and `written` still answers "how
    // many pages carry text".
    if (text !== '' && textBytes < TEXT_BYTE_MAX) {
      pages.push({ p: page, t: text });
      textBytes += text.length;
    }

    if (page % EXTRACT_PROGRESS_EVERY === 0) {
      await ctx.runMutation(internal.workflows.document.progress, {
        documentId,
        pagesDone: page,
        pagesTotal: totalPages,
      });
    }
  }

  /**
   * One write, at the end.
   *
   * `r2.store` rather than the raw S3 client underneath it, and that is a
   * deliberate constraint rather than convenience: `store` registers the object
   * in the component's own metadata table, which is what `listMetadata` walks
   * and therefore what the nightly sweep can see. An object written around it
   * is an object nothing can enumerate, which means nothing can ever collect
   * it — a permanent bill for a file no reader can reach.
   *
   * `immutable`, for a year, because it is: a re-extraction writes this key
   * again from scratch and a device fetches a book's text exactly once. And
   * `private`, because it is the reader's document content and a signed URL is
   * not an invitation for a proxy to keep a copy.
   */
  let stored: number | null = null;
  if (pages.length > 0) {
    const body = new TextEncoder().encode(
      JSON.stringify({ v: FORMAT_VERSION, pages } satisfies { v: number; pages: StoredPage[] }),
    );
    await r2.store(ctx, body, {
      key: textStorageKey,
      type: 'application/json',
      cacheControl: 'private, max-age=31536000, immutable',
    });
    stored = body.byteLength;
  }

  return {
    written: pages.length,
    totalPages,
    // A document that parsed and produced no text is a scan. That is a finished
    // answer — `textStatus: 'none'` — rather than a failure to retry.
    hasText: pages.length > 0,
    textBytes: stored,
    title: cleanMeta(info.Title, TITLE_MAX),
    author: cleanMeta(info.Author, AUTHOR_MAX),
  };
}

/**
 * Opens a PDF with everything a headless parser does not need switched off.
 *
 * `isEvalSupported: false` is conspicuously absent. That option existed to close
 * CVE-2024-4367, where pdf.js passed a font's `FontMatrix` straight to `eval()`.
 * `unpdf` 1.8.1 bundles pdf.js **6.1.200**, which removed the eval path
 * entirely — the shipped bundle contains no `eval(` and no `new Function(` at
 * all, and the option is no longer in `DocumentInitParameters`. Passing it would
 * be a flag that reads as protection and does nothing. What actually holds here
 * is the version, so an upgrade of `unpdf` is worth re-checking this against.
 *
 * The two failures below are classified rather than left to the pool's default
 * three attempts: neither an encrypted document nor a corrupt one becomes
 * readable in forty seconds.
 */
async function openDocument(bytes: Uint8Array) {
  try {
    return await getDocumentProxy(bytes, {
      // No font machinery. There is no display here, and a font program is one
      // more parser to hand a hostile document to, for text nobody looks at.
      useSystemFonts: false,
      disableFontFace: true,
      // An empty password rather than none: pdf.js throws `PasswordException`
      // instead of prompting for one, which is the answer a headless parser
      // wants. An encrypted document is refused at import — see
      // `document-probe.tsx` — so reaching that branch means one was encrypted
      // after it was added.
      password: '',
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'PasswordException') {
      throw new NonRetryableError('ENCRYPTED');
    }
    if (name === 'InvalidPDFException') {
      throw new NonRetryableError('CORRUPT');
    }
    throw error;
  }
}

/**
 * A PDF's own metadata, or nothing.
 *
 * Producers write junk into these fields constantly — a temp filename, the
 * name of the exporting application, a single space. Anything that is not a
 * usable string is dropped, and the filename-derived title the reader already
 * saw stands.
 */
function cleanMeta(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed === '' || trimmed.length > max) {
    return null;
  }
  // A title that is obviously a file path is the exporter's, not the author's.
  if (/[\\/]/.test(trimmed) && /\.(pdf|docx?|tex|indd)$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** Loses a race against the clock rather than running out a ten-minute budget. */
async function race<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        // Non-retryable: a document that sent pdf.js spinning for two minutes
        // will spin for two minutes again, and the pool's default is three
        // attempts. Six minutes of a Node action's ten-minute budget, to reach
        // the same answer.
        timer = setTimeout(() => reject(new NonRetryableError('TIMED_OUT')), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
