import { app, net, protocol } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CLOUD_BYTE_MAX, TEXT_BYTE_MAX } from '@convex-model/limits';
import type { ReaderDocumentHandle, ReaderOpenRequest } from '../shared/ipc';

/**
 * The one privileged thing the reader needs: turn a signed URL into bytes the
 * renderer is allowed to render.
 *
 * The renderer mints the URL through Convex, which runs `assertOwner`, so the
 * authorisation decision is already made server-side by the time this runs. What
 * is left is the part a sandboxed web context cannot do for itself — fetch to
 * disk, prove the bytes are a PDF, and bound what a compromised renderer can
 * spend. The renderer never sends a path and never receives one.
 *
 * Bytes come back by URL rather than by IPC reply. A 100 MB structured clone
 * through the message port costs a copy in main, a copy in the renderer, and a
 * stall in both; a stream over a protocol handler costs neither.
 */

const DOC_SCHEME = 'pidom-doc';

/** Registered alongside the app scheme, before `app.whenReady`. */
export const READER_SCHEME = DOC_SCHEME;

/**
 * Standard so each handle parses as its own origin, secure so the renderer may
 * fetch it under a policy that forbids mixed content, stream so a large file is
 * not buffered whole to answer one request.
 */
export const READER_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  corsEnabled: true,
} as const;

/** How long the fetch of a signed URL may take before it is abandoned. */
const FETCH_TIMEOUT_MS = 60_000;

/**
 * How many verified copies are kept at once.
 *
 * Opening a document is the only thing that writes one, and a reader has a few
 * documents open across tabs at most. The cap exists for the renderer that
 * stops calling `closeDocument` — a leak then costs a bounded amount of disk
 * instead of the whole volume.
 */
const MAX_OPEN_DOCUMENTS = 8;

/** Every PDF begins with this. Anything else is not one, whatever it was named. */
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

interface OpenDocument {
  path: string;
  bytes: number;
  openedAt: number;
}

/** Handle → verified copy. The renderer only ever holds the key. */
const open = new Map<string, OpenDocument>();

let cacheDir: string | null = null;

/** `userData/reader-cache`, created once and emptied at both ends of a run. */
async function ensureCacheDir(): Promise<string> {
  if (cacheDir) return cacheDir;
  const dir = join(app.getPath('userData'), 'reader-cache');
  await mkdir(dir, { recursive: true });
  cacheDir = dir;
  return dir;
}

/**
 * Serves a verified copy to the renderer.
 *
 * The handle is the URL's host, so an unknown or evicted handle is a 404 rather
 * than a read of whatever the path resolves to. The path itself comes from the
 * map, never from the request, which is what keeps traversal out of reach: there
 * is no attacker-controlled segment to traverse with.
 */
function handleDocumentProtocol(request: Request): Promise<Response> {
  let host: string;
  try {
    host = new URL(request.url).host;
  } catch {
    return Promise.resolve(new Response('Bad request', { status: 400 }));
  }

  const entry = open.get(host);
  if (!entry) return Promise.resolve(new Response('Not found', { status: 404 }));

  return net.fetch(pathToFileURL(entry.path).toString()).then(
    (file) =>
      new Response(file.body, {
        status: file.status,
        headers: {
          'content-type': 'application/pdf',
          'content-length': String(entry.bytes),
          // The copy is temporary and already local; a second cache layer would
          // only keep bytes alive past the `closeDocument` that deleted them.
          'cache-control': 'no-store',
          // The renderer is a different origin (`app://bundle`) from the handle.
          'access-control-allow-origin': '*',
        },
      }),
  );
}

export function registerReaderProtocol(): void {
  protocol.handle(DOC_SCHEME, handleDocumentProtocol);
}

/** Empties the cache directory. Called at startup and on quit. */
export async function clearReaderCache(): Promise<void> {
  const dir = await ensureCacheDir();
  open.clear();
  await rm(dir, { recursive: true, force: true });
  cacheDir = null;
}

export async function closeDocument(handle: string): Promise<void> {
  const entry = open.get(handle);
  if (!entry) return;
  open.delete(handle);
  await rm(entry.path, { force: true });
}

/** Drops the oldest copies until the cap is respected again. */
async function evictToCap(): Promise<void> {
  while (open.size >= MAX_OPEN_DOCUMENTS) {
    let oldest: string | null = null;
    let oldestAt = Infinity;
    for (const [handle, entry] of open) {
      if (entry.openedAt < oldestAt) {
        oldestAt = entry.openedAt;
        oldest = handle;
      }
    }
    if (!oldest) return;
    await closeDocument(oldest);
  }
}

/**
 * Convex ids are opaque, but they are not arbitrary: bounding the shape here
 * means a renderer cannot smuggle a path fragment or a control character into
 * anything downstream that decides to log or name a file with one.
 */
function isPlausibleId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

export async function openDocument(request: ReaderOpenRequest): Promise<ReaderDocumentHandle> {
  if (!request || !isPlausibleId(request.documentId)) {
    throw new Error('openDocument rejected: bad document id');
  }

  let url: URL;
  try {
    url = new URL(request.signedUrl);
  } catch {
    throw new Error('openDocument rejected: malformed URL');
  }
  // https only, for the same reason `openExternal` is: a renderer that can name
  // any scheme can reach local handlers and the filesystem through this fetch.
  if (url.protocol !== 'https:') throw new Error('openDocument rejected: non-https URL');

  const dir = await ensureCacheDir();
  await evictToCap();

  const handle = randomBytes(16).toString('hex');
  // The id is hashed into the name rather than written into it, so nothing the
  // renderer sends becomes a filename even after the shape check above.
  const stamp = createHash('sha256').update(request.documentId).digest('hex').slice(0, 16);
  const path = normalize(join(dir, `${stamp}-${handle}.pdf`));
  if (!path.startsWith(dir + sep)) throw new Error('openDocument failed: bad cache path');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let total = 0;

  try {
    const response = await net.fetch(url.toString(), {
      signal: controller.signal,
      // The URL carries its own authorisation. Nothing of ours should ride along.
      credentials: 'omit',
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`openDocument failed: the server answered ${response.status}`);
    }

    // Trust the advertised length only to refuse early, never to size a buffer:
    // a header saying 1 MB does not stop a body from being a gigabyte.
    const advertised = Number(response.headers.get('content-length'));
    if (Number.isFinite(advertised) && advertised > CLOUD_BYTE_MAX) {
      throw new Error('openDocument rejected: document exceeds the size ceiling');
    }
    if (!response.body) throw new Error('openDocument failed: empty response');

    const sink = createWriteStream(path, { mode: 0o600 });
    const head = Buffer.alloc(PDF_MAGIC.byteLength);
    let headLength = 0;

    try {
      for await (const chunk of streamOf(response.body)) {
        total += chunk.byteLength;
        if (total > CLOUD_BYTE_MAX) {
          throw new Error('openDocument rejected: document exceeds the size ceiling');
        }

        // Check the magic on the first bytes that arrive rather than after the
        // download, so a 100 MB file that was never a PDF costs one chunk.
        if (headLength < head.byteLength) {
          headLength += chunk.copy(
            head,
            headLength,
            0,
            Math.min(chunk.byteLength, head.byteLength - headLength),
          );
          if (headLength === head.byteLength && !head.equals(PDF_MAGIC)) {
            throw new Error('openDocument rejected: not a PDF');
          }
        }

        // Respect backpressure: a fast network into a slow disk would otherwise
        // queue the whole file in memory, which is what the stream avoids.
        if (!sink.write(chunk)) {
          await once(sink, 'drain');
        }
      }

      if (headLength < head.byteLength) throw new Error('openDocument rejected: not a PDF');

      await new Promise<void>((resolve, reject) =>
        sink.end((error?: Error | null) => (error ? reject(error) : resolve())),
      );
    } catch (error) {
      sink.destroy();
      throw error;
    }
  } catch (error) {
    controller.abort();
    await rm(path, { force: true });
    throw error;
  } finally {
    clearTimeout(timer);
  }

  open.set(handle, { path, bytes: total, openedAt: Date.now() });

  return { handle, url: `${DOC_SCHEME}://${handle}/document.pdf`, bytes: total };
}

/**
 * Fetches a document's extracted-text object for the find bar.
 *
 * Same reason the PDF goes through main: the text object is an R2 signed URL, and
 * the renderer's CSP deliberately does not list R2 — only main reaches it. The
 * renderer mints the URL through Convex (ownership already checked) and hands it
 * here; main fetches it over Chromium's stack and returns the JSON text. https
 * only and bounded to `TEXT_BYTE_MAX`, the same ceiling the extractor wrote under,
 * so a redirected or oversized body cannot balloon memory.
 */
export async function fetchText(signedUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(signedUrl);
  } catch {
    throw new Error('fetchText rejected: malformed URL');
  }
  if (url.protocol !== 'https:') throw new Error('fetchText rejected: non-https URL');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await net.fetch(url.toString(), {
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`fetchText failed: the server answered ${response.status}`);
    }
    const advertised = Number(response.headers.get('content-length'));
    if (Number.isFinite(advertised) && advertised > TEXT_BYTE_MAX) {
      throw new Error('fetchText rejected: text object exceeds the size ceiling');
    }
    if (!response.body) throw new Error('fetchText failed: empty response');

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of streamOf(response.body)) {
      total += chunk.byteLength;
      if (total > TEXT_BYTE_MAX) {
        throw new Error('fetchText rejected: text object exceeds the size ceiling');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

/** Node's async iteration over a web `ReadableStream`, as `Buffer` chunks. */
async function* streamOf(body: ReadableStream<Uint8Array>): AsyncGenerator<Buffer> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
  } finally {
    reader.releaseLock();
  }
}
