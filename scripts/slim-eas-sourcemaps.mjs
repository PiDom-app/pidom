#!/usr/bin/env node

import { decode, encode } from '@jridgewell/sourcemap-codec';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const SOURCE_MAP_LIMIT_BYTES = 5 * 1024 * 1024;
const PROJECT_ROOT = process.cwd();
const DEFAULT_MAP_DIR = path.join(
  PROJECT_ROOT,
  'android',
  'app',
  'build',
  'generated',
  'sourcemaps',
  'react',
  'release',
);

const requested = process.argv.slice(2);

if (requested.length === 0 && process.env.EAS_BUILD_PLATFORM !== undefined) {
  if (process.env.EAS_BUILD_PLATFORM !== 'android') {
    console.log('[sourcemaps] Skipping: this is not an Android EAS build.');
    process.exit(0);
  }
}

const mapFiles =
  requested.length > 0
    ? requested.map((file) => path.resolve(file))
    : existsSync(DEFAULT_MAP_DIR)
      ? await findSourceMaps(DEFAULT_MAP_DIR)
      : [];

if (mapFiles.length === 0) {
  const message = `[sourcemaps] No Android release source maps found under ${DEFAULT_MAP_DIR}.`;
  if (process.env.EAS_BUILD_PLATFORM === 'android') {
    throw new Error(message);
  }
  console.log(`${message} Nothing to do.`);
  process.exit(0);
}

for (const file of mapFiles) {
  await slimSourceMap(file);
}

async function findSourceMaps(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findSourceMaps(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.map')) {
      files.push(fullPath);
    }
  }

  return files;
}

async function slimSourceMap(file) {
  const before = (await stat(file)).size;
  const raw = JSON.parse(await readFile(file, 'utf8'));

  if (raw.sections !== undefined) {
    throw new Error(
      `[sourcemaps] ${file} uses indexed source maps, which this script cannot slim.`,
    );
  }
  if (!Array.isArray(raw.sources) || typeof raw.mappings !== 'string') {
    throw new Error(`[sourcemaps] ${file} is not a standard source map.`);
  }

  const decoded = decode(raw.mappings);
  const sourceIndexes = new Map();
  const sources = [];
  let keptSegments = 0;
  let droppedSegments = 0;

  for (const line of decoded) {
    for (let index = line.length - 1; index >= 0; index -= 1) {
      const segment = line[index];
      if (segment.length < 4) {
        line.splice(index, 1);
        droppedSegments += 1;
        continue;
      }

      const originalSourceIndex = segment[1];
      const source = raw.sources[originalSourceIndex];
      if (!ownsSource(source)) {
        line.splice(index, 1);
        droppedSegments += 1;
        continue;
      }

      let nextSourceIndex = sourceIndexes.get(originalSourceIndex);
      if (nextSourceIndex === undefined) {
        nextSourceIndex = sources.length;
        sourceIndexes.set(originalSourceIndex, nextSourceIndex);
        sources.push(toRepositorySource(source));
      }

      segment[1] = nextSourceIndex;
      if (segment.length > 4) {
        segment.length = 4;
      }
      keptSegments += 1;
    }
  }

  const slim = {
    version: raw.version,
    sources,
    names: [],
    mappings: encode(decoded),
  };
  if (typeof raw.file === 'string') {
    slim.file = raw.file;
  }
  if (typeof raw.sourceRoot === 'string') {
    slim.sourceRoot = raw.sourceRoot;
  }

  await writeFile(file, `${JSON.stringify(slim)}\n`);

  const after = (await stat(file)).size;
  const summary = `${formatBytes(before)} -> ${formatBytes(after)}, kept ${keptSegments} app segments and dropped ${droppedSegments}`;
  if (after >= SOURCE_MAP_LIMIT_BYTES) {
    throw new Error(`[sourcemaps] ${file} is still too large after slimming (${summary}).`);
  }

  console.log(`[sourcemaps] Slimmed ${path.relative(PROJECT_ROOT, file)}: ${summary}.`);
}

function ownsSource(source) {
  if (typeof source !== 'string' || source === '' || source.includes('node_modules')) {
    return false;
  }

  const clean = cleanSource(source);
  return (
    clean === 'app.config.ts' ||
    clean === 'babel.config.js' ||
    clean === 'metro.config.js' ||
    clean.startsWith('src/') ||
    clean.startsWith('src?') ||
    clean.startsWith('convex/') ||
    clean.startsWith('plugins/')
  );
}

function toRepositorySource(source) {
  return cleanSource(source, { keepQuery: true });
}

function cleanSource(source, options = {}) {
  const keepQuery = options.keepQuery === true;
  const queryIndex = source.indexOf('?');
  const suffix = keepQuery && queryIndex >= 0 ? source.slice(queryIndex) : '';
  const withoutQuery = queryIndex >= 0 ? source.slice(0, queryIndex) : source;
  let clean = withoutQuery.replaceAll('\\', '/');

  const root = PROJECT_ROOT.replaceAll('\\', '/');
  const markers = [`${root}/`, '/home/expo/workingdir/build/'];
  for (const marker of markers) {
    if (clean.startsWith(marker)) {
      clean = clean.slice(marker.length);
      break;
    }
  }

  clean = clean.replace(/^\/+/, '');
  return `${clean}${suffix}`;
}

function formatBytes(bytes) {
  const mib = bytes / 1024 / 1024;
  return `${mib.toFixed(2)} MiB`;
}
