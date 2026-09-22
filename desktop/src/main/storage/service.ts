import { BrowserWindow, clipboard, dialog, net } from 'electron';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { once } from 'node:events';
import { join } from 'node:path';
import PQueue from 'p-queue';
import { eq } from 'drizzle-orm';

import { CLOUD_BYTE_MAX } from '@convex-model/limits';
import type {
  LocalDocumentStatus,
  LocalFileState,
  MigrationResult,
  MigrationStatus,
  StorageUsage,
} from '../../shared/ipc';
import { getDb } from '../db';
import {
  downloadJobs,
  localFiles,
  localSettings,
  type DownloadJobState,
  type LocalFileRow,
  type LocalFileState as DbFileState,
} from '../db/schema';
import type { SessionManager } from '../auth/oauth';
import { StorageConvex } from './convex-client';
import {
  accountKey,
  documentPath,
  ensureLibraryPaths,
  isSafeDocumentId,
  validateDestinationBase,
  type LibraryPaths,
} from './paths';

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

/** Notified as a library migration advances, so IPC can push progress out. */
type MigrationListener = (status: MigrationStatus) => void;

/** The per-account setting key holding a chosen custom base directory. Absent
 *  means the library lives at the default userData base. */
const LIBRARY_BASE_KEY = 'libraryBase';

export class StorageService {
  private readonly session: SessionManager;
  private readonly convex: StorageConvex;
  private readonly listeners = new Set<ChangeListener>();
  private readonly migrationListeners = new Set<MigrationListener>();
  /** One queue per document id: conflicting operations on a file serialize. */
  private readonly queues = new Map<string, PQueue>();
  private paths: LibraryPaths | null = null;
  private subject: string | null = null;
  /** The custom base for the resolved `paths`, or null when at the default. */
  private customBase: string | null = null;
  /** True while a library move runs. File operations refuse to start meanwhile
   *  so nothing writes into a tree that is being copied out from under it. */
  private migrating = false;

  constructor(session: SessionManager) {
    this.session = session;
    this.convex = new StorageConvex(session);
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onMigration(listener: MigrationListener): () => void {
    this.migrationListeners.add(listener);
    return () => this.migrationListeners.delete(listener);
  }

  private emit(status: LocalDocumentStatus): void {
    for (const listener of this.listeners) listener(status);
  }

  private emitMigration(status: MigrationStatus): void {
    for (const listener of this.migrationListeners) listener(status);
  }

  /** The signed-in account's verified subject, or throws. */
  private requireSubject(): string {
    const subject = this.session.getState().profile?.subject ?? null;
    if (!subject) throw new Error('Not signed in.');
    return subject;
  }

  /** The account-scoped id for a local setting row. */
  private settingId(subject: string, key: string): string {
    return `${accountKey(subject)}:${key}`;
  }

  /** Reads this account's chosen custom base directory, or null for the default.
   *  Non-secret (a plain local path), so it lives in SQLite, not `safeStorage`. */
  private readCustomBase(subject: string): string | null {
    const db = getDb();
    const row = db
      .select()
      .from(localSettings)
      .where(eq(localSettings.id, this.settingId(subject, LIBRARY_BASE_KEY)))
      .get();
    return row?.value ?? null;
  }

  private writeCustomBase(subject: string, base: string | null): void {
    const db = getDb();
    const id = this.settingId(subject, LIBRARY_BASE_KEY);
    if (base === null) {
      db.delete(localSettings).where(eq(localSettings.id, id)).run();
      return;
    }
    db.insert(localSettings)
      .values({ id, value: base, updatedAt: Date.now() })
      .onConflictDoUpdate({ target: localSettings.id, set: { value: base, updatedAt: Date.now() } })
      .run();
  }

  /** Resolves the managed library tree for the signed-in account, creating it
   *  once. Honours a chosen custom base; the account key comes from the verified
   *  token's subject, so a different account never lands in the same tree. */
  private async ensurePaths(): Promise<LibraryPaths> {
    const subject = this.requireSubject();
    const base = this.readCustomBase(subject);
    // Re-resolve on a subject change or after a migration moved the base.
    if (this.paths && this.subject === subject && this.customBase === base) return this.paths;
    this.paths = await ensureLibraryPaths(subject, base ?? undefined);
    this.subject = subject;
    this.customBase = base;
    return this.paths;
  }

  /** Empties the in-flight `tmp/` directory. Called at both ends of a run so a
   *  crashed download never leaves a `.part` file behind. Documents persist. */
  async clearTmp(): Promise<void> {
    const subject = this.session.getState().profile?.subject ?? null;
    if (!subject) return;
    try {
      const paths = await this.ensurePaths();
      await rm(paths.tmp, { recursive: true, force: true });
      await mkdir(paths.tmp, { recursive: true, mode: 0o700 });
    } catch {
      /* best effort — a missing tmp dir is the desired end state anyway */
    }
  }

  /** Refuses a file operation while a library move is in flight. */
  private assertNotMigrating(): void {
    if (this.migrating) throw new Error('storage busy: library move in progress');
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
    this.assertNotMigrating();
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
    this.assertNotMigrating();
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
    this.assertNotMigrating();
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
      isCustomLocation: this.customBase !== null,
    };
  }

  /** Deletes only the regenerable `cache/` tree. Documents are never touched. */
  async clearCache(): Promise<StorageUsage> {
    this.assertNotMigrating();
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

  /** Copies the active library root to the clipboard. The renderer is sandboxed
   *  and has no clipboard access to a path it is never told, so main does it. */
  async copyPath(): Promise<void> {
    const paths = await this.ensurePaths();
    clipboard.writeText(paths.root);
  }

  /** Opens the OS folder picker and returns the chosen absolute path, or null if
   *  the reader cancelled. This only asks the OS for a path — the value is still
   *  validated in `moveLibrary` before anything is written. */
  async chooseFolder(): Promise<string | null> {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          title: 'Choose a folder for your Pidom library',
          properties: ['openDirectory', 'createDirectory'],
        })
      : await dialog.showOpenDialog({
          title: 'Choose a folder for your Pidom library',
          properties: ['openDirectory', 'createDirectory'],
        });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  }

  /**
   * Moves the whole document library to a new base directory.
   *
   * The move is atomic in effect: every file is copied and re-hashed at the
   * destination first, and the active root only switches once all of them match.
   * On any failure the old library stays the source of truth and the partial
   * copy is removed, so the reader never loses a document to a failed move.
   * Progress is pushed on `onMigration`; this resolves with the final outcome.
   */
  async moveLibrary(destination: string): Promise<MigrationResult> {
    if (this.migrating) return { ok: false, libraryPath: null, error: 'busy' };
    this.migrating = true;
    let totalBytes = 0;
    let copiedBytes = 0;
    let switched = false;
    let target: LibraryPaths | null = null;
    const report = (
      phase: MigrationStatus['phase'],
      done: number,
      total: number,
      error: string | null = null,
    ) => this.emitMigration({ phase, done, total, copiedBytes, totalBytes, destination, error });

    try {
      const subject = this.requireSubject();
      const source = await this.ensurePaths();

      report('validating', 0, 0);
      const base = await validateDestinationBase(destination, source.root);
      target = await ensureLibraryPaths(subject, base);

      const db = getDb();
      const rows = db
        .select()
        .from(localFiles)
        .all()
        .filter((row): row is LocalFileRow & { path: string } => Boolean(row.path));

      // Only files that actually exist can be copied; a `missing`/`failed` row
      // has nothing on disk to move and is repathed (still absent) at the switch.
      const present: Array<{ documentId: string; from: string; to: string; bytes: number }> = [];
      for (const row of rows) {
        const info = await stat(row.path).catch(() => null);
        if (!info?.isFile()) continue;
        present.push({
          documentId: row.documentId,
          from: row.path,
          to: documentPath(target, row.documentId),
          bytes: info.size,
        });
        totalBytes += info.size;
      }

      // Refuse if the destination volume cannot hold the library, before copying.
      const free = await freeSpace(target.root);
      if (free !== null && free < totalBytes) throw new Error('not enough space');

      report('copying', 0, present.length);
      for (let i = 0; i < present.length; i += 1) {
        const item = present[i];
        // Stage into the destination's own tmp so the rename into `documents/` is
        // a same-volume atomic move, never a cross-device half-write.
        const staged = join(target.tmp, `${item.documentId}-${Date.now()}.part`);
        await copyFile(item.from, staged);
        await rename(staged, item.to);
        copiedBytes += item.bytes;
        report('copying', i + 1, present.length);
      }

      report('verifying', 0, present.length);
      for (let i = 0; i < present.length; i += 1) {
        const item = present[i];
        const row = rows.find((r) => r.documentId === item.documentId);
        const digest = await hashFile(item.to);
        if (row?.hash && digest !== row.hash) throw new Error('verify mismatch');
        report('verifying', i + 1, present.length);
      }

      // Switch the active root: persist the new base, repath every row in one
      // transaction, then re-resolve paths so subsequent reads use the new tree.
      report('switching', present.length, present.length);
      const copied = new Set(present.map((p) => p.documentId));
      const targetPaths = target;
      db.transaction((tx) => {
        this.writeCustomBase(subject, base);
        for (const row of rows) {
          if (copied.has(row.documentId)) {
            tx.update(localFiles)
              .set({ path: documentPath(targetPaths, row.documentId), updatedAt: Date.now() })
              .where(eq(localFiles.documentId, row.documentId))
              .run();
          } else {
            // Its bytes were never here to move; mark it plainly missing.
            tx.update(localFiles)
              .set({ path: null, state: 'missing', updatedAt: Date.now() })
              .where(eq(localFiles.documentId, row.documentId))
              .run();
          }
        }
      });
      switched = true;
      // Force ensurePaths to pick up the new base on its next call.
      this.paths = null;
      this.subject = null;
      const moved = await this.ensurePaths();

      // Remove the old tree. A failure here is cosmetic — the library already
      // lives at, and is served from, the new root.
      report('cleaning', present.length, present.length);
      await rm(source.root, { recursive: true, force: true }).catch(() => {});

      report('done', present.length, present.length);
      for (const item of present) this.emit(this.status(item.documentId));
      return { ok: true, libraryPath: moved.root, error: null };
    } catch (error) {
      const code = migrationErrorCode(error);
      report('failed', 0, 0, code);
      // Best-effort removal of the partial destination copy — but only if the
      // switch never happened. Once switched, `target` IS the live library.
      if (!switched && target) {
        await rm(target.root, { recursive: true, force: true }).catch(() => {});
      }
      return { ok: false, libraryPath: null, error: code };
    } finally {
      this.migrating = false;
    }
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

/** A short, non-sensitive code for a migration failure. Maps the guard errors
 *  from `validateDestinationBase` and the copy/verify steps to stable codes the
 *  renderer turns into a message — a raw path or error string never leaves. */
function migrationErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('not an absolute path')) return 'bad-path';
  if (message.includes('does not exist')) return 'missing-folder';
  if (message.includes('not a directory')) return 'not-a-directory';
  if (message.includes('inside app data')) return 'inside-app-data';
  if (message.includes('inside a Pidom library')) return 'inside-library';
  if (message.includes('same as current')) return 'same-location';
  if (message.includes('not enough space')) return 'no-space';
  if (message.includes('verify mismatch')) return 'verify-failed';
  if (message.includes('Not signed in')) return 'signed-out';
  return 'move-failed';
}
