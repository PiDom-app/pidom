import { execFileSync } from 'node:child_process';

/**
 * Points git at the hooks this repo ships.
 *
 * `.git/hooks` is not version controlled, so a hook written there exists on one
 * machine and on no branch. `core.hooksPath` moves the whole directory into the
 * tree, which is what makes `.githooks/pre-commit` arrive with a clone instead
 * of arriving with an instruction nobody reads.
 *
 * Chained onto `postinstall`, so the setup step everybody already runs is the
 * one that installs it. Idempotent — it writes the same value every time.
 */

function git(...args) {
  execFileSync('git', args, { stdio: 'ignore' });
}

try {
  git('rev-parse', '--git-dir');
} catch {
  // No repository. `npm ci` on an EAS builder unpacks a source archive, and CI
  // caches restore into bare directories; neither has hooks to install and
  // neither should fail a build over it. Nothing to say, so nothing is said.
  process.exit(0);
}

try {
  // Relative, so it resolves against whichever working tree the hook runs in —
  // a linked worktree gets its own copy rather than the original's.
  git('config', 'core.hooksPath', '.githooks');
} catch {
  // A read-only or otherwise unwritable config. The commit-time formatting is a
  // convenience with `format:check` behind it; losing it is not worth failing
  // an install that has otherwise succeeded.
  process.exit(0);
}
