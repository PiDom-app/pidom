/**
 * The model, running on the phone.
 *
 * This is the only file in the feature that knows what ONNX is, and that is the
 * point of `embedding-engine.ts` sitting in front of it. **It is also the only
 * file here that cannot be proven without a device build** — a native graph
 * runtime's behaviour under memory pressure on a mid-range Android handset is
 * not something a test under Node has an opinion about. Everything above the
 * seam is tested; this is benchmarked.
 *
 * **The library does the loading, not this file.** `@huggingface/transformers`
 * resolves the repository, picks the `q8` artefacts, runs the tokenizer and
 * pools the output, and `@automatalabs/react-native-transformers` aliases its
 * ONNX backend at `onnxruntime-react-native` in `metro.config.js`. A hand-rolled
 * session would mean re-implementing an XLM-RoBERTa tokenizer in JavaScript,
 * which is a sentencepiece model and several hundred lines of Unicode
 * normalisation nobody should write twice.
 *
 * **Three things this file does own**, because the library has no view on them:
 *
 * 1. **Where the weights live.** `configureTransformersEnvironment` points the
 *    cache at the profile's own directory under `Documents` rather than the
 *    default under `Paths.cache`, which the operating system empties.
 * 2. **The batch size, adaptively.** Peak memory is what ends a process on a
 *    mid-range device, so a batch that throws halves the next one and does not
 *    grow back inside a job.
 * 3. **Releasing the session.** The model is over a hundred megabytes resident.
 *    Holding it while somebody reads is the difference between a reader and a
 *    reader whose phone is warm.
 */
import { log } from '@/lib/logger';

import {
  BATCH_MAX,
  BATCH_MIN,
  BATCH_START,
  EMBEDDING_DIMENSIONS,
  MAX_TOKENS,
  MODEL_DTYPE,
  MODEL_ID,
  PASSAGE_PREFIX,
  QUERY_PREFIX,
} from '../model';
import { normalise, quantise, type Quantised } from '../retrieve/vectors';
import type { EmbeddingEngine, EngineStatus } from './embedding-engine';
import { modelDirectory, modelPresent, verifyModel } from './model-store';

const SCOPE = 'intelligence-onnx';

/**
 * The library, imported once and lazily.
 *
 * A dynamic import rather than a top-level one, and this is load-bearing: a
 * static import would pull the whole of Transformers.js — every tokenizer, every
 * model class, the pipeline registry — into the bundle that renders the library
 * screen, on a cold launch, for a reader who may never open Ask. The first
 * `embed` pays for it instead.
 */
type Transformers = typeof import('@huggingface/transformers');
type ProgressCallback = NonNullable<
  Parameters<Transformers['AutoTokenizer']['from_pretrained']>[1]
>['progress_callback'];

let library: Promise<Transformers> | null = null;

function transformers(): Promise<Transformers> {
  library ??= import('@huggingface/transformers');
  return library;
}

/** One loaded model, its tokenizer, and the profile they were loaded for. */
type Session = {
  profileId: string;
  tokenizer: Awaited<ReturnType<Transformers['AutoTokenizer']['from_pretrained']>>;
  model: Awaited<ReturnType<Transformers['AutoModel']['from_pretrained']>>;
};

let session: Session | null = null;
let opening: Promise<Session> | null = null;
let batchSize = BATCH_START;

/**
 * Points the library's cache at this profile's directory.
 *
 * Idempotent and cheap, so it runs before every load rather than being tracked:
 * the profile can change while the process lives, and a cache still pointed at
 * the previous account's directory would be a model one reader downloaded
 * appearing to belong to another.
 */
async function configure(profileId: string): Promise<void> {
  const runtime = await import('@automatalabs/react-native-transformers');
  runtime.installTransformersReactNativeGlobals();

  // The one cast in this feature, and it is between two libraries' declarations
  // of the same object rather than around a value this file knows better than
  // the compiler. The shim types `env.customCache.match` as returning a
  // `Response`; Transformers.js types the same method as returning a `Response`
  // *or a string or a FileResponse*, which is what its own file-backed cache
  // returns. The shim's cache is one of the things it accepts, so the runtime
  // behaviour is right and the declarations simply do not meet.
  runtime.configureTransformersEnvironment(
    (await transformers()) as unknown as Parameters<
      typeof runtime.configureTransformersEnvironment
    >[0],
    {
      customCache: runtime.createExpoFileSystemCache({ directory: modelDirectory(profileId) }),
      enableCustomCache: true,
      allowRemoteModels: true,
    },
  );
}

/**
 * Opens the session, or returns the one that is already open.
 *
 * The `opening` promise is the same guard `db.ts` uses for the database handle:
 * two passes of the index queue starting at once must share one load rather
 * than each paying a hundred megabytes for their own.
 *
 * `verifyModel` is inside the guard deliberately. A session is never opened on
 * weights that have not been checked, and doing it here rather than at the
 * download means a file swapped on disk between launches is still caught.
 */
async function open(profileId: string): Promise<Session> {
  if (session !== null && session.profileId === profileId) {
    return session;
  }
  if (session !== null) {
    await release();
  }

  opening ??= (async () => {
    await configure(profileId);
    await verifyModel(profileId);

    const { AutoModel, AutoTokenizer } = await transformers();
    log.debug(SCOPE, 'opening the model');

    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
    const model = await AutoModel.from_pretrained(MODEL_ID, { dtype: MODEL_DTYPE });

    const next: Session = { profileId, tokenizer, model };
    session = next;
    return next;
  })();

  try {
    return await opening;
  } finally {
    opening = null;
  }
}

/**
 * Fetches the weights without keeping them loaded.
 *
 * What `model-store.downloadModel` calls. `from_pretrained` is the only thing
 * that knows which files the repository actually has, so warming through it is
 * the only way to be sure the download and the load agree — and it reports
 * progress across every file, which is the number the consent screen promised.
 */
export async function warmModel(
  profileId: string,
  onProgress?: (received: number) => void,
): Promise<void> {
  await configure(profileId);
  const { AutoModel, AutoTokenizer } = await transformers();

  // The library reports per-file progress as one arm of a six-way union — the
  // others announce that a download started, finished, or that the model is
  // ready, and carry no byte count. The reader is watching one number, so the
  // files are summed: the total is only accurate once every file has reported
  // once, and is monotonic after that.
  const received = new Map<string, number>();
  const progress_callback: ProgressCallback = (event) => {
    if (event.status !== 'progress') {
      return;
    }
    received.set(event.file, event.loaded);
    let total = 0;
    for (const value of received.values()) {
      total += value;
    }
    onProgress?.(total);
  };

  await AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback });
  const model = await AutoModel.from_pretrained(MODEL_ID, {
    dtype: MODEL_DTYPE,
    progress_callback,
  });

  // Dropped straight away. Downloading is not reading, and the reader who just
  // agreed to 129 MB should not also be holding it resident.
  await disposeModel(model);
}

async function disposeModel(model: unknown): Promise<void> {
  try {
    const disposable = model as { dispose?: () => Promise<void> | void };
    await disposable.dispose?.();
  } catch (error) {
    log.debug(SCOPE, 'the session would not dispose', error);
  }
}

export async function release(): Promise<void> {
  const current = session;
  session = null;
  batchSize = BATCH_START;
  if (current !== null) {
    log.debug(SCOPE, 'releasing the model');
    await disposeModel(current.model);
  }
}

/**
 * Mean pooling over the attention mask, then unit length.
 *
 * E5 is a sentence-transformers model and its pooling is part of the model
 * rather than of the graph: the ONNX export ends at `last_hidden_state`, so the
 * average over the non-padding tokens has to happen here. Averaging over the
 * padding as well — which is what skipping the mask does — makes a short
 * passage's vector drift towards whatever the pad token embeds to, and the
 * shorter the passage the more it drifts.
 */
function pool(
  hidden: Float32Array,
  mask: BigInt64Array | Int32Array | number[],
  row: number,
  tokens: number,
): Float32Array {
  const out = new Float32Array(EMBEDDING_DIMENSIONS);
  let counted = 0;

  for (let token = 0; token < tokens; token += 1) {
    const raw = mask[row * tokens + token];
    if (Number(raw) === 0) {
      continue;
    }
    const base = (row * tokens + token) * EMBEDDING_DIMENSIONS;
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i += 1) {
      out[i] += hidden[base + i];
    }
    counted += 1;
  }

  if (counted > 0) {
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i += 1) {
      out[i] /= counted;
    }
  }
  return normalise(out);
}

/** One forward pass over a batch, returning normalised, quantised vectors. */
async function runBatch(current: Session, texts: readonly string[]): Promise<Quantised[]> {
  const inputs = await current.tokenizer(texts as string[], {
    padding: true,
    truncation: true,
    max_length: MAX_TOKENS,
  });

  const output = await current.model(inputs);
  const hidden = output.last_hidden_state;
  const [rows, tokens, width] = hidden.dims as number[];

  if (width !== EMBEDDING_DIMENSIONS) {
    // The whole index is keyed on this number. A model that returned a
    // different width would write vectors nothing could ever score against,
    // silently, for the life of the index.
    throw new Error(`the model returned ${width} dimensions, not ${EMBEDDING_DIMENSIONS}`);
  }

  const values = hidden.data as Float32Array;
  const mask = inputs.attention_mask.data as BigInt64Array;

  const out: Quantised[] = [];
  for (let row = 0; row < rows; row += 1) {
    out.push(quantise(pool(values, mask, row, tokens)));
  }
  return out;
}

/**
 * The engine, for one profile.
 *
 * A function rather than a singleton because the profile is not knowable at
 * module scope, and the session underneath it *is* a singleton — two engines
 * for one profile share one loaded model, which is the only affordable
 * arrangement at this size.
 */
export function onnxEngine(profileId: string): EmbeddingEngine {
  return {
    async status(): Promise<EngineStatus> {
      if (!modelPresent(profileId)) {
        return { kind: 'absent' };
      }
      if (session !== null && session.profileId === profileId) {
        return { kind: 'loaded' };
      }
      return { kind: 'ready' };
    },

    async embed(texts, role): Promise<Quantised[]> {
      if (texts.length === 0) {
        return [];
      }

      const current = await open(profileId);
      const prefix = role === 'query' ? QUERY_PREFIX : PASSAGE_PREFIX;
      const prefixed = texts.map((text) => `${prefix}${text}`);
      const out: Quantised[] = [];

      for (let at = 0; at < prefixed.length; ) {
        const size = Math.min(batchSize, BATCH_MAX, prefixed.length - at);
        try {
          out.push(...(await runBatch(current, prefixed.slice(at, at + size))));
          at += size;
        } catch (error) {
          // Halve and retry, once per failure, down to the floor. A native
          // allocation failure is the expected case here and it is not a
          // failure of the job — it is the device saying this batch was too
          // big. Below the floor there is nothing left to try.
          if (size <= BATCH_MIN) {
            throw error;
          }
          batchSize = Math.max(BATCH_MIN, Math.floor(size / 2));
          log.debug(SCOPE, `batch of ${size} failed; trying ${batchSize}`);
        }
      }

      return out;
    },

    release,
  };
}
