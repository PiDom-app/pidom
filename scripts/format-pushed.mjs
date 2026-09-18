import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Checks the formatting of what is about to be pushed.
 *
 * The pre-commit hook covers anything committed on a machine that has these
 * installed. This covers the rest — a `--no-verify`, a branch that predates the
 * hooks, a commit written by tooling — so the CI gate is never the first thing
 * to notice.
 *
 * Only the files the pushed commits touch, not the whole tree: `prettier
 * --check .` is about thirteen seconds of real work here, and thirteen seconds
 * on every push is a hook people turn off, which would cost the pre-commit one
 * as well. A push range is usually a few dozen files and takes under a second.
 *
 * It reads the working tree rather than the pushed blobs, which is the same
 * thing whenever the tree is clean — and when it is not, the worst case is
 * being told to format a file you were going to format anyway. CI remains the
 * authority; this is only trying to get there first.
 */

const ZERO = /^0+$/;
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

/** `-z`, because a path may contain a newline and a plain split would halve it. */
function paths(...args) {
  return git(...args, '-z')
    .split('\0')
    .filter((path) => path !== '');
}

/**
 * What this push adds, per ref.
 *
 * An existing branch hands over the remote's tip to compare against. A new one
 * hands over zeros, so the base is worked out instead: the oldest commit not
 * yet on any remote, minus one. Without that, a first push of a long-lived
 * branch would check every file it has ever touched.
 */
function baseOf(localOid, remoteOid) {
  if (!ZERO.test(remoteOid)) {
    return remoteOid;
  }
  const fresh = git('rev-list', localOid, '--not', '--remotes').trim().split('\n');
  const oldest = fresh.at(-1);
  if (oldest === undefined || oldest === '') {
    return null;
  }
  try {
    return git('rev-parse', `${oldest}^`).trim();
  } catch {
    // A root commit has no parent, so the comparison is against the empty tree.
    return git('hash-object', '-t', 'tree', '/dev/null').trim();
  }
}

const updates = readFileSync(0, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '');

const changed = new Set();
for (const update of updates) {
  const [, localOid, , remoteOid] = update.split(' ');
  // All zeros on the local side is a branch being deleted. Nothing to check.
  if (localOid === undefined || remoteOid === undefined || ZERO.test(localOid)) {
    continue;
  }
  const base = baseOf(localOid, remoteOid);
  if (base === null) {
    continue;
  }
  for (const path of paths('diff', '--name-only', '--diff-filter=ACMR', base, localOid)) {
    changed.add(path);
  }
}

const files = [...changed].filter((path) => existsSync(join(root, path)));
const prettier = join(root, 'node_modules', '.bin', 'prettier');

// Nothing to check, or nothing to check it with. Neither is a reason to refuse
// a push — the gate in CI has the final say either way.
if (files.length === 0 || !existsSync(prettier)) {
  process.exit(0);
}

try {
  execFileSync(prettier, ['--check', '--ignore-unknown', ...files], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
} catch {
  process.stderr.write(
    '\nThese would fail `format:check` in CI. Run `npm run format`, commit, and\n' +
      'push again — or `git push --no-verify` to send it anyway.\n\n',
  );
  process.exit(1);
}
