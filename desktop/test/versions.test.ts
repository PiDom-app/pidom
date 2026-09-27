import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVersions,
  extractVersion,
  isNewer,
  parseProbeResponse,
} from '../src/main/updater/versions.ts';

/**
 * Unit tests for the updater's pure version helpers. Run with `npm test`
 * (`node --test`), which strips the TypeScript types at load — no build step and
 * no test-runner dependency. These cover the two jobs versions.ts does with
 * untrusted feed data: deciding whether an advertised version is genuinely newer,
 * and parsing the feed JSON into a bounded, typed shape.
 */

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
    assert.equal(compareVersions('1.2.0', '1.1.9'), 1);
    assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
    assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  });

  it('treats a malformed or missing version as 0.0.0 rather than throwing', () => {
    assert.equal(compareVersions('not-a-version', '0.0.0'), 0);
    assert.equal(compareVersions('1.0.0', 'garbage'), 1);
  });
});

describe('isNewer', () => {
  it('is true only for a strictly greater version', () => {
    assert.equal(isNewer('1.0.1', '1.0.0'), true);
    assert.equal(isNewer('1.0.0', '1.0.0'), false);
    assert.equal(isNewer('0.9.9', '1.0.0'), false);
  });
});

describe('extractVersion', () => {
  it('reads a version from the release name first', () => {
    assert.equal(extractVersion('Pidom Desktop 1.4.2', null), '1.4.2');
  });

  it('falls back to the asset url when the name carries none', () => {
    assert.equal(extractVersion('Latest', 'https://x/pidom-2.3.0-full.nupkg'), '2.3.0');
  });

  it('returns null when neither source carries a version', () => {
    assert.equal(extractVersion('Latest release', null), null);
    assert.equal(extractVersion(null, null), null);
  });
});

describe('parseProbeResponse', () => {
  it('accepts a well-formed feed response', () => {
    const parsed = parseProbeResponse({
      name: 'Pidom 1.2.0',
      notes: 'Bug fixes.',
      url: 'https://github.com/x/y/releases/tag/v1.2.0',
    });
    assert.ok(parsed);
    assert.equal(parsed?.name, 'Pidom 1.2.0');
    assert.equal(parsed?.notes, 'Bug fixes.');
  });

  it('tolerates missing optional fields', () => {
    const parsed = parseProbeResponse({ name: 'Pidom 1.2.0' });
    assert.ok(parsed);
    assert.equal(parsed?.notes ?? null, null);
  });

  it('rejects a non-object or wrong-typed payload', () => {
    assert.equal(parseProbeResponse('nope'), null);
    assert.equal(parseProbeResponse({ name: 42 }), null);
    assert.equal(parseProbeResponse(null), null);
  });

  it('rejects an over-long notes body (bounded before it reaches the UI)', () => {
    assert.equal(parseProbeResponse({ notes: 'x'.repeat(20_001) }), null);
  });
});
