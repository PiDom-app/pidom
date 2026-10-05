import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [releaseDir, version] = process.argv.slice(2);
if (!releaseDir || !version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/validate-release-artifacts.mjs <release-dir> <version>');
  process.exit(1);
}

const manifestPath = path.join(releaseDir, 'RELEASES');
if (!fs.existsSync(manifestPath)) throw new Error(`${manifestPath} is missing`);

const entries = fs.readFileSync(manifestPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const parts = line.split(/\s+/);
    if (parts.length !== 3) throw new Error(`Invalid RELEASES entry: ${line}`);
    return { hash: parts[0], name: parts[1], size: Number(parts[2]) };
  });

if (entries.length === 0) throw new Error('RELEASES contains no packages');
for (const entry of entries) {
  if (!/^[a-f0-9]{40}$/i.test(entry.hash) || !Number.isSafeInteger(entry.size) || entry.size <= 0) {
    throw new Error(`Invalid RELEASES metadata for ${entry.name}`);
  }
  const packagePath = path.join(releaseDir, entry.name);
  if (!fs.existsSync(packagePath)) throw new Error(`RELEASES references missing ${entry.name}`);
  const actualSize = fs.statSync(packagePath).size;
  if (actualSize !== entry.size) {
    throw new Error(`${entry.name} size mismatch: manifest=${entry.size}, actual=${actualSize}`);
  }
  const actualHash = crypto.createHash('sha1').update(fs.readFileSync(packagePath)).digest('hex');
  if (actualHash !== entry.hash.toLowerCase()) {
    throw new Error(`${entry.name} hash mismatch: manifest=${entry.hash}, actual=${actualHash}`);
  }
}

const expected = `pidom_desktop-${version}-full.nupkg`;
if (!entries.some((entry) => entry.name === expected)) {
  throw new Error(`RELEASES does not contain the expected full package ${expected}`);
}
console.log(`Validated ${entries.length} Squirrel package(s) for ${version}.`);
