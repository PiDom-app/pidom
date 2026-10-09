import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);

test('set-staging-percentage adds and replaces bounded rollout metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pidom-rollout-'));
  const file = join(directory, 'latest.yml');
  try {
    await writeFile(file, 'version: 1.2.3\nfiles: []\n', 'utf8');
    await exec(process.execPath, ['scripts/set-staging-percentage.mjs', file, '25'], {
      cwd: process.cwd(),
    });
    assert.match(await readFile(file, 'utf8'), /stagingPercentage: 25/);

    await exec(process.execPath, ['scripts/set-staging-percentage.mjs', file, '100'], {
      cwd: process.cwd(),
    });
    const output = await readFile(file, 'utf8');
    assert.match(output, /stagingPercentage: 100/);
    assert.equal((output.match(/stagingPercentage:/g) ?? []).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
