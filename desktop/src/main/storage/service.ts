import { net } from 'electron';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { once } from 'node:events';
import { join } from 'node:path';
import PQueue from 'p-queue';
import { eq } from 'drizzle-orm';

import { CLOUD_BYTE_MAX } from '@convex-model/limits';
import type { LocalDocumentStatus, LocalFileState, StorageUsage } from '../../shared/ipc';
import { getDb } from '../db';
import {
  downloadJobs,
  localFiles,
  type DownloadJobState,
  type LocalFileRow,
  type LocalFileState as DbFileState,
} from '../db/schema';
import type { SessionManager } from '../auth/oauth';
import { StorageConvex } from './convex-client';
import { documentPath, ensureLibraryPaths, isSafeDocumentId, type LibraryPaths } from './paths';

/**
 * The local document manager.
 *
 * It does for a persistent library what `reader.ts` does for a temporary open:
 * turn a signed URL into verified bytes on disk. The differences are the point
 * of this feature — the copy persists across runs, its bytes are hashed as they
 * arrive, and its state is recorded in SQLite so the library can be listed and
 * managed offline.
 *
 * Everything a renderer sends is a Convex document id and nothing else. The id
 * is shape-checked, the destination path is derived from it under a per-account
 * root, the download streams to a `.part` file that is only renamed into place
 * after the magic and size checks pass, and two operations on one document never
 * run at once (a per-id queue). A path never crosses back to the renderer.
 */

/** Every PDF begins with this. Anything else is not one, whatever it was named. */
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

/** How long the fetch of a signed URL may take before it is abandoned. */
const FETCH_TIMEOUT_MS = 120_000;

/** Notified after any state change, so IPC can push it to the renderer. */
type ChangeListener = (status: LocalDocumentStatus) => void;

export class StorageService {
  private readonly session: SessionManager;
  private readonly convex: StorageConvex;
  private readonly listeners = new Set<ChangeListener>();
  /** One queue per document id: conflicting operations on a file serialize. */
  private readonly queues = new Map<string, PQueue>();
  private paths: LibraryPaths | null = null;
  private subject: string | null = null;

  constructor(session: SessionManager) {
    this.session = session;
    this.convex = new StorageConvex(session);
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(status: LocalDocumentStatus): void {
    for (const listener of this.listeners) listener(status);
  }

  /** Resolves the managed library tree for the signed-in account, creating it
   *  once. The account key comes from the verified token's subject. */
  private async ensurePaths(): Promise<LibraryPaths> {
    const subject = this.session.getState().profile?.subject ?? null;
    if (!subject) throw new Error('Not signed in.');
    // A different account gets a different tree; re-resolve on a subject change.
    if (this.paths && this.subject === subject) return this.paths;
    this.paths = await ensureLibraryPaths(subject);
    this.subject = subject;
    return this.paths;
  }

  /** Empties the in-flight `tmp/` directory. Called at both ends of a run so a
   *  crashed download never leaves a `.part` file behind. Documents persist. */
  async clearTmp(): Promise<void> {
    const subject = this.session.getState().profile?.subject ?? null;
    if (!subject) return;
    try {
      const paths = await ensureLibraryPaths(subject);
      await rm(paths.tmp, { recursive: true, force: true });
      await mkdir(paths.tmp, { recursive: true, mode: 0o700 });
    } catch {
      /* best effort — a missing tmp dir is the desired end state anyway */
    }
  }

  private queueFor(documentId: string): PQueue {
    let queue = this.queues.get(documentId);
    if (!queue) {
      queue = new PQueue({ concurrency: 1 });
      this.queues.set(documentId, queue);
    }
    return queue;
  }

  private rowToStatus(
    documentId: string,
    row: LocalFileRow | undefined,
    job?: { receivedBytes: number; totalBytes: number | null; error: string | null },
  ): LocalDocumentStatus {
    const state: LocalFileState = row?.state ?? 'none';
    return {
      documentId,
      state,
      bytes: row?.bytes ?? null,
      receivedBytes: job?.receivedBytes ?? null,
      totalBytes: job?.totalBytes ?? null,
      error: job?.error ?? null,
    };
  }

  /** One document's current local status. */
  status(documentId: string): LocalDocumentStatus {
    if (!isSafeDocumentId(documentId)) throw new Error('storage rejected: bad document id');
    const db = getDb();
    const row = db.select().from(localFiles).where(eq(localFiles.documentId, documentId)).get();
    const job = db.select().from(downloadJobs).where(eq(downloadJobs.documentId, documentId)).get();
    return this.rowToStatus(documentId, row, job);
  }

  /** The path of an `available` local copy, or null. Used by the reader to open
   *  a document with no network. Never returned to the renderer. */
  availablePath(documentId: string): string | null {
    if (!isSafeDocumentId(documentId)) return null;
    const db = getDb();
    const row = db.select().from(localFiles).where(eq(localFiles.documentId, documentId)).get();
    if (!row || row.state !== 'available' || !row.path) return null;
    return row.path;
  }

  /** Every document with a local record. */
  list(): LocalDocumentStatus[] {
    const db = getDb();
    const rows = db.select().from(localFiles).all();
    const jobs = new Map(
      db
        .select()
        .from(downloadJobs)
        .all()
        .map((j) => [j.documentId, j] as const),
    );
    return rows.map((row) => this.rowToStatus(row.documentId, row, jobs.get(row.documentId)));
  }

  /** Downloads, verifies, and persists a document's PDF. Idempotent: an already
   *  `available` copy is returned as-is without re-fetching. */
  async download(documentId: string): Promise<LocalDocumentStatus> {
    if (!isSafeDocumentId(documentId)) throw new Error('storage rejected: bad document id');
    return this.queueFor(documentId).add(() =>
      this.runDownload(documentId),
    ) as Promise<LocalDocumentStatus>;
  }

  private async runDownload(documentId: string): Promise<LocalDocumentStatus> {
    const db = getDb();
    const now = Date.now();

    const existing = db
      .select()
      .from(localFiles)
      .where(eq(localFiles.documentId, documentId))
      .get();
    if (existing?.state === 'available' && existing.path) {
      // Confirm the bytes are really still there; a deleted file is not available.
      const present = await stat(existing.path).then(
        () => true,
        () => false,
      );
      if (present) return this.rowToStatus(documentId, existing);
    }

    const paths = await this.ensurePaths();
    const setState = (state: DbFileState, patch: Partial<LocalFileRow> = {}) => {
      db.insert(localFiles)
        .values({ documentId, state, updatedAt: Date.now(), ...patch })
        .onConflictDoUpdate({
          target: localFiles.documentId,
          set: { state, updatedAt: Date.now(), ...patch },
        })
        .run();
      this.emit(this.status(documentId));
    };
    const setJob = (patch: {
      state?: DownloadJobState;
      receivedBytes?: number;
      totalBytes?: number | null;
      error?: string | null;
    }) => {
      db.insert(downloadJobs)
        .values({
          documentId,
          state: patch.state ?? 'running',
          receivedBytes: patch.receivedBytes ?? 0,
          totalBytes: patch.totalBytes ?? null,
          error: patch.error ?? null,
          updatedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: downloadJobs.documentId,
          set: { ...patch, updatedAt: Date.now() },
        })
        .run();
      this.emit(this.status(documentId));
    };

    setState('downloading');
    setJob({ state: 'running', receivedBytes: 0, error: null });

    const finalPath = documentPath(paths, documentId);
    // A random suffix so a re-download while an old `.part` lingers cannot clash.
    const partPath = join(paths.tmp, `${documentId}-${now}.part`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const hash = createHash('sha256');
    let total = 0;

    try {
      const signedUrl = await this.convex.documentUrl(documentId);
      if (!signedUrl) {
        setState('failed');
        setJob({ state: 'failed', error: 'not-synced' });
        return this.status(documentId);
      }

      const url = new URL(signedUrl);
      // https only, the same reason the reader cache insists: a URL that can name
      // any scheme can reach a local handler or the filesystem through this fetch.
      if (url.protocol !== 'https:') throw new Error('non-https URL');

      const response = await net.fetch(url.toString(), {
        signal: controller.signal,
        // The URL carries its own authorisation; nothing of ours rides along.
        credentials: 'omit',
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`server ${response.status}`);

      // Trust the advertised length only to refuse early, never to size a buffer.
      const advertised = Number(response.headers.get('content-length'));
      const totalBytes = Number.isFinite(advertised) ? advertised : null;
      if (totalBytes !== null && totalBytes > CLOUD_BYTE_MAX) {
        throw new Error('exceeds size ceiling');
      }
      if (!response.body) throw new Error('empty response');
      setJob({ state: 'running', totalBytes });

      const sink = createWriteStream(partPath, { mode: 0o600 });
      const head = Buffer.alloc(PDF_MAGIC.byteLength);
      let headLength = 0;

      try {
        for await (const chunk of streamOf(response.body)) {
          total += chunk.byteLength;
          if (total > CLOUD_BYTE_MAX) throw new Error('exceeds size ceiling');

          // Check the magic on the first bytes that arrive, so a large file that
          // was never a PDF costs one chunk rather than the whole download.
          if (headLength < head.byteLength) {
            headLength += chunk.copy(
              head,
              headLength,
              0,
              Math.min(chunk.byteLength, head.byteLength - headLength),
            );
            if (headLength === head.byteLength && !head.equals(PDF_MAGIC)) {
              throw new Error('not a PDF');
            }
          }

          hash.update(chunk);
          if (!sink.write(chunk)) await once(sink, 'drain');
          setJob({ state: 'running', receivedBytes: total, totalBytes });
        }

        if (headLength < head.byteLength) throw new Error('not a PDF');
        await new Promise<void>((resolve, reject) =>
          sink.end((error?: Error | null) => (error ? reject(error) : resolve())),
        );
      } catch (error) {
        sink.destroy();
        throw error;
      }

      setState('verifying');
      const digest = hash.digest('hex');
      // Atomic within the volume: the reader never sees a half-written file under
      // `documents/`, because it only ever appears there fully formed.
      await rename(partPath, finalPath);

      setState('available', { path: finalPath, hash: digest, bytes: total, version: digest });
      setJob({ state: 'done', receivedBytes: total, error: null });
      return this.status(documentId);
    } catch (error) {
      controller.abort();
      await rm(partPath, { force: true });
      const code = errorCode(error);
      setState('failed');
      setJob({ state: 'failed', error: code });
      return this.status(documentId);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Deletes the local copy and its records. The account keeps the document. */
  async remove(documentId: string): Promise<LocalDocumentStatus> {
    if (!isSafeDocumentId(documentId)) throw new Error('storage rejected: bad document id');
    return this.queueFor(documentId).add(async () => {
      const db = getDb();
      const row = db.select().from(localFiles).where(eq(localFiles.documentId, documentId)).get();
      if (row?.path) await rm(row.path, { force: true });
      db.delete(localFiles).where(eq(localFiles.documentId, documentId)).run();
      db.delete(downloadJobs).where(eq(downloadJobs.documentId, documentId)).run();
      const status = this.rowToStatus(documentId, undefined);
      this.emit(status);
      return status;
    }) as Promise<LocalDocumentStatus>;
  }

  /** Re-hashes a local copy. Marks it `missing` if the file is gone, `outdated`
   *  if the bytes no longer match what was recorded. */
  async verify(documentId: string): Promise<LocalDocumentStatus> {
    if (!isSafeDocumentId(documentId)) throw new Error('storage rejected: bad document id');
    return this.queueFor(documentId).add(async () => {
      const db = getDb();
      const row = db.select().from(localFiles).where(eq(localFiles.documentId, documentId)).get();
      if (!row?.path) return this.status(documentId);

      const patch = (state: DbFileState) => {
        db.update(localFiles)
          .set({ state, updatedAt: Date.now() })
          .where(eq(localFiles.documentId, documentId))
          .run();
        this.emit(this.status(documentId));
      };

      const present = await stat(row.path).then(
        () => true,
        () => false,
      );
      if (!present) {
        patch('missing');
        return this.status(documentId);
      }

      const actual = await hashFile(row.path);
      patch(actual === row.hash ? 'available' : 'outdated');
      return this.status(documentId);
    }) as Promise<LocalDocumentStatus>;
  }

  /** Local usage totals for the Storage settings surface. */
  async usage(): Promise<StorageUsage> {
    const paths = await this.ensurePaths();
    const db = getDb();
    const documentCount = db
      .select()
      .from(localFiles)
      .where(eq(localFiles.state, 'available'))
      .all().length;

    const [documentBytes, cacheBytes, freeBytes] = await Promise.all([
      dirBytes(paths.documents),
      dirBytes(paths.cache),
      freeSpace(paths.root),
    ]);

    return {
      documentCount,
      documentBytes,
      cacheBytes,
      freeBytes,
      libraryPath: paths.root,
    };
  }

  /** Deletes only the regenerable `cache/` tree. Documents are never touched. */
  async clearCache(): Promise<StorageUsage> {
    const paths = await this.ensurePaths();
    await rm(paths.cache, { recursive: true, force: true });
    await mkdir(paths.cache, { recursive: true, mode: 0o700 });
    return this.usage();
  }

  /** The managed library root, for `shell.showItemInFolder`. */
  async libraryRoot(): Promise<string> {
    const paths = await this.ensurePaths();
    return paths.documents;
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

/** sha256 of a file on disk, streamed so a large file is not buffered whole. */
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Total size of the regular files directly in a directory. The library is flat
 *  (`documents/<id>.pdf`), so a shallow read is the whole answer. */
async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    try {
      const info = await stat(join(dir, name));
      if (info.isFile()) total += info.size;
    } catch {
      /* a file removed mid-scan simply does not count */
    }
  }
  return total;
}

/** Free bytes on the volume holding a path, or null when the platform can't say. */
async function freeSpace(path: string): Promise<number | null> {
  try {
    const info = await statfs(path);
    return info.bavail * info.bsize;
  } catch {
    return null;
  }
}

/** A short, non-sensitive code for a failure. Never a server body — it can echo
 *  a signed URL or token. */
function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('not a PDF')) return 'not-a-pdf';
  if (message.includes('size ceiling')) return 'too-large';
  if (message.includes('non-https')) return 'bad-url';
  if (message.includes('Not signed in')) return 'signed-out';
  if (message.startsWith('server ')) return 'server-error';
  if (error instanceof Error && error.name === 'AbortError') return 'timeout';
  return 'download-failed';
}
