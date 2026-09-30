import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

describe('validate-release-artifacts script', () => {
  it('accepts RELEASES entries in Squirrel format: sha1 filename size', () => {
    const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pidom-release-'));
    const packageName = 'pidom_desktop-1.2.3-full.nupkg';
    const packageBytes = Buffer.from('pidom package bytes');
    const packagePath = path.join(releaseDir, packageName);
    fs.writeFileSync(packagePath, packageBytes);

    const sha1 = crypto.createHash('sha1').update(packageBytes).digest('hex');
    const size = fs.statSync(packagePath).size;
    fs.writeFileSync(path.join(releaseDir, 'RELEASES'), `${sha1} ${packageName} ${size}\n`);

    const desktopRoot = path.resolve(import.meta.dirname, '..');
    const scriptPath = path.join(desktopRoot, 'scripts', 'validate-release-artifacts.mjs');
    const result = spawnSync(process.execPath, [scriptPath, releaseDir, '1.2.3'], {
      cwd: desktopRoot,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});
