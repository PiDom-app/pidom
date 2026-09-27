import { BrowserWindow, dialog, net } from 'electron';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, rename, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { basename, extname, join } from 'node:path';
import PQueue from 'p-queue';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';

import { CLOUD_BYTE_MAX } from '@convex-model/limits';
import type { ImportJobStatus } from '../../shared/ipc';
import { getDb } from '../db';
import { importJobs, localFiles, type ImportJobRow, type ImportJobState } from '../db/schema';
import type { SessionManager } from '../auth/oauth';
import { StorageConvex } from './convex-client';
import type { StorageService } from './service';
import {
  documentPath,
  fingerprintOfFile,
  isSafeDocumentId,
  mintLocalId,
  scanPdfs,
  validateSourceFile,
} from './paths';
import { getPdfAssociation, setPdfAssociation } from '../squirrel-events';

/**
 * The desktop-initiated import pipeline.
 *
 * A reader adds a PDF from this computer — file picker, folder scan, drag-drop,
 * or "Open With" — and this stages it into the same managed library
 * `StorageService` downloads into, then reconciles it onto the Convex account
 * exactly as the mobile importer does. The seam is identical to the rest of the
 * app: the renderer names a document only by id, never a path; every fs/network
 * step runs here in main; the destination filename is the id this process mints,
 * never anything the renderer sends. A dropped path is resolved in preload and
 * re-validated here regardless — the bytes decide what a file is, not its name.
 *
 * The pipeline is durable per `import_jobs` row so a killed run resumes:
 *   staging → staged (on disk, readable OFFLINE) → registering → registered
 *   (reconciled to the Convex id) → uploading → uploaded → done.
 * Steps past `staged` need auth; when it is absent they wait, and the drain queue
 * advances them the moment `SessionManager` reports signed-in.
 */

/** Every PDF begins with this. A renamed non-PDF fails here, whatever its name. */
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

/** Presentation title cap; the id, not the title, is ever a path segment. */
const MAX_TITLE = 200;

/** Smallest gap between two upload-progress emits, matching the download path.
 *  The PUT flushes far faster than a tile needs to repaint. */
const PROGRESS_INTERVAL_MS = 200;

/** Import states whose jobs the drain queue still has network work to finish. */
const PENDING: ImportJobState[] = ['staged', 'registering', 'registered', 'uploading', 'uploaded'];

type ImportListener = (jobs: ImportJobStatus[]) => void;
type OpenListener = (documentId: string) => void;

export class ImportService {
  private readonly session: SessionManager;
  private readonly storage: StorageService;
  private readonly convex: StorageConvex;
  private readonly listeners = new Set<ImportListener>();
  private readonly openListeners = new Set<OpenListener>();
  /** One queue serializes staging and network advances; concurrency 1 keeps the
   *  main process's fs/network work orderly and bounded, mirroring StorageService. */
  private readonly queue = new PQueue({ concurrency: 1 });
  /** localIds whose network advance is already queued, so a drain never runs one
   *  twice. Cleared when the advance settles. */
  private readonly advancing = new Set<string>();
  /** Transient R2 PUT progress, keyed by localId. In memory only — an upload bar
   *  is worth no database churn, and a killed run restarts the PUT from zero. */
  private readonly uploadProgress = new Map<string, number>();

  constructor(session: SessionManager, storage: StorageService) {
    this.session = session;
    this.storage = storage;
    this.convex = new StorageConvex(session);
    // The moment auth returns, finish every job that was waiting on the network.
    this.session.onChange((state) => {
      if (state.status === 'signed-in') void this.drain();
    });
  }

  onChange(listener: ImportListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Subscribe to "open this document" events raised when the OS launches us with
   *  a file (double-click / "Open With" / Open Recent). Returns an unsubscribe. */
  onOpen(listener: OpenListener): () => void {
    this.openListeners.add(listener);
    return () => this.openListeners.delete(listener);
  }

  private emit(): void {
    const jobs = this.list();
    for (const listener of this.listeners) listener(jobs);
  }

  private notifyOpen(documentId: string): void {
    for (const listener of this.openListeners) listener(documentId);
  }

  /** Every import job as the renderer sees it — never a filesystem path. */
  list(): ImportJobStatus[] {
    const db = getDb();
    return db
      .select()
      .from(importJobs)
      .all()
      .map((row) => this.rowToStatus(row));
  }

  private rowToStatus(row: ImportJobRow): ImportJobStatus {
    return {
      localId: row.localId,
      title: row.title,
      state: row.state,
      byteSize: row.byteSize,
      // Live only while the R2 PUT is running; null the moment it settles, so the
      // bar fills during `uploading` and the tile falls back to a state label after.
      receivedBytes: row.state === 'uploading' ? (this.uploadProgress.get(row.localId) ?? 0) : null,
      documentId: row.documentId,
      error: row.error,
    };
  }

  private jobOrThrow(localId: string): ImportJobRow {
    const db = getDb();
    const job = db.select().from(importJobs).where(eq(importJobs.localId, localId)).get();
    if (!job) throw new Error('import job vanished');
    return job;
  }

  // ---- acquisition ---------------------------------------------------------

  /** Opens the OS file picker (PDF filter, multi-select), stages every chosen
   *  file, and returns how many were queued. No path crosses back to a caller. */
  async pickFiles(): Promise<number> {
    const parent = activeWindow();
    const options: Electron.OpenDialogOptions = {
      title: 'Import PDFs',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return 0;
    return this.addPaths(result.filePaths);
  }

  /** Opens the OS folder picker, scans it for PDFs (bounded), stages them, and
   *  returns how many were queued. */
  async pickFolder(): Promise<number> {
    const parent = activeWindow();
    const options: Electron.OpenDialogOptions = {
      title: 'Import a folder of PDFs',
      properties: ['openDirectory'],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return 0;
    const files = await scanPdfs(result.filePaths[0]);
    return this.addPaths(files);
  }

  /** Stages a batch of paths — from a picker, a folder scan, or drops resolved in
   *  preload. Every path is untrusted and re-validated in `stageOne` regardless
   *  of origin. Returns how many were accepted for staging. */
  async addPaths(paths: string[]): Promise<number> {
    if (!Array.isArray(paths)) return 0;
    let queued = 0;
    for (const path of paths) {
      if (typeof path !== 'string' || path.length === 0) continue;
      queued += 1;
      void this.stage(path).catch(() => {
        /* per-file failures are recorded on the job row, never thrown to a batch */
      });
    }
    return queued;
  }

  /** Enqueues one staging pass and resolves with the id to open (the new localId,
   *  or an existing twin's id on a local dedup), or null on rejection. */
  private stage(sourcePath: string): Promise<string | null> {
    return this.queue.add(() => this.stageOne(sourcePath)) as Promise<string | null>;
  }

  // ---- staging (offline-first) ---------------------------------------------

  /**
   * Validates one untrusted path, then stages its bytes into the managed library
   * under a device-minted id and records the local rows — after which the
   * document is fully readable with no network. Returns the id to open on
   * success, an existing twin's id when the same bytes are already held, or
   * throws (recorded as a failed job) on rejection.
   */
  private async stageOne(sourcePath: string): Promise<string | null> {
    this.storage.throwIfBusy();
    const { canonical, size } = await validateSourceFile(sourcePath);
    const fingerprint = await fingerprintOfFile(canonical, size);

    // Skip bytes a live job already holds. The server dedups too, but this avoids
    // a needless second copy on disk and a duplicate tile in the grid.
    const db = getDb();
    const twin = db
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.fingerprint, fingerprint), ne(importJobs.state, 'failed')))
      .get();
    if (twin) return twin.documentId ?? twin.localId;

    const localId = mintLocalId();
    const title = titleFromPath(canonical);
    const originalName = basename(canonical);
    const paths = await this.storage.resolvePaths();
    const finalPath = documentPath(paths, localId);
    const partPath = join(paths.tmp, `${localId}-${Date.now()}.part`);

    db.insert(importJobs)
      .values({
        localId,
        title,
        originalName,
        byteSize: size,
        fingerprint,
        state: 'staging',
        updatedAt: Date.now(),
      })
      .run();
    this.emit();

    try {
      const contentHash = await stageCopy(canonical, partPath, size);
      // Re-check right before the move: a migration may have begun while the
      // (slow) copy above ran, and `moveLibrary` walks `documents/` — renaming a
      // new file in mid-walk could copy a half or drop it. The throw is caught
      // below, which removes the `.part` and fails the job for a clean retry once
      // the move finishes. The `.part` sits under the *old* tmp, outside the tree
      // being copied out, so it never rides along.
      this.storage.throwIfBusy();
      // Atomic within the volume: the reader only ever sees a fully-formed file.
      await rename(partPath, finalPath);
      db.transaction((tx) => {
        tx.update(importJobs)
          .set({ state: 'staged', contentHash, updatedAt: Date.now() })
          .where(eq(importJobs.localId, localId))
          .run();
        tx.insert(localFiles)
          .values({
            documentId: localId,
            path: finalPath,
            hash: contentHash,
            bytes: size,
            version: contentHash,
            state: 'available',
            updatedAt: Date.now(),
          })
          .onConflictDoUpdate({
            target: localFiles.documentId,
            set: {
              path: finalPath,
              hash: contentHash,
              bytes: size,
              version: contentHash,
              state: 'available',
              updatedAt: Date.now(),
            },
          })
          .run();
      });
    } catch (error) {
      await rm(partPath, { force: true });
      this.fail(localId, importErrorCode(error));
      return null;
    }

    this.emit();
    this.storage.emitStatus(localId);
    // Reading works now. Push the network steps as far as auth currently allows.
    this.enqueueAdvance(localId);
    return localId;
  }

  // ---- network advance (register → upload → done) --------------------------

  /** Advances every job still waiting on the network. Called at startup and
   *  whenever auth returns. Safe to call repeatedly — queued jobs are skipped. */
  async drain(): Promise<void> {
    if (this.session.getState().status !== 'signed-in') return;
    const db = getDb();
    const jobs = db.select().from(importJobs).where(inArray(importJobs.state, PENDING)).all();
    for (const job of jobs) this.enqueueAdvance(job.localId);
  }

  private enqueueAdvance(localId: string): void {
    if (this.advancing.has(localId)) return;
    this.advancing.add(localId);
    void this.queue.add(() => this.advance(localId)).finally(() => this.advancing.delete(localId));
  }

  /**
   * Runs the remaining network steps for one job, from wherever it stopped, so a
   * killed run resumes cleanly. Register mints (or recovers) the Convex id and
   * re-keys the local copy onto it; upload PUTs the bytes and attaches them,
   * unless the account already holds this file (dedup) — then no second upload.
   */
  private async advance(localId: string): Promise<void> {
    if (this.session.getState().status !== 'signed-in') return;
    const db = getDb();
    let job = db.select().from(importJobs).where(eq(importJobs.localId, localId)).get();
    if (!job || !PENDING.includes(job.state)) return;

    try {
      if (job.state === 'staged' || job.state === 'registering') {
        this.setState(localId, 'registering');
        const remoteId = await this.convex.importDocument({
          title: job.title,
          byteSize: job.byteSize,
          localId,
          // Parity with the mobile importer: the account records what kind of file
          // this is and when the device imported it, so a desktop-imported document
          // is indistinguishable from one added on the phone. `author`/`pageCount`
          // come from the PDF probe, which is renderer-only work desktop does not
          // run yet — so they are sent only when a prior step happened to fill them.
          mimeType: 'application/pdf',
          clientUpdatedAt: Date.now(),
          ...(job.fingerprint ? { fingerprint: job.fingerprint } : {}),
          ...(job.originalName ? { originalFileName: job.originalName } : {}),
          ...(typeof job.pageCount === 'number' ? { pageCount: job.pageCount } : {}),
        });
        if (!isSafeDocumentId(remoteId)) throw new Error('bad remote id');
        await this.reconcile(localId, remoteId);
        job = this.jobOrThrow(localId);
      }

      const remoteId = job.documentId;
      if (!remoteId) throw new Error('missing remote id');

      if (job.state === 'registered' || job.state === 'uploading') {
        this.setState(localId, 'uploading');
        const uploaded = await this.uploadBytes(localId, remoteId);
        this.uploadProgress.delete(localId);
        this.setState(localId, uploaded ? 'uploaded' : 'duplicate');
        if (!uploaded) return; // collapsed onto an already-synced document
      }

      this.setState(localId, 'done');
    } catch (error) {
      this.fail(localId, importErrorCode(error));
    }
  }

  /**
   * Moves the staged `<localId>.pdf` onto its Convex id and re-keys the local
   * records to it, so the copy is `available` under the real id the instant that
   * document arrives through `snapshot`. Tolerant of a partial prior run: a
   * destination that already exists wins and the redundant staged bytes are
   * dropped.
   */
  private async reconcile(localId: string, remoteId: string): Promise<void> {
    const db = getDb();
    const paths = await this.storage.resolvePaths();
    const from = documentPath(paths, localId);
    const to = documentPath(paths, remoteId);

    const destExists = await stat(to).then(
      () => true,
      () => false,
    );
    if (destExists) {
      await rm(from, { force: true });
    } else {
      await rename(from, to).catch(async (err) => {
        // A missing source means a prior run already reconciled; tolerate that.
        const stillThere = await stat(from).then(
          () => true,
          () => false,
        );
        if (stillThere) throw err;
      });
    }

    const src = db.select().from(localFiles).where(eq(localFiles.documentId, localId)).get();
    db.transaction((tx) => {
      tx.insert(localFiles)
        .values({
          documentId: remoteId,
          path: to,
          hash: src?.hash ?? null,
          bytes: src?.bytes ?? null,
          version: src?.version ?? null,
          state: 'available',
          updatedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: localFiles.documentId,
          set: { path: to, state: 'available', updatedAt: Date.now() },
        })
        .run();
      tx.delete(localFiles).where(eq(localFiles.documentId, localId)).run();
      tx.update(importJobs)
        .set({ documentId: remoteId, state: 'registered', updatedAt: Date.now() })
        .where(eq(importJobs.localId, localId))
        .run();
    });
    this.emit();
    this.storage.emitStatus(localId); // the local-only id is now 'none'
    this.storage.emitStatus(remoteId); // the Convex id is now 'available'
  }

  /** PUTs a document's local bytes to R2 and attaches them, reporting PUT progress
   *  as it goes. Returns false when the account already holds this file (server
   *  `ALREADY_SYNCED`) — a dedup, not an error, so no second upload happens. */
  private async uploadBytes(localId: string, remoteId: string): Promise<boolean> {
    const path = this.storage.availablePath(remoteId);
    if (!path) throw new Error('local copy missing');

    let target: { key: string; url: string };
    try {
      target = await this.convex.uploadUrl(remoteId);
    } catch (error) {
      if (isAlreadySynced(error)) return false;
      throw error;
    }

    const url = new URL(target.url);
    if (url.protocol !== 'https:') throw new Error('non-https URL');
    // Read whole so the PUT carries an exact Content-Length — the chunks below are
    // a progress device written under that fixed length, never a chunked-transfer
    // body, which an R2 presigned PUT would reject against its signature.
    const body = await readFile(path);
    this.uploadProgress.set(localId, 0);
    this.emit();
    let lastEmit = 0;
    await putFixedLength(url, body, 'application/pdf', (sent) => {
      this.uploadProgress.set(localId, sent);
      const now = Date.now();
      if (sent >= body.byteLength || now - lastEmit >= PROGRESS_INTERVAL_MS) {
        lastEmit = now;
        this.emit();
      }
    });

    // `syncMetadata` is a mutation that only *schedules* the R2 HEAD-and-record
    // (`ctx.scheduler.runAfter(0, …)` in the component), so it returns before the
    // object's size/type/digest exist server-side. The mobile uploader gets away
    // with attaching straight after because its re-renders and network round
    // trips outlast that schedule; here in main the two mutations fire
    // back-to-back over one fast connection and lose the race, and `attachUpload`
    // reads null metadata and throws INVALID ("no longer available"). Give the
    // scheduled record time to land, retrying the attach with backoff.
    await this.convex.syncMetadata(target.key);
    await this.attachWhenSynced(remoteId, target.key);
    return true;
  }

  /**
   * Attaches an uploaded object, tolerating the window before its scheduled
   * `syncMetadata` record exists. A short wait before the first try clears that
   * window in the common case (no failed attach in the server log); a slow
   * schedule resolves within the growing backoff. Only "no longer available" is
   * transient — a wrong key, a non-PDF, or an over-size object is permanent and
   * rethrown at once. Exhausting the backoff fails the job, which the drain queue
   * and a manual retry both resume idempotently.
   */
  private async attachWhenSynced(remoteId: string, key: string): Promise<void> {
    const waits = [250, 500, 1000, 2000, 3500];
    for (let attempt = 0; attempt < waits.length; attempt += 1) {
      await delay(waits[attempt]);
      try {
        await this.convex.attachUpload(remoteId, key);
        return;
      } catch (error) {
        const last = attempt === waits.length - 1;
        if (last || !isUploadNotYetSynced(error)) throw error;
      }
    }
  }

  // ---- job control ---------------------------------------------------------

  /** Cancels an import: removes its job, staged file, and local-file record. Only
   *  a not-yet-synced job is cancellable this way; a `done`/`duplicate` document
   *  is a normal account document, managed through the library instead. */
  async cancel(localId: string): Promise<void> {
    const db = getDb();
    const job = db.select().from(importJobs).where(eq(importJobs.localId, localId)).get();
    if (!job) return;
    const targetId = job.documentId ?? localId;
    const row = db.select().from(localFiles).where(eq(localFiles.documentId, targetId)).get();
    if (row?.path) await rm(row.path, { force: true });
    db.transaction((tx) => {
      tx.delete(localFiles).where(eq(localFiles.documentId, targetId)).run();
      tx.delete(localFiles).where(eq(localFiles.documentId, localId)).run();
      tx.delete(importJobs).where(eq(importJobs.localId, localId)).run();
    });
    this.emit();
    this.storage.emitStatus(localId);
    if (job.documentId) this.storage.emitStatus(job.documentId);
  }

  /** Retries a failed import from where it stopped. If the staged bytes are gone,
   *  there is nothing to resume and the dead job is cleared. */
  async retry(localId: string): Promise<void> {
    const db = getDb();
    const job = db.select().from(importJobs).where(eq(importJobs.localId, localId)).get();
    if (!job || job.state !== 'failed') return;
    const targetId = job.documentId ?? localId;
    if (!this.storage.availablePath(targetId)) {
      await this.cancel(localId);
      return;
    }
    // Resume at the first unfinished step: register if there is no Convex id yet,
    // otherwise upload. Both underlying calls are idempotent.
    this.setState(localId, job.documentId ? 'registered' : 'staged');
    this.enqueueAdvance(localId);
  }

  /** Retries every failed import. Returns how many were re-queued. */
  async retryAll(): Promise<number> {
    const db = getDb();
    const failed = db.select().from(importJobs).where(eq(importJobs.state, 'failed')).all();
    for (const job of failed) await this.retry(job.localId);
    return failed.length;
  }

  private setState(localId: string, state: ImportJobState): void {
    const db = getDb();
    db.update(importJobs)
      .set({ state, error: null, updatedAt: Date.now() })
      .where(eq(importJobs.localId, localId))
      .run();
    this.emit();
  }

  private fail(localId: string, code: string): void {
    this.uploadProgress.delete(localId);
    const db = getDb();
    db.update(importJobs)
      .set({
        state: 'failed',
        error: code,
        attempts: sql`${importJobs.attempts} + 1`,
        updatedAt: Date.now(),
      })
      .where(eq(importJobs.localId, localId))
      .run();
    this.emit();
  }

  // ---- Windows "Open With" association + OS launch -------------------------

  /** Whether the Pidom "Open With" handler is registered for `.pdf`. */
  getAssociation(): Promise<boolean> {
    return getPdfAssociation();
  }

  /** Registers or removes the Pidom "Open With" handler for `.pdf`. Cannot seize
   *  the default handler — that stays the reader's choice. */
  setAssociation(on: boolean): Promise<boolean> {
    return setPdfAssociation(on);
  }

  /** Handles a file the OS launched us with (double-click / "Open With" / Open
   *  Recent): stages it through the same pipeline, then asks the renderer to open
   *  it by id once a copy exists on disk. A bad path opens nothing. */
  async openExternalFile(sourcePath: string): Promise<void> {
    const id = await this.stage(sourcePath).catch(() => null);
    if (id) this.notifyOpen(id);
  }
}

/** The window a picker dialog should hang off, or null to show it detached. */
function activeWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

/** A presentation title from a picked filename: no extension, trimmed, bounded.
 *  The id, never this, is a path segment, so a hostile name only affects display. */
function titleFromPath(path: string): string {
  const stem = basename(path, extname(path)) || basename(path);
  const title = stem.trim().slice(0, MAX_TITLE).trim();
  return title.length > 0 ? title : 'Untitled';
}

/**
 * Streams a source file into a `.part`, hashing it and enforcing the `%PDF-`
 * magic and the size ceiling as the bytes flow — the same guards `runDownload`
 * applies to a network body, since a local file is untrusted input too. Returns
 * the full sha256 of what was written; the caller renames the `.part` into place.
 */
async function stageCopy(source: string, part: string, _expected: number): Promise<string> {
  const hash = createHash('sha256');
  const src = createReadStream(source);
  const sink = createWriteStream(part, { mode: 0o600 });
  const head = Buffer.alloc(PDF_MAGIC.byteLength);
  let headLength = 0;
  let total = 0;
  try {
    for await (const chunk of src as AsyncIterable<Buffer>) {
      total += chunk.byteLength;
      if (total > CLOUD_BYTE_MAX) throw new Error('exceeds size ceiling');
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
    }
    if (headLength < head.byteLength) throw new Error('not a PDF');
    await new Promise<void>((resolve, reject) =>
      sink.end((error?: Error | null) => (error ? reject(error) : resolve())),
    );
  } catch (error) {
    sink.destroy();
    src.destroy();
    throw error;
  }
  return hash.digest('hex');
}

/**
 * PUTs a fixed-length body to a presigned URL, reporting bytes flushed to the
 * socket as they go.
 *
 * `Content-Length` is set explicitly so the body is framed as one fixed-length
 * payload; the 1 MiB chunks exist only to drive the progress callback, not to
 * send `Transfer-Encoding: chunked`, which an R2 presigned PUT rejects against
 * its signature. Each chunk is written from inside the previous write's callback,
 * so the request never buffers a second copy of a large file ahead of the socket.
 */
function putFixedLength(
  url: URL,
  body: Buffer,
  contentType: string,
  onProgress: (sent: number) => void,
): Promise<void> {
  const CHUNK = 1 << 20; // 1 MiB
  return new Promise<void>((resolve, reject) => {
    const request = net.request({ method: 'PUT', url: url.toString(), credentials: 'omit' });
    request.setHeader('Content-Type', contentType);
    request.setHeader('Content-Length', String(body.byteLength));
    request.on('response', (response) => {
      const status = response.statusCode;
      response.on('data', () => {
        /* drain the body; R2 answers a PUT with an empty or short one */
      });
      response.on('end', () => {
        if (status >= 200 && status < 300) resolve();
        else reject(new Error(`server ${status}`));
      });
      response.on('error', reject);
    });
    request.on('error', reject);

    let offset = 0;
    const pump = (): void => {
      if (offset >= body.byteLength) {
        request.end();
        return;
      }
      const end = Math.min(offset + CHUNK, body.byteLength);
      const chunk = body.subarray(offset, end);
      offset = end;
      // The callback fires once the chunk is handed off, which paces the next
      // write to the socket and reports honest progress.
      request.write(chunk, undefined, () => {
        onProgress(offset);
        pump();
      });
    };
    pump();
  });
}

/** Whether a Convex error is the server's `ALREADY_SYNCED` — a dedup signal on
 *  `uploadUrl`, not a failure. `ConvexError` carries it in `.data.code`. */
function isAlreadySynced(error: unknown): boolean {
  const data = (error as { data?: unknown } | null)?.data;
  if (data && typeof data === 'object' && 'code' in data) {
    return (data as { code?: unknown }).code === 'ALREADY_SYNCED';
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('ALREADY_SYNCED');
}

/** Resolves after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Whether a Convex error is the transient window before an upload's scheduled
 *  metadata record exists — `attachUpload`'s only retryable failure. The R2
 *  component's `syncMetadata` schedules the HEAD-and-record and returns first,
 *  so a fast back-to-back `attachUpload` can read null metadata and throw this
 *  INVALID. A wrong key / non-PDF / over-size object is a *different* INVALID and
 *  is not matched here, so it is never retried. */
function isUploadNotYetSynced(error: unknown): boolean {
  const data = (error as { data?: unknown } | null)?.data;
  if (data && typeof data === 'object') {
    const d = data as { code?: unknown; message?: unknown };
    if (d.code === 'INVALID' && typeof d.message === 'string') {
      return d.message.includes('no longer available');
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('no longer available');
}

/** A short, non-sensitive code for an import failure. Never a server body or a
 *  path — those can echo a signed URL, a token, or a location. */
function importErrorCode(error: unknown): string {
  if (isUploadNotYetSynced(error)) return 'upload-not-synced';
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('not a PDF')) return 'not-a-pdf';
  if (message.includes('size ceiling') || message.includes('exceeds the size')) return 'too-large';
  if (message.includes('not an absolute path')) return 'bad-path';
  if (message.includes('does not exist')) return 'missing-file';
  if (message.includes('not a regular file')) return 'not-a-file';
  if (message.includes('empty file')) return 'empty-file';
  if (message.includes('local copy missing')) return 'missing-file';
  if (message.includes('non-https')) return 'bad-url';
  if (message.includes('library move')) return 'busy';
  if (message.includes('Not signed in') || message.includes('signed in')) return 'signed-out';
  if (message.startsWith('server ')) return 'server-error';
  return 'import-failed';
}
