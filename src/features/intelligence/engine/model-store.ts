/**
 * The 129 MB: where it lives, what it costs, and the check it is not used
 * without.
 *
 * The first version of this file downloaded and renamed the two artefacts by
 * hand. It should not have: `@huggingface/transformers` fetches its own weights
 * through a cache it owns, and a second download path for one file is a second
 * thing to get wrong — a layout mismatch between the two would show up as a
 * 129 MB re-download nobody could explain. So the library does the fetching,
 * and this file owns the three things the library has no opinion about.
 *
 * **Where.** `createExpoFileSystemCache({ directory })` points the cache at
 * `Documents/library/<profile>/model/` rather than the default under the cache
 * directory. `Paths.cache` is a directory the operating system empties whenever
 * it likes, and re-downloading 129 MB is not a thing to discover on a train.
 * Under the profile directory also means signing out of an account takes its
 * model with it.
 *
 * **What it costs.** A number on a settings screen, and a way to get the space
 * back. This is the largest single thing this application puts on a phone and
 * the reader should not have to sign out to reclaim it.
 *
 * **The check.** A model file is executable input to a native graph loader,
 * fetched over the network and signed by nothing this app controls. It is
 * verified against a size and a digest pinned in `model.ts` before a session is
 * ever opened, and a mismatch deletes it rather than trying it.
 */
import * as Crypto from 'expo-crypto';
import { Directory, File } from 'expo-file-system';

import { libraryDirectory } from '@/features/library/local/paths';
import { log } from '@/lib/logger';

import { HASH_FRAME_BYTES, MODEL_FILES, MODEL_ID, MODEL_TOTAL_BYTES } from '../model';

const SCOPE = 'intelligence-model';
const MODEL_DIR = 'model';

/**
 * Why a model is not usable, in the reader's terms rather than the runtime's.
 *
 * Every one of these has a sentence and an offer on the settings screen.
 * `tampered` is the only one that is not an accident, and it is the reason the
 * verification exists at all.
 */
export type ModelFault = 'no-space' | 'network' | 'truncated' | 'tampered' | 'unwritable';

export class ModelError extends Error {
  constructor(readonly fault: ModelFault) {
    super(fault);
    this.name = 'ModelError';
  }
}

export function modelDirectory(profileId: string): Directory {
  return new Directory(libraryDirectory(profileId), MODEL_DIR);
}

function ensureDirectory(profileId: string): Directory {
  const directory = modelDirectory(profileId);
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  return directory;
}

/**
 * Every file the cache holds, flattened.
 *
 * The layout inside the directory is the library's — organisation, repository,
 * revision, filename — and deliberately not something this file knows. What it
 * needs is "which files are here and how big", which a walk answers without
 * either of us having to agree on a path shape.
 */
function walk(directory: Directory): File[] {
  if (!directory.exists) {
    return [];
  }
  const found: File[] = [];
  for (const entry of directory.list()) {
    if (entry instanceof File) {
      found.push(entry);
    } else {
      found.push(...walk(entry));
    }
  }
  return found;
}

/** What the settings screen shows beside "Model". */
export function modelBytesOnDisk(profileId: string): number {
  try {
    return walk(modelDirectory(profileId)).reduce((total, file) => total + (file.size ?? 0), 0);
  } catch (error) {
    log.debug(SCOPE, 'could not measure the model', error);
    return 0;
  }
}

/** The weights themselves, which is the file worth verifying. */
function weightsFile(profileId: string): File | null {
  try {
    return (
      walk(modelDirectory(profileId)).find((file) => file.name === MODEL_FILES.model.name) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Whether there is a model here at all.
 *
 * Size only, and the cheap check: it runs on every launch and on every pass of
 * the index queue, and it catches the common failure, which is a download the
 * operating system killed mid-write. The expensive check runs once, on the way
 * in, and its answer is recorded.
 */
export function modelPresent(profileId: string): boolean {
  const weights = weightsFile(profileId);
  return weights !== null && weights.size === MODEL_FILES.model.bytes;
}

export { MODEL_TOTAL_BYTES, MODEL_ID };

/**
 * The folded frame digest of a file.
 *
 * `expo-crypto` has no incremental digest — `validate.ts:HASHABLE_BYTE_MAX`
 * caps whole-file hashing at 32 MB for exactly that reason, and this file is
 * 113 MB. So it is read in `HASH_FRAME_BYTES` frames and each frame's digest is
 * folded into the next: `carried = sha256(carried || frame)`.
 *
 * That is not SHA-256 of the file and does not claim to be. It is a value that
 * changes if any byte changes or if any two bytes swap places, computed without
 * ever holding more than 8 MB, and the constant in `model.ts` was computed by
 * the identical construction over the same URL.
 */
export async function digestOf(file: File): Promise<string | null> {
  let handle: ReturnType<File['open']> | null = null;
  try {
    const size = file.size ?? 0;
    if (size <= 0) {
      return null;
    }
    handle = file.open();

    let carried = new Uint8Array(0);
    for (let offset = 0; offset < size; offset += HASH_FRAME_BYTES) {
      handle.offset = offset;
      const frame = handle.readBytes(Math.min(HASH_FRAME_BYTES, size - offset));
      const joined = new Uint8Array(carried.length + frame.length);
      joined.set(carried, 0);
      joined.set(frame, carried.length);
      carried = new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, joined));
    }

    return hex(carried);
  } catch (error) {
    log.debug(SCOPE, 'could not digest the weights', error);
    return null;
  } finally {
    handle?.close();
  }
}

/**
 * Proves the weights on this device are the weights that were asked for.
 *
 * Size first, because it is free and catches every truncation. The digest is
 * fourteen frames of SHA-256 over 113 MB, which is a few seconds — so it runs
 * once, after a download, and its answer is kept in a marker file beside the
 * weights rather than being re-derived on every launch.
 *
 * A file that fails is deleted. Keeping it would mean the next launch finds a
 * model of the right size, skips the download, and hands an unverified graph to
 * a native loader — which is the entire situation this is here to prevent.
 */
export async function verifyModel(profileId: string): Promise<void> {
  const weights = weightsFile(profileId);
  if (weights === null) {
    throw new ModelError('truncated');
  }
  if (weights.size !== MODEL_FILES.model.bytes) {
    log.error(SCOPE, 'the model is the wrong size');
    deleteModel(profileId);
    throw new ModelError('truncated');
  }

  const marker = new File(modelDirectory(profileId), 'verified');
  try {
    if (marker.exists && marker.textSync() === MODEL_FILES.model.digest) {
      return;
    }
  } catch (error) {
    log.debug(SCOPE, 'could not read the verification marker', error);
  }

  const digest = await digestOf(weights);
  if (digest !== MODEL_FILES.model.digest) {
    // Never the computed value in the log. It says nothing useful to anybody
    // reading a bug report and something quite useful to whoever produced the
    // file that failed.
    log.error(SCOPE, 'the model does not match its fingerprint; removing it');
    deleteModel(profileId);
    throw new ModelError('tampered');
  }

  try {
    marker.write(MODEL_FILES.model.digest);
  } catch (error) {
    // A marker that would not write costs a few seconds on the next launch and
    // nothing else. The check itself has already passed.
    log.debug(SCOPE, 'could not record the verification', error);
  }
}

/**
 * Downloads the model, with progress, and verifies it.
 *
 * The fetching is the library's — `from_pretrained` resolves the repository,
 * picks the `q8` artefacts and writes them through the cache configured in
 * `onnx-engine.ts`. What this adds is the one thing a reader needs that the
 * library has no view on: a single number covering both files, so the screen
 * that asked for 129 MB can show it arriving.
 *
 * Deliberately not resumable. The two files are public URLs with no credential
 * in them, so a failed attempt is a retry rather than something to keep state
 * about — and `from_pretrained` skips whichever file is already cached, so the
 * retry after a failure between them costs 16 MB rather than 129.
 */
export async function downloadModel(
  profileId: string,
  onProgress?: (received: number, total: number) => void,
): Promise<void> {
  try {
    ensureDirectory(profileId);
  } catch (error) {
    log.error(SCOPE, 'could not make room for the model');
    log.debug(SCOPE, 'directory refused', error);
    throw new ModelError('unwritable');
  }

  const { warmModel } = await import('./onnx-engine');
  try {
    await warmModel(profileId, (received) => onProgress?.(received, MODEL_TOTAL_BYTES));
  } catch (error) {
    log.debug(SCOPE, 'the model would not download', error);
    throw new ModelError('network');
  }

  await verifyModel(profileId);
}

/**
 * Removes the model.
 *
 * The whole directory, including the marker and whatever layout the cache chose
 * inside it. Half a model left behind is a model the size check passes and the
 * loader refuses.
 */
export function deleteModel(profileId: string): void {
  try {
    const directory = modelDirectory(profileId);
    if (directory.exists) {
      directory.delete();
    }
  } catch (error) {
    log.debug(SCOPE, 'could not remove the model', error);
  }
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}
