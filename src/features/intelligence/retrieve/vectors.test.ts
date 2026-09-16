import { describe, expect, test } from 'vitest';

import { EMBEDDING_DIMENSIONS } from '../model';
import { dequantise, mean, normalise, quantise, score, topK } from './vectors';

/**
 * That the cheap version of the arithmetic gives the same answers.
 *
 * Every passage on the device is stored at a quarter of its natural size, and
 * the scan reads the bytes directly rather than converting them back. Both of
 * those are optimisations, and an optimisation that quietly changes the ranking
 * is the kind of bug that never gets reported — search would simply be a bit
 * worse than it should be, for everyone, forever.
 *
 * So: quantising must round-trip, the integer scan must agree with a float one,
 * and `topK` must return what a full sort would.
 */

function randomUnit(seed: number): Float32Array {
  // A small deterministic generator, so a failure is reproducible.
  let state = seed;
  const next = () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0xffffffff - 0.5;
  };
  const values = new Float32Array(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < values.length; i += 1) {
    values[i] = next();
  }
  return normalise(values);
}

/** Cosine the expensive way, for the integer scan to be checked against. */
function floatScore(a: Float32Array, b: Float32Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    total += a[i] * b[i];
  }
  return total;
}

describe('a passage at 388 bytes', () => {
  test('round-trips to within a quarter of a per cent', () => {
    const original = randomUnit(7);
    const restored = dequantise(quantise(original));
    for (let i = 0; i < original.length; i += 1) {
      expect(Math.abs(restored[i] - original[i])).toBeLessThan(0.005);
    }
  });

  test('costs exactly 388 bytes', () => {
    const { vector } = quantise(randomUnit(11));
    expect(vector.byteLength).toBe(EMBEDDING_DIMENSIONS);
    // Plus the float that scales it, which is the other four.
    expect(EMBEDDING_DIMENSIONS + 4).toBe(388);
  });

  test('survives a vector that points nowhere', () => {
    const zero = new Float32Array(EMBEDDING_DIMENSIONS);
    const stored = quantise(zero);
    expect(stored.scale).toBe(0);
    // Zero rather than NaN. An empty passage scores nothing; it does not
    // poison the ranking it appears in.
    expect(score(randomUnit(3), stored)).toBe(0);
  });
});

describe('the scan the search runs', () => {
  test('agrees with the float arithmetic it replaces', () => {
    const query = randomUnit(1);
    for (let seed = 2; seed < 40; seed += 1) {
      const passage = randomUnit(seed);
      const cheap = score(query, quantise(passage));
      const exact = floatScore(query, passage);
      expect(Math.abs(cheap - exact)).toBeLessThan(0.005);
    }
  });

  test('ranks the same way a float scan would', () => {
    const query = randomUnit(5);
    const passages = Array.from({ length: 200 }, (_, i) => randomUnit(i + 100));

    const cheapOrder = [...passages.keys()].sort(
      (a, b) => score(query, quantise(passages[b])) - score(query, quantise(passages[a])),
    );
    const exactOrder = [...passages.keys()].sort(
      (a, b) => floatScore(query, passages[b]) - floatScore(query, passages[a]),
    );

    // The top ten are the same ten. Their internal order may differ where two
    // scores are within the quantisation error of each other, which is a
    // distinction no reader can see.
    expect(new Set(cheapOrder.slice(0, 10))).toEqual(new Set(exactOrder.slice(0, 10)));
  });

  test('a passage scores highest against itself', () => {
    const passage = randomUnit(21);
    const stored = quantise(passage);
    expect(score(passage, stored)).toBeGreaterThan(0.99);
  });
});

describe('the document vector a library search starts from', () => {
  test('is a unit vector', () => {
    const vectors = Array.from({ length: 50 }, (_, i) => quantise(randomUnit(i + 200)));
    const restored = dequantise(mean(vectors));
    let sum = 0;
    for (const value of restored) {
      sum += value * value;
    }
    expect(Math.sqrt(sum)).toBeCloseTo(1, 2);
  });

  test('leans towards the passages a document actually has', () => {
    const topic = randomUnit(31);
    // Forty passages that are mostly one topic, and ten that are not.
    const about = Array.from({ length: 40 }, () => quantise(topic));
    const other = Array.from({ length: 10 }, (_, i) => quantise(randomUnit(i + 400)));
    const summary = mean([...about, ...other]);
    expect(score(topic, summary)).toBeGreaterThan(0.8);
  });

  test('a document with no passages does not throw', () => {
    expect(mean([]).scale).toBe(0);
  });
});

describe('taking the best few of thousands', () => {
  test('returns what a full sort would', () => {
    const items = Array.from({ length: 3_000 }, (_, i) => ({ id: i, value: (i * 7919) % 3001 }));
    const picked = topK(items, 10, (item) => item.value).map((item) => item.id);
    const sorted = [...items]
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .map((item) => item.id);
    expect(picked).toEqual(sorted);
  });

  test('handles fewer items than asked for, and none at all', () => {
    expect(topK([{ v: 1 }], 10, (i) => i.v)).toHaveLength(1);
    expect(topK([], 10, () => 0)).toEqual([]);
    expect(topK([{ v: 1 }], 0, (i) => i.v)).toEqual([]);
  });

  test('scans a book in single-digit milliseconds', () => {
    // The real shape: one query against a 1,000-page book's worth of passages.
    const query = randomUnit(9);
    const passages = Array.from({ length: 3_000 }, (_, i) => quantise(randomUnit(i + 1_000)));

    const started = Date.now();
    topK(passages, 10, (passage) => score(query, passage));
    const elapsed = Date.now() - started;

    // Generous by two orders of magnitude against a CI machine under load. The
    // assertion is that this is not accidentally quadratic, not a benchmark.
    expect(elapsed).toBeLessThan(500);
  });
});
