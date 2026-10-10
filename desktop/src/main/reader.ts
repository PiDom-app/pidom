import { app, dialog, net, protocol, type BrowserWindow, type SaveDialogOptions } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CLOUD_BYTE_MAX, TEXT_BYTE_MAX } from '@convex-model/limits';
import type {
  ReaderDocumentHandle,
  ReaderOpenRequest,
  ReaderSaveAsRequest,
  ReaderSaveAsResult,
  ReaderSaveRequest,
  ReaderSaveResult,
} from '../shared/ipc';
import { isSafeDocumentId } from './storage/paths';
import { detectDocumentFormat, hasRecognizedSignature } from '../../../src/lib/document-formats';

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
 * Resolves a document id to an already-verified persistent local copy, when the
 * storage service holds one. Set once at startup (see `setLocalResolver`), kept
 * out of this module's imports so the reader has no hard dependency on storage.
 */
let resolveLocalPath: ((documentId: string) => string | null) | null = null;

/** Wire the persistent-storage lookup the reader consults before the network. */
export function setLocalResolver(resolver: (documentId: string) => string | null): void {
  resolveLocalPath = resolver;
}

/**
 * The single origin the renderer runs at (`app://bundle` packaged, the Vite dev
 * server in development). Set by `registerReaderProtocol` and used as the scoped
 * `access-control-allow-origin` when serving document bytes, so the reader never
 * answers a wildcard. Falls back to the packaged origin if never set.
 */
let rendererOrigin = 'app://bundle';

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

interface OpenDocument {
  path: string;
  bytes: number;
  openedAt: number;
  /** True when `path` is a persistent local copy the storage service owns.
   *  Closing or evicting the handle drops the map entry but must NOT delete the
   *  file — that copy outlives the reader session. */
  persistent?: boolean;
  contentType: string;
  contentHash: string;
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
          'content-type': entry.contentType,
          'content-length': String(entry.bytes),
          // The copy is temporary and already local; a second cache layer would
          // only keep bytes alive past the `closeDocument` that deleted them.
          'cache-control': 'no-store',
          // The renderer is a different origin (`app://bundle`, or the dev
          // server) from the handle, so it needs an explicit allow-origin —
          // scoped to that one renderer origin, never a wildcard.
          'access-control-allow-origin': rendererOrigin,
        },
      }),
  );
}

export function registerReaderProtocol(origin: string): void {
  rendererOrigin = origin;
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
  // A persistent copy belongs to the storage service and outlives this session;
  // only a temporary streamed copy is the reader's to delete.
  if (!entry.persistent) await rm(entry.path, { force: true });
}

function validateEditorBytes(request: { bytes: ArrayBuffer; format: string }): void {
  if (request.format === 'image') {
    const bytes = new Uint8Array(request.bytes);
    if (
      bytes.length < 8 ||
      bytes[0] !== 0x89 ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x4e ||
      bytes[3] !== 0x47 ||
      bytes[4] !== 0x0d ||
      bytes[5] !== 0x0a ||
      bytes[6] !== 0x1a ||
      bytes[7] !== 0x0a
    ) {
      throw new Error('save rejected: image export is not a PNG');
    }
    return;
  }
  if (request.format === 'pdf') {
    const bytes = new Uint8Array(request.bytes);
    if (new TextDecoder('latin1').decode(bytes.slice(0, 5)) !== '%PDF-') {
      throw new Error('save rejected: document is not a PDF');
    }
    return;
  }
  if (['docx', 'odt', 'xlsx', 'pptx'].includes(request.format)) {
    const bytes = new Uint8Array(request.bytes);
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new Error('save rejected: Office document is not a ZIP package');
    }
    return;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(request.bytes);
  } catch {
    throw new Error('save rejected: document is not valid UTF-8');
  }
}
async function hashFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function saveDocument(
  _owner: BrowserWindow | null,
  request: ReaderSaveRequest,
): Promise<ReaderSaveResult> {
  const entry = open.get(request.handle);
  if (!entry) throw new Error('save rejected: unknown document handle');
  if (!entry.persistent) throw new Error('save rejected: no local source file');
  validateEditorBytes(request);
  const currentHash = await hashFile(entry.path);
  if (currentHash !== request.expectedContentHash) {
    return { status: 'conflict', currentContentHash: currentHash };
  }
  const temporary = `${entry.path}.pidom-${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, new Uint8Array(request.bytes), { flag: 'wx', mode: 0o600 });
    await rename(temporary, entry.path);
    const contentHash = createHash('sha256').update(new Uint8Array(request.bytes)).digest('hex');
    entry.bytes = request.bytes.byteLength;
    entry.contentHash = contentHash;
    return { status: 'saved', contentHash };
  } finally {
    await rm(temporary, { force: true });
  }
}



/**
 * Writes an edited in-memory document through the native Save As dialog.
 * Renderer bytes are bounded by IPC validation; the handle is still required
 * to prevent an unrelated renderer from turning this into an arbitrary export
 * primitive.
 */
export async function saveDocumentAs(
  owner: BrowserWindow | null,
  request: ReaderSaveAsRequest,
): Promise<ReaderSaveAsResult> {
  if (!open.has(request.handle)) throw new Error('saveAs rejected: unknown document handle');
  if (!['txt', 'md', 'csv', 'docx', 'odt', 'xlsx', 'pptx', 'pdf', 'image'].includes(request.format)) {
    throw new Error('saveAs rejected: unsupported editable format');
  }

  if (request.format === 'image') {
    const bytes = new Uint8Array(request.bytes);
    const isPng =
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a;
    if (!isPng) throw new Error('saveAs rejected: image export is not a PNG');
  } else if (request.format === 'pdf') {
    validateEditorBytes(request);
  } else if (['docx', 'odt', 'xlsx', 'pptx'].includes(request.format)) {
    validateEditorBytes(request);
  } else {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(request.bytes);
    } catch {
      throw new Error('saveAs rejected: document is not valid UTF-8');
    }
  }
  const options: SaveDialogOptions = {
    defaultPath: request.suggestedName,
    buttonLabel: 'Save',
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  };
  const result = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { saved: false };

  const destination = normalize(result.filePath);
  const temporary = `${destination}.pidom-${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, new Uint8Array(request.bytes), { flag: 'wx' });
    await rename(temporary, destination);
    return { saved: true };
  } finally {
    await rm(temporary, { force: true });
  }
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
 * Convex ids are opaque, but they are not arbitrary. Bounding the shape means a
 * renderer cannot smuggle a path fragment or a control character into anything
 * downstream that decides to log or name a file with one. This is exactly the
 * `isSafeDocumentId` guard the storage tree names files with (`[A-Za-z0-9]`, ≤64),
 * shared so the reader and the on-disk library never disagree on what an id is —
 * a looser rule here could accept an id the storage layer then rejects.
 */

export async function openDocument(request: ReaderOpenRequest): Promise<ReaderDocumentHandle> {
  if (!request || !isSafeDocumentId(request.documentId)) {
    throw new Error('openDocument rejected: bad document id');
  }

  const format = detectDocumentFormat(
    request.documentKind ? `document.${request.documentKind}` : 'document.pdf',
    undefined,
  );
  if (format.format === 'unknown') throw new Error('openDocument rejected: unsupported format');

  // A persistent local copy opens with no network at all: the storage service
  // already fetched, verified the `%PDF-` magic, and hashed these bytes when it
  // downloaded them, so this serves them straight back over the same handle the
  // streaming path uses. The renderer cannot tell the two apart, and reading
  // works offline. Only falls through to the fetch below when nothing is saved.
  const localPath = resolveLocalPath?.(request.documentId) ?? null;
  if (localPath) {
    try {
      const info = await stat(localPath);
      await evictToCap();
      const handle = randomBytes(16).toString('hex');
      open.set(handle, {
        path: localPath,
        bytes: info.size,
        openedAt: Date.now(),
        persistent: true,
        contentType: format.contentType,
        contentHash: await hashFile(localPath),
      });
      return {
        handle,
        url: `${DOC_SCHEME}://${handle}/document`,
        bytes: info.size,
        contentType: format.contentType,
        contentHash: open.get(handle)?.contentHash ?? '',
      };
    } catch {
      // The record said available but the file is gone; fall through and fetch.
    }
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
  const path = normalize(join(dir, `${stamp}-${handle}.${format.extensions[0] ?? 'bin'}`));
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
    const head = Buffer.alloc(8);
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
        }

        // Respect backpressure: a fast network into a slow disk would otherwise
        // queue the whole file in memory, which is what the stream avoids.
        if (!sink.write(chunk)) {
          await once(sink, 'drain');
        }
      }

      if (!hasRecognizedSignature(format.format, head.subarray(0, headLength))) {
        throw new Error('openDocument rejected: invalid document signature');
      }

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

  const contentHash = createHash('sha256');
  // The downloaded file is already verified; hash it once before exposing the
  // handle so a later overwrite can detect changes made outside Pidom.
  contentHash.update(await readFile(path));
  open.set(handle, {
    path,
    bytes: total,
    openedAt: Date.now(),
    contentType: format.contentType,
    contentHash: contentHash.digest('hex'),
  });

  return {
    handle,
    url: `${DOC_SCHEME}://${handle}/document`,
    bytes: total,
    contentType: format.contentType,
    contentHash: open.get(handle)?.contentHash ?? '',
  };
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
