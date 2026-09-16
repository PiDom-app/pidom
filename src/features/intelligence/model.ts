/**
 * The model, the versions, and every bound this feature spends.
 *
 * `convex/model/limits.ts` holds the same kind of list for the public API and
 * states the rule this file follows: **every constant carries the reason for
 * its number. A limit with no reason gets raised the first time somebody hits
 * it.**
 *
 * The two version strings are the most important things here. They are written
 * onto every chunk and every vector, and nothing ever reads a row whose version
 * does not match the one it is asking with — so improving the chunker or the
 * model writes a second index alongside the first and switches when it is
 * complete, rather than mutating one the reader is searching.
 */

/**
 * `intfloat/multilingual-e5-small`, INT8 ONNX. 384 dimensions, 94 languages,
 * MIT.
 *
 * Chosen over an English-only model a quarter of its size for one reason: a
 * personal library is not guaranteed to stay in one language, and the embedding
 * model is the worst place in this system to make a decision that later forces
 * a re-index of every book on the device. 384 also keeps a passage at 388 bytes
 * where 768 would make it 772 and 1536 would make it 1540 — which matters when
 * the unit is thousands of passages a book.
 *
 * The string is a version rather than a name. Re-quantising the same weights
 * produces different vectors, so a new artefact is a new version even when the
 * model card has not changed.
 */
export const MODEL_VERSION = 'multilingual-e5-small-int8@1';

/** The model's own output width. Not a choice; asserted against the session. */
export const EMBEDDING_DIMENSIONS = 384;

/**
 * The chunker's version, bumped whenever its output would differ.
 *
 * Separate from the model version because the two change for different reasons
 * and a reader should not re-run an evening of inference because a sentence
 * splitter got better at abbreviations.
 */
export const CHUNK_VERSION = 1;

/**
 * E5 wants a role on every input, and omitting it measurably degrades results.
 *
 * `passage:` for what is stored, `query:` for what is asked. The two are not
 * interchangeable and using one for both is the most common way this family of
 * model is got wrong.
 */
export const PASSAGE_PREFIX = 'passage: ';
export const QUERY_PREFIX = 'query: ';

/**
 * The repository `from_pretrained` resolves.
 *
 * `Xenova/`, not `intfloat/`, because this is the mirror with the ONNX
 * artefacts in it and the conversion layout Transformers.js expects. The
 * weights are the same weights and the licence is the upstream MIT.
 */
export const MODEL_ID = 'Xenova/multilingual-e5-small';

/** The quantisation `from_pretrained` is asked for. `q8` is the INT8 build. */
export const MODEL_DTYPE = 'q8';

/**
 * The artefacts, their sizes, and the digest the weights are refused without.
 *
 * 129 MB is a lot to ask a reader for, and the settings screen asks plainly.
 * The digest is why it can be asked at all: a model file is executable input to
 * a native graph loader, fetched over the network and signed by nothing this
 * application controls, so it is checked against a known value before a session
 * is ever opened and a mismatch deletes it rather than trying it.
 *
 * **The digest is a frame chain, not a file hash**, because `expo-crypto` has
 * no incremental digest and this file is 113 MB: `carried = sha256(carried ||
 * frame)` over 8 MB frames, which is what `model-store.ts:digestOf` computes
 * and what the value below was produced by over the same URL. Changing
 * `HASH_FRAME_BYTES` changes it.
 *
 * Sizes are the exact byte counts, not rounded — a download one byte short is a
 * download that failed, and a size rounded for display cannot say so.
 */
export const MODEL_FILES = {
  model: {
    name: 'model_quantized.onnx',
    bytes: 118_054_593,
    digest: 'f2cbdc81acaadb43e7e047113787a35ded03f315e399feac5eec433eb4c1ed9e',
  },
  tokenizer: {
    name: 'tokenizer.json',
    bytes: 17_082_730,
    digest: '924aefae0e858866e282edb496d492a640d9f2fc70d3405057d37d2868ce0d9a',
  },
} as const;

/** What the settings screen says, and what the hold in `policy.ts` guards. */
export const MODEL_TOTAL_BYTES = MODEL_FILES.model.bytes + MODEL_FILES.tokenizer.bytes;

/**
 * Characters hashed at a time when verifying a downloaded artefact.
 *
 * `expo-crypto` has no streaming digest and `validate.ts:HASHABLE_BYTE_MAX`
 * caps whole-file hashing at 32 MB for that reason, which a 113 MB model is
 * well past. The file is read in frames and the frame digests are folded, which
 * is not SHA-256 of the file and does not pretend to be — it is a digest over a
 * digest chain, pinned to the same constant the download was checked against.
 */
export const HASH_FRAME_BYTES = 8 * 1024 * 1024;

/**
 * The model's own ceiling. Longer inputs are truncated by the tokenizer.
 *
 * E5's card says results past 512 tokens are not recommended, and the chunker's
 * target sits well inside it so truncation is a safety net rather than the
 * normal path.
 */
export const MAX_TOKENS = 512;

/**
 * The passage size the chunker aims at, in characters.
 *
 * Roughly 350 to 700 words at the four-to-five characters a word that English
 * and most Latin-script languages average. Small enough that a hit points at
 * something a reader can locate on the page; large enough that a single
 * sentence's worth of context does not dominate the vector. The exact numbers
 * are worth revisiting against a real corpus, and the `chunkVersion` beside
 * them is what makes revisiting them safe.
 */
export const CHUNK_TARGET_CHARS = 2_200;
export const CHUNK_MIN_CHARS = 400;
export const CHUNK_MAX_CHARS = 3_200;

/**
 * How much of the previous passage the next one repeats.
 *
 * An argument that straddles a boundary is otherwise findable by neither half.
 * One short paragraph is enough to carry the antecedent of a "this" across the
 * join, and more would inflate the index for the same recall.
 */
export const CHUNK_OVERLAP_CHARS = 240;

/**
 * Pages one passage may span.
 *
 * A citation has to be something the reader can act on, and "somewhere in these
 * five pages" is not. Three is enough to absorb a page break mid-paragraph and
 * a short page between two long ones.
 */
export const CHUNK_MAX_PAGES = 3;

/**
 * Passages embedded in one pass through the model.
 *
 * The floor of the adaptive range. Every batch is one set of tensors allocated
 * and released, so a small batch is more overhead and a large one is more peak
 * memory — and peak memory on a mid-range Android device is the thing that ends
 * the process. `onnx-engine.ts` halves this on the way down when a batch
 * throws, and does not grow it back inside one job.
 */
export const BATCH_MIN = 8;
export const BATCH_START = 32;
export const BATCH_MAX = 64;

/**
 * Pages read from the mirror in one go while chunking.
 *
 * A page is capped at `PAGE_TEXT_MAX` (8 KiB) by the extraction that produced
 * it, so 64 pages is at most half a megabyte of strings alive at once. The
 * chunker is a pure function over what this returns, which is what lets it be
 * tested under Node beside `outcome.test.ts`.
 */
export const PAGE_WINDOW = 64;

/**
 * Documents whose vectors a library-wide search will scan chunk-by-chunk.
 *
 * The first stage compares one vector a document, which is a hundred dot
 * products for a hundred books. Only the documents that survive it are opened,
 * because the second stage is thousands of dot products each and doing it for
 * the whole library is the difference between a keystroke and a second.
 */
export const LIBRARY_CANDIDATES = 6;

/** Passages a search returns, before the two rankings are fused. */
export const RETRIEVE_POOL = 40;

/**
 * How far either side of the reader's page counts as "near".
 *
 * A question asked on page 300 about something the author said earlier should
 * prefer page 290 to page 20 when the two are otherwise equally relevant.
 * Reciprocal rank alone will not do that, so the boost is explicit and small —
 * it breaks ties rather than deciding results.
 */
export const NEAR_PAGES = 40;
export const NEAR_WEIGHT = 0.15;

/**
 * The constant in reciprocal-rank fusion.
 *
 * The standard 60. It is what stops the top hit of one ranking dominating a
 * result that the other ranking also found, three places down — which is the
 * whole reason to fuse rather than concatenate.
 */
export const RRF_K = 60;

/**
 * The battery floor below which indexing waits.
 *
 * Indexing a long book is minutes of sustained inference. Doing it at 12% on a
 * phone somebody is reading on is spending the thing they need for the reading.
 * Ignored while charging.
 */
export const BATTERY_FLOOR = 0.2;

/**
 * Messages of a conversation kept on the device.
 *
 * Enough that the screen reopened in a tunnel shows the answer that was just read,
 * and few enough that this cannot quietly become a permanent copy of every
 * conversation the account deletes after a month.
 */
export const ASK_CACHE_MESSAGES = 20;

/** Bytes a passage costs: 384 signed values and the float that scales them. */
export const BYTES_PER_VECTOR = EMBEDDING_DIMENSIONS + 4;
