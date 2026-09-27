import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Formats what is staged, before it becomes a commit.
 *
 * `prettier --check .` is a CI gate (`.github/workflows/ci.yml`), and it is the
 * one gate that fails for a reason no human chose and no human can learn
 * anything from: a trailing comma, a line at 101 columns. It costs a whole
 * pipeline run to find out and one command to fix, on every branch, forever.
 * Doing it here means it is never a failure at all.
 *
 * Run from `.githooks/pre-commit`, which `scripts/install-hooks.mjs` points git
 * at during `npm install` — so a fresh clone has this after the ordinary setup
 * step, with nothing extra to remember.
 */

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

/**
 * Paths from a git command, as a list.
 *
 * `-z` rather than splitting on newlines: a path may legally contain one, and
 * the naive split would turn a single file into two names that match nothing.
 */
function paths(...args) {
  const out = execFileSync('git', [...args, '-z'], { cwd: root, encoding: 'utf8' });
  return out.split('\0').filter((path) => path !== '');
}

// `ACMR` — added, copied, modified, renamed. Deletions are excluded because
// there is nothing left on disk to format, and a rename reports its new name.
const staged = paths('diff', '--cached', '--name-only', '--diff-filter=ACMR').filter((path) =>
  existsSync(join(root, path)),
);

if (staged.length === 0) {
  process.exit(0);
}

// Not installed yet — a hook that fires between `git clone` and `npm install`,
// or on a machine with a pruned tree. Blocking a commit over a missing
// dev dependency would be a worse failure than the one this prevents.
const prettier = join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
if (!existsSync(prettier)) {
  process.exit(0);
}

/**
 * Files that are staged *and* modified again since staging.
 *
 * A `git add -p` where only some hunks are going in. Formatting one of those in
 * place and re-adding it would sweep the unstaged half into the commit as well,
 * so they are checked and reported rather than rewritten. A hook that quietly
 * commits something the author did not stage is worse than the CI failure it
 * was trying to save them from.
 */
const dirty = new Set(paths('diff', '--name-only'));
const whole = staged.filter((path) => !dirty.has(path));
const partial = staged.filter((path) => dirty.has(path));

function run(args, files) {
  // `--ignore-unknown` so a commit touching an image or a lockfile is not an
  // error; `.prettierignore` still applies on top of it.
  //
  // Invoked via `process.execPath` against prettier's JS entry point rather
  // than the `node_modules/.bin` shim: the shim is a Unix shell script that
  // Windows cannot spawn, and the `.cmd` variant needs `shell: true`. Running
  // the `.cjs` directly with node is portable and needs no shell.
  return execFileSync(process.execPath, [prettier, ...args, '--ignore-unknown', ...files], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

if (whole.length > 0) {
  // A syntax error makes this throw, which fails the commit with prettier's own
  // message on stderr. That is the right outcome: the file does not parse.
  run(['--write'], whole);
  // Only the files that were already going in. `git add` of anything else would
  // be this hook deciding what the commit contains.
  execFileSync('git', ['add', '--', ...whole], { cwd: root, stdio: 'inherit' });
}

if (partial.length > 0) {
  try {
    run(['--check'], partial);
  } catch {
    process.stderr.write(
      '\n' +
        'These are partially staged, so they were not reformatted — doing that\n' +
        'would have added the hunks you deliberately left out:\n\n' +
        partial.map((path) => `  ${path}\n`).join('') +
        '\nRun `npm run format`, stage what you want, and commit again.\n\n',
    );
    process.exit(1);
  }
}
