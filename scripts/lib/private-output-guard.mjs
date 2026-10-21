/**
 * private-output-guard.mjs
 *
 * Guard for scripts that write PRIVATE workbook data (scripts/draft/dump-list-fixture.ts,
 * scripts/draft-preview/make-fixture-lines.ts). Their output must never land on a tracked
 * file — above all the committed synthetic fixtures — so a target is allowed only when it is
 *   - outside the repository, or
 *   - inside it at a path git reports as ignored (`git check-ignore`) that is neither served
 *     nor used for configuration: public/, .next/, .vercel/, .git/, node_modules/ and any
 *     `.env*` file are refused even when ignored.
 * Anything else is refused, and so is everything inside the repository when git cannot answer.
 *
 * The repository root comes from this module's own location, never from the working directory.
 * On Windows the comparison follows the file system: trailing dots and spaces are stripped from
 * every segment, paths compare case-insensitively, and an alternate data stream (`name:stream`)
 * is refused outright. The nearest existing ancestor is resolved through `realpath`, so junctions,
 * symlinks and 8.3 short names cannot hide the real location.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const IS_WIN = process.platform === 'win32';
// Default win32 and macOS file systems are case-insensitive.
const CASE_INSENSITIVE = IS_WIN || process.platform === 'darwin';

/** Top-level folders that are web-served or hold build, deploy, VCS or package state. */
const DENIED_TOP_LEVEL = ['public', '.next', '.vercel', '.git', 'node_modules'];

/**
 * True when a repo-relative path is served or used for configuration, so it must never receive
 * private output even when git ignores it.
 * @param {string} rel forward-slash repo-relative path
 * @returns {boolean}
 */
export function isDeniedRepoPath(rel) {
  const segments = (CASE_INSENSITIVE ? rel.toLowerCase() : rel).split('/').filter(Boolean);
  if (segments.length === 0) return false;
  if (DENIED_TOP_LEVEL.includes(segments[0])) return true;
  return segments[segments.length - 1].startsWith('.env');
}

/**
 * Windows drops trailing dots and spaces from each path segment when it opens a file, so
 * `fixture.json.` and `fixture.json ` name `fixture.json`. Returns null for an
 * alternate-data-stream segment (`fixture.json::$DATA` also writes `fixture.json`).
 * @param {string} abs absolute path
 * @returns {string | null}
 */
function win32Normalize(abs) {
  const { root } = parse(abs);
  const segments = abs.slice(root.length).split(/[\\/]+/).filter(Boolean);
  const out = [];
  for (const segment of segments) {
    if (segment.includes(':')) return null;
    const stripped = segment.replace(/[. ]+$/, '');
    if (stripped === '') continue;
    out.push(stripped);
  }
  return resolve(root, ...out);
}

/**
 * Resolve the nearest existing ancestor through realpath and re-append the rest.
 * @param {string} abs absolute path
 * @returns {string}
 */
function realpathNearest(abs) {
  const tail = [];
  let current = abs;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return abs;
    tail.unshift(basename(current));
    current = parent;
  }
  let real = current;
  try {
    real = realpathSync.native(current);
  } catch {
    // keep the lexical path
  }
  return tail.length > 0 ? join(real, ...tail) : real;
}

/**
 * @param {string} p
 * @returns {string}
 */
function fold(p) {
  return IS_WIN ? p.toLowerCase() : p;
}

/**
 * True when git reports the repo-relative path as ignored, false when it does not, and
 * null when git cannot answer (not installed, not a repository, other error).
 * @param {string} root
 * @param {string} rel forward-slash repo-relative path
 * @returns {boolean | null}
 */
export function gitIsIgnored(root, rel) {
  try {
    execFileSync('git', ['-C', root, 'check-ignore', '-q', '--', rel], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch (err) {
    const status = err && typeof err === 'object' && 'status' in err ? err.status : null;
    return status === 1 ? false : null;
  }
}

/**
 * Decide whether `target` may receive private output.
 * @param {string} target the path as the user passed it
 * @param {{ cwd?: string, root?: string, isIgnored?: (root: string, rel: string) => boolean | null }} [options]
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
export function checkPrivateOutput(target, options = {}) {
  const { cwd = process.cwd(), root = REPO_ROOT, isIgnored = gitIsIgnored } = options;
  if (typeof target !== 'string' || target.trim() === '') return { ok: false, reason: 'no output path given' };

  let abs = resolve(cwd, target);
  let rootAbs = resolve(root);
  if (IS_WIN) {
    const normalized = win32Normalize(abs);
    if (normalized === null) return { ok: false, reason: 'the output path names an alternate data stream' };
    abs = normalized;
    rootAbs = win32Normalize(rootAbs) ?? rootAbs;
    // UNC and device spellings (\\host\share, \\localhost\D$, \\?\UNC\…) can name a file inside
    // the repository without matching its drive-letter root, so they are refused outright.
    if (abs.startsWith('\\\\')) return { ok: false, reason: 'network (UNC) and device paths are not accepted; use a local drive path' };
  }
  const real = realpathNearest(abs);
  if (IS_WIN && real.startsWith('\\\\')) return { ok: false, reason: 'network (UNC) and device paths are not accepted; use a local drive path' };
  const realRoot = realpathNearest(rootAbs);

  const f = fold(real);
  const fr = fold(realRoot);
  const rootPrefix = fr.endsWith(sep) ? fr : fr + sep;
  if (f !== fr && !f.startsWith(rootPrefix)) return { ok: true, path: real };
  if (f === fr) return { ok: false, reason: 'the output path is the repository root' };

  const rel = relative(realRoot, real);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, reason: 'the output path could not be placed relative to the repository' };
  }
  const relPosix = rel.split(sep).join('/');
  if (isDeniedRepoPath(relPosix)) {
    return { ok: false, reason: 'the output path is web-served or used for configuration (public/, .next/, .vercel/, .git/, node_modules/, .env*)' };
  }
  const ignored = isIgnored(realRoot, relPosix);
  if (ignored === true) return { ok: true, path: real };
  if (ignored === null) return { ok: false, reason: 'git could not confirm the path is ignored (is git installed?)' };
  return { ok: false, reason: 'the output path is inside the repository and not git-ignored' };
}

/**
 * Check `target` and return the path to write to, or print why it is refused and exit 1.
 * @param {string} target
 * @param {Parameters<typeof checkPrivateOutput>[1]} [options]
 * @returns {string}
 */
export function guardPrivateOutput(target, options) {
  const result = checkPrivateOutput(target, options);
  if (result.ok) return result.path;
  console.error(
    [
      `Refusing to write ${target}: ${result.reason}.`,
      'This tool writes PRIVATE workbook data. Write the output outside the repository, or a git-ignored',
      'folder that is not served or used for configuration (not public/, .next/, .env*), for example',
      '"EvoLiga Point Buy/". The committed fixtures are the example ones, generated by',
      'scripts/draft/make-example-list-fixtures.ts (seeded, example pack), never by this tool.',
    ].join('\n')
  );
  process.exit(1);
}
