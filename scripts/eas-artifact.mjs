import { appendFileSync, readFileSync } from 'node:fs';

/**
 * Reads the EAS build result and hands the release step three facts about it:
 * the build id, the Android version code, and the APK URL.
 *
 * This replaced three one-line `node -e 'require(...)'` calls that shared one
 * fatal weakness: `require()` of the JSON either parsed or threw, and when it
 * threw — an empty file, a warning line eas-cli printed onto stdout ahead of the
 * JSON, an array with no build in it — the message was a bare stack trace with
 * the filename in it and nothing about what the file actually held. The CI log
 * showed `exit code 1` and the cause scrolled off the top. A build minute spent
 * to learn nothing.
 *
 * So this reads the file itself and says what is wrong with it. Every exit that
 * is not success prints the head of what it read, which is the one thing the
 * old version never did and the one thing that ends the guessing.
 *
 * Usage: `node scripts/eas-artifact.mjs <path-to-eas-build.json>`. Prints
 * `build_id`, `version_code` and `apk_url` to stdout, and appends the same to
 * `$GITHUB_OUTPUT` when it is set. With no `$GITHUB_OUTPUT` it still prints, so
 * it can be run by hand against a saved file to reproduce a CI failure locally.
 */

function die(message, raw) {
  process.stderr.write(`\neas-artifact: ${message}\n`);
  if (raw !== undefined) {
    // The first 800 characters are enough to see a parse error, an errored
    // build's message, or the stray log line that pushed the JSON down — without
    // dumping a whole multi-kilobyte artifact block into the log.
    const head = raw.length > 800 ? `${raw.slice(0, 800)}\n…(${raw.length} bytes total)` : raw;
    process.stderr.write(`\nWhat was in the file:\n${head}\n\n`);
  }
  process.exit(1);
}

const path = process.argv[2];
if (path === undefined) {
  die('no path given. Usage: node scripts/eas-artifact.mjs <eas-build.json>');
}

let raw;
try {
  raw = readFileSync(path, 'utf8');
} catch (error) {
  die(`could not read ${path}: ${error.message}`);
}

if (raw.trim() === '') {
  die(
    `${path} is empty. The build step wrote nothing to stdout — usually the ` +
      'build never started (a credentials or `requireCommit` failure eas-cli ' +
      'reported on stderr, which the `>` redirect does not capture).',
  );
}

/**
 * The JSON eas-cli meant to emit, even if it did not emit only that.
 *
 * `--json` is supposed to put a lone JSON array on stdout, but eas-cli has a
 * long history of also printing an update notice or a credentials line there,
 * and one non-JSON character makes `JSON.parse` throw on the whole thing. So the
 * fast path is a clean parse; the fallback carves out the outermost array or
 * object and parses that. Anything still unparseable is a genuinely broken file
 * and is reported as one.
 */
function parseLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.search(/[[{]/);
    const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'));
    if (start === -1 || end <= start) {
      return undefined;
    }
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

const parsed = parseLoose(raw);
if (parsed === undefined) {
  die(`${path} is not valid JSON. eas-cli likely printed a log line onto stdout.`, raw);
}

// `--json` returns an array of builds; a single `--platform android` run is a
// one-element array. Older shapes returned the object directly, so both are
// accepted, but an empty array is its own error: the command reported success
// and produced no build to release.
const build = Array.isArray(parsed) ? parsed[0] : parsed;
if (build === undefined || build === null || typeof build !== 'object') {
  die('parsed JSON but found no build object (an empty array?).', raw);
}

// A build that finished with `--wait` is `FINISHED`. Anything else — `ERRORED`,
// `CANCELED` — has an id but no usable APK, and saying so here beats failing
// three lines down at a URL that was never going to exist. The check is
// case-insensitive because the field's casing has drifted across eas-cli
// versions, and absent status is tolerated rather than assumed failed.
const status = typeof build.status === 'string' ? build.status.toUpperCase() : null;
if (status !== null && status !== 'FINISHED') {
  const reason = build.error?.message ?? build.error ?? '(no reason given)';
  die(`the EAS build did not finish — status ${status}. Reason: ${reason}`, raw);
}

const buildId = build.id;
if (typeof buildId !== 'string' || buildId === '') {
  die('the build has no `id`.', raw);
}

// The casing of the version-code field has moved around across eas-cli
// versions, so all three spellings are tried before giving up.
const versionCode = build.androidVersionCode ?? build.versionCode ?? build.appBuildVersion;
if (versionCode === undefined || versionCode === null) {
  die(
    'the build has no Android version code (androidVersionCode / versionCode / appBuildVersion).',
    raw,
  );
}

const apkUrl = build.artifacts?.applicationArchiveUrl ?? build.artifacts?.buildUrl;
if (typeof apkUrl !== 'string' || apkUrl === '') {
  die('the build has no APK URL (artifacts.applicationArchiveUrl / buildUrl).', raw);
}

const outputs = [`build_id=${buildId}`, `version_code=${versionCode}`, `apk_url=${apkUrl}`];

// stdout always, so the calling step can capture the values without re-reading
// a file whose lifecycle it does not own; `$GITHUB_OUTPUT` as well when set, so
// the *next* step can read them as `steps.<id>.outputs.build_id` and friends.
// The two are not redundant — one is for this step, one is for the following.
process.stdout.write(`${outputs.join('\n')}\n`);

const target = process.env.GITHUB_OUTPUT;
if (target !== undefined && target !== '') {
  appendFileSync(target, `${outputs.join('\n')}\n`);
}
