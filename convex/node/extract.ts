'use node';

import { v } from 'convex/values';
import { NonRetryableError } from '@convex-dev/workpool';
import { getDocumentProxy, getMeta } from 'unpdf';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import {
  AUTHOR_MAX,
  EXTRACT_BYTE_MAX,
  EXTRACT_PAGE_MAX,
  EXTRACT_TIMEOUT_MS,
  PAGE_BATCH,
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
 * **The text never comes back through the return value.** It is written to
 * `documentPages` a batch at a time from inside this action, because the
 * workflow component caps a run's total step arguments and returns at 1 MB and
 * a 600-page book is far past that. What comes back is counts.
 *
 * **This parses a file Pidom did not write**, which is the whole security
 * posture below: no font machinery, a size bound, a page bound, and a timeout
 * the parse cannot outlive.
 */

/** What the action reports back to the workflow. Counts, never content. */
const resultValidator = v.object({
  /** Pages that carried text and were written. */
  written: v.number(),
  /** Pages the document has, as pdf.js counted them. */
  totalPages: v.number(),
  /** False for a scan: it parsed, and there was no text layer in it. */
  hasText: v.boolean(),
  /** From the PDF's own metadata, when it carries any worth having. */
  title: v.union(v.string(), v.null()),
  author: v.union(v.string(), v.null()),
});

export const extractText = internalAction({
  args: {
    documentId: v.id('documents'),
    /** Minted server-side in `library.uploadUrl`; never an argument the client set. */
    storageKey: v.string(),
    byteSize: v.number(),
  },
  returns: resultValidator,
  handler: async (ctx, args) => {
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
    return await race(parse(ctx, args.documentId, bytes), EXTRACT_TIMEOUT_MS);
  },
});

async function parse(ctx: ActionCtx, documentId: Id<'documents'>, bytes: Uint8Array) {
  const pdf = await openDocument(bytes);

  const totalPages = pdf.numPages;
  if (totalPages > EXTRACT_PAGE_MAX) {
    throw new NonRetryableError('TOO_MANY_PAGES');
  }

  const meta = await getMeta(pdf).catch(() => null);
  const info = (meta?.info ?? {}) as { Title?: unknown; Author?: unknown };

  let written = 0;
  // Separate from `written`, because they answer different questions: `read` is
  // what the Details sheet shows as "218 of 499", and `written` is how many of
  // those pages carried any text at all. On a scan they diverge completely.
  let read = 0;
  let batch: { page: number; text: string }[] = [];

  for (let page = 1; page <= totalPages; page += 1) {
    // Page by page rather than `extractText(pdf)`, so the text of a 2,000-page
    // book is never all in memory at once and the Details sheet can say
    // "218 of 499" instead of spinning.
    const content = await (await pdf.getPage(page)).getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');

    batch.push({ page, text });

    if (batch.length >= PAGE_BATCH) {
      read += batch.length;
      written += await flush(ctx, documentId, batch, read, totalPages);
      batch = [];
    }
  }

  if (batch.length > 0) {
    read += batch.length;
    written += await flush(ctx, documentId, batch, read, totalPages);
  }

  return {
    written,
    totalPages,
    // A document that parsed and produced no text is a scan. That is a finished
    // answer — `textStatus: 'none'` — rather than a failure to retry.
    hasText: written > 0,
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

/** Writes one batch and moves the job's counter. */
async function flush(
  ctx: ActionCtx,
  documentId: Id<'documents'>,
  batch: { page: number; text: string }[],
  read: number,
  totalPages: number,
): Promise<number> {
  return await ctx.runMutation(internal.workflows.document.storePages, {
    documentId,
    pages: batch,
    // Sent rather than derived, because the mutation cannot see the loop.
    pagesDone: read,
    pagesTotal: totalPages,
  });
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
