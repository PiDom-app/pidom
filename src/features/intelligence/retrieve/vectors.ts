/**
 * 384 floats, as 388 bytes, and the scan over them.
 *
 * Pure arithmetic — no database, no native module — so it is tested under Node
 * beside the chunker rather than on a device.
 *
 * **Why quantised.** A passage as `Float32Array` is 1,536 bytes; as signed
 * bytes with one float to scale them it is 388. A 1,000-page book runs to
 * something over a thousand passages, so the difference across a library of a
 * hundred is around 190 MB against 48 MB — and the larger of those is not a
 * thing to put on a phone for a search feature. The error this introduces is
 * around a quarter of one per cent of the cosine, which moves nothing in a
 * top ten; `vectors.test.ts` asserts that against a float scan.
 *
 * **Why a JavaScript scan.** `sqlite-vec` is the obvious answer and is
 * unavailable: `vec.xcframework` is missing from `expo-sqlite@57.0.2`
 * (expo/expo#43455, open), so only Android could load it, and a retrieval path
 * that exists on one platform is two products. What is left is fast enough
 * because the vectors are normalised before they are stored — cosine on unit
 * vectors is a dot product, so a passage costs 384 multiply-adds over an
 * `Int8Array` view with nothing allocated in the loop. A long book's worth is
 * well under a million operations, which is single-digit milliseconds. The
 * library-wide case is kept cheap a different way: `LIBRARY_CANDIDATES` picks
 * the documents worth opening from one vector each, so the expensive scan only
 * ever runs over a handful of books.
 */
import { EMBEDDING_DIMENSIONS } from '../model';

/** A vector as it is stored: signed bytes, and the float that restores them. */
export type Quantised = { vector: Uint8Array; scale: number };

/**
 * Scales a unit vector into signed bytes.
 *
 * The scale is the largest absolute component rather than a fixed constant,
 * which is what keeps the full 127 steps of resolution for a vector whose
 * components happen to be small. Stored as `Uint8Array` because that is what
 * expo-sqlite binds to a BLOB; the values are two's-complement and read back
 * through an `Int8Array` view of the same buffer.
 */
export function quantise(values: Float32Array): Quantised {
  let peak = 0;
  for (let i = 0; i < values.length; i += 1) {
    const magnitude = Math.abs(values[i]);
    if (magnitude > peak) {
      peak = magnitude;
    }
  }

  // An all-zero vector has no scale and is not a failure — an empty passage can
  // produce one. A scale of zero would make every dot product zero, which is
  // the right answer for a vector that points nowhere.
  const scale = peak === 0 ? 0 : peak / 127;
  const out = new Uint8Array(values.length);
  const signed = new Int8Array(out.buffer);

  for (let i = 0; i < values.length; i += 1) {
    const step = scale === 0 ? 0 : Math.round(values[i] / scale);
    signed[i] = step > 127 ? 127 : step < -127 ? -127 : step;
  }

  return { vector: out, scale };
}

/** The inverse, for tests and for anything that needs the floats back. */
export function dequantise(stored: Quantised): Float32Array {
  const signed = new Int8Array(
    stored.vector.buffer,
    stored.vector.byteOffset,
    stored.vector.length,
  );
  const out = new Float32Array(signed.length);
  for (let i = 0; i < signed.length; i += 1) {
    out[i] = signed[i] * stored.scale;
  }
  return out;
}

/**
 * Cosine similarity between a query and a stored passage.
 *
 * A dot product, because both sides are unit vectors — the engine normalises
 * before it quantises, and a query is normalised the same way. Dividing by the
 * magnitudes here would be dividing by one twice.
 *
 * The integer accumulator is the point: the loop touches no floats and
 * allocates nothing, and the single multiplication by the scale happens once at
 * the end rather than 384 times.
 */
export function score(query: Float32Array, stored: Quantised): number {
  if (stored.scale === 0) {
    return 0;
  }
  const signed = new Int8Array(
    stored.vector.buffer,
    stored.vector.byteOffset,
    stored.vector.length,
  );
  const n = Math.min(query.length, signed.length);
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    total += query[i] * signed[i];
  }
  return total * stored.scale;
}

/** Unit length, in place. What the engine does before quantising. */
export function normalise(values: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i] * values[i];
  }
  const magnitude = Math.sqrt(sum);
  if (magnitude === 0) {
    return values;
  }
  for (let i = 0; i < values.length; i += 1) {
    values[i] /= magnitude;
  }
  return values;
}

/**
 * The mean of a document's passages, normalised.
 *
 * What `documentVectors` stores, and what the first stage of a library search
 * compares against. A mean is a blunt summary of a 600-page book and is the
 * right blunt summary for the question it answers, which is "is this book about
 * anything like this at all" rather than "which page".
 *
 * Accumulates in `Float64Array` because a thousand-odd additions into a
 * `Float32Array` lose the low bits of the small components, which is exactly
 * where the topical signal of a long book lives.
 */
export function mean(vectors: readonly Quantised[]): Quantised {
  const total = new Float64Array(EMBEDDING_DIMENSIONS);
  let counted = 0;

  for (const stored of vectors) {
    if (stored.scale === 0) {
      continue;
    }
    const signed = new Int8Array(
      stored.vector.buffer,
      stored.vector.byteOffset,
      stored.vector.length,
    );
    const n = Math.min(EMBEDDING_DIMENSIONS, signed.length);
    for (let i = 0; i < n; i += 1) {
      total[i] += signed[i] * stored.scale;
    }
    counted += 1;
  }

  const out = new Float32Array(EMBEDDING_DIMENSIONS);
  if (counted === 0) {
    return quantise(out);
  }
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i += 1) {
    out[i] = total[i] / counted;
  }
  return quantise(normalise(out));
}

/**
 * The best `k` of a set, without sorting the set.
 *
 * A partial selection over an insertion-sorted array of `k`, because `k` is ten
 * and the set is thousands: sorting every scored passage to take ten of them
 * allocates an object per passage and does the work of a full sort for a
 * question that needs neither.
 */
export function topK<T>(items: readonly T[], k: number, scoreOf: (item: T) => number): T[] {
  if (k <= 0) {
    return [];
  }
  const best: { item: T; score: number }[] = [];

  for (const item of items) {
    const value = scoreOf(item);
    if (best.length === k && value <= best[best.length - 1].score) {
      continue;
    }
    let at = best.length;
    while (at > 0 && best[at - 1].score < value) {
      at -= 1;
    }
    best.splice(at, 0, { item, score: value });
    if (best.length > k) {
      best.pop();
    }
  }

  return best.map((entry) => entry.item);
}
