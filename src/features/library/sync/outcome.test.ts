import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';

import { isMalformedRequest } from '../data/errors';
import { classify, MAX_ATTEMPTS } from './outcome';

/**
 * What the queue does when the account says no.
 *
 * Every case here is a real failure this outbox has had or could have, and the
 * one that prompted the file is the first: a share created against a group this
 * device had minted the id for was refused by an argument validator, which is
 * not a `ConvexError`, so `codeOf` called it `UNKNOWN` and the queue spent all
 * eight attempts — four seconds doubling to five minutes, about ten minutes in
 * all — retrying a call that could never succeed, with everything queued behind
 * it waiting.
 *
 * The bug itself is fixed where it belongs, in `sync/remote-ids.ts`. These
 * assert the net under it: a refusal of the *shape* of a call is permanent, and
 * a refusal of the *content* is different from a connection that dropped.
 */

/** What a Convex argument validator's rejection looks like by the time it is here. */
function validatorRejection(): Error {
  return new Error(
    '[Request ID: 3f9a] Server Error\n' +
      'ArgumentValidationError: Value does not match validator.\n' +
      'Path: .groupId\n' +
      'Value: "b03372671762475abab9f4f9850d774c"\n' +
      'Validator: v.id("groups")',
  );
}

describe('a refused shape', () => {
  test('is recognised, and is not confused with a ConvexError', () => {
    expect(isMalformedRequest(validatorRejection())).toBe(true);
    expect(isMalformedRequest(new ConvexError({ code: 'FORBIDDEN' }))).toBe(false);
  });

  test('is not recognised in an ordinary network failure', () => {
    expect(isMalformedRequest(new Error('Failed to fetch'))).toBe(false);
    expect(isMalformedRequest(new TypeError('Network request failed'))).toBe(false);
    expect(isMalformedRequest('a string nobody threw deliberately')).toBe(false);
  });

  test('fails on the first attempt rather than spending the retry budget', () => {
    const outcome = classify(validatorRejection(), 'create', 0);
    expect(outcome.kind).toBe('failed');
  });

  test('stays permanent whatever the operation was', () => {
    for (const op of ['create', 'update', 'remove'] as const) {
      expect(classify(validatorRejection(), op, 0).kind).toBe('failed');
    }
  });
});

describe('the codes this backend throws', () => {
  test('a rate limit waits the time it was given, and spends no attempt', () => {
    const outcome = classify(
      new ConvexError({ code: 'RATE_LIMITED', retryAfter: 30_000 }),
      'create',
      0,
    );
    expect(outcome.kind).toBe('retry');
    if (outcome.kind !== 'retry') return;
    expect(outcome.counts).toBe(false);
    // Jittered to three quarters and a quarter either side, so a queue of fifty
    // does not come back as fifty simultaneous requests.
    expect(outcome.afterMs).toBeGreaterThanOrEqual(30_000 * 0.75);
    expect(outcome.afterMs).toBeLessThanOrEqual(30_000 * 1.25);
  });

  test('FORBIDDEN drops a create and completes a delete', () => {
    const forbidden = new ConvexError({ code: 'FORBIDDEN' });
    expect(classify(forbidden, 'create', 0).kind).toBe('dropped');
    expect(classify(forbidden, 'remove', 0).kind).toBe('done');
    expect(classify(forbidden, 'update', 0).kind).toBe('done');
  });

  test('a lapsed token waits without spending an attempt', () => {
    for (const code of ['UNAUTHENTICATED', 'NO_PROFILE'] as const) {
      const outcome = classify(new ConvexError({ code }), 'update', 3);
      expect(outcome.kind).toBe('retry');
      if (outcome.kind !== 'retry') return;
      expect(outcome.counts).toBe(false);
    }
  });

  test('INVALID is the one refusal worth a reader s attention', () => {
    expect(classify(new ConvexError({ code: 'INVALID' }), 'create', 0).kind).toBe('failed');
  });
});

describe('a connection that dropped', () => {
  test('retries, and spends an attempt doing it', () => {
    const outcome = classify(new Error('Failed to fetch'), 'update', 0);
    expect(outcome.kind).toBe('retry');
    if (outcome.kind !== 'retry') return;
    expect(outcome.counts).toBe(true);
  });

  test('gives up only after the whole budget', () => {
    expect(classify(new Error('Failed to fetch'), 'update', MAX_ATTEMPTS - 2).kind).toBe('retry');
    expect(classify(new Error('Failed to fetch'), 'update', MAX_ATTEMPTS - 1).kind).toBe('failed');
  });

  test('backs off further each time, up to the ceiling', () => {
    const at = (attempts: number) => {
      const outcome = classify(new Error('Failed to fetch'), 'update', attempts);
      return outcome.kind === 'retry' ? outcome.afterMs : 0;
    };
    // Jitter means comparing bands rather than values: 4s and 32s cannot
    // overlap even at the extremes of both.
    expect(at(0)).toBeLessThan(at(3));
    expect(at(6)).toBeLessThanOrEqual(5 * 60_000 * 1.25);
  });
});
