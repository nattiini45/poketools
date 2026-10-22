/**
 * mirror-private-overlay.mjs + lib/overlay-mirror.mjs: the overlay copy lands only in whole private
 * folders that ignore themselves, never writes a tracked or non-ignored path, records what it
 * wrote, removes what left the overlay, and refuses edited outputs. Each case builds a throwaway
 * git repository; the last block checks the real repo.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runMirror } from '../mirror-private-overlay.mjs';
import {
  MANIFEST_NAME,
  OUTPUT_TMP_SUFFIX,
  REASON,
  ROOT_IGNORE_CONTENT,
  committedIgnoredSet,
  gitQueries,
  planOverlayMirror,
  readManifest,
  writeManifest,
} from '../lib/overlay-mirror.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OVERLAY = 'src/format-packs/private/overlay';
const COMMITTED_IGNORE = ['/src/app/x/', '/src/lib/x/', `/${MANIFEST_NAME}`].join('\n') + '\n';
const caseInsensitiveFs = process.platform === 'win32' || process.platform === 'darwin';

/** @type {string[]} */
const dirs = [];
afterEach(() => {
  // Retries: a git child process can still be writing into the temp repo's .git when the test ends (ENOTEMPTY on CI).
  while (dirs.length > 0) rmSync(/** @type {string} */ (dirs.pop()), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function git(root, ...args) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', '-C', root, ...args], { encoding: 'utf8', windowsHide: true });
}

/** Commit what is staged, independent of the developer's git identity and signing config. */
function commit(root, message) {
  git(root, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', message);
}

/** A temp repo whose only commit is the given .gitignore text. */
function repoWithCommittedGitignore(gitignore) {
  const root = mkdtempSync(join(tmpdir(), 'mirror-overlay-'));
  dirs.push(root);
  git(root, 'init', '-q');
  writeFileSync(join(root, '.gitignore'), gitignore);
  git(root, 'add', '.gitignore');
  commit(root, 'gitignore');
  return root;
}

/** Tracked public files, like the real src/: output roots are the private folders beside them. */
const PUBLIC_SCAFFOLD = ['src/app/layout.tsx', 'src/lib/public.ts', 'src/components/Public.tsx'];

/** A git repo with the given committed .gitignore, the public scaffold and overlay files ({ overlayRel: content }). */
function makeRepo(overlayFiles = {}, gitignore = COMMITTED_IGNORE) {
  const root = repoWithCommittedGitignore(gitignore);
  for (const rel of PUBLIC_SCAFFOLD) writeAt(root, rel, 'public');
  git(root, 'add', '-f', ...PUBLIC_SCAFFOLD);
  commit(root, 'public scaffold');
  for (const [rel, content] of Object.entries(overlayFiles)) writeAt(root, `${OVERLAY}/${rel}`, content);
  return root;
}

function writeAt(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function read(root, rel) {
  return readFileSync(join(root, rel), 'utf8');
}

/** Run the CLI entry; returns { code, out, err }. */
function run(root, ...argv) {
  const out = [];
  const err = [];
  const code = runMirror({ root, argv, log: (s) => out.push(s), error: (s) => err.push(s) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('mirror-private-overlay: copying', () => {
  it('copies overlay files to the mirrored paths, skips __tests__ at any depth and records a manifest', () => {
    const root = makeRepo({
      'app/x/page.tsx': 'page',
      'lib/x/util.ts': 'util',
      '__tests__/top.test.ts': 'no',
      'lib/x/__tests__/util.test.ts': 'no',
    });
    const { code } = run(root, '--quiet');
    expect(code).toBe(0);
    expect(read(root, 'src/app/x/page.tsx')).toBe('page');
    expect(read(root, 'src/lib/x/util.ts')).toBe('util');
    expect(existsSync(join(root, 'src/__tests__'))).toBe(false);
    expect(existsSync(join(root, 'src/lib/x/__tests__'))).toBe(false);
    const manifest = readManifest(root);
    expect(Object.keys(manifest.files).sort()).toEqual(['src/app/x/page.tsx', 'src/lib/x/util.ts']);
    expect(manifest.files['src/app/x/page.tsx'].source).toBe(`${OVERLAY}/app/x/page.tsx`);
    expect(manifest.roots).toEqual(['src/app/x', 'src/lib/x']);
  });

  it('a second run writes nothing (mtime unchanged) and --check reports up to date', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'page' });
    expect(run(root, '--quiet').code).toBe(0);
    const dest = join(root, 'src/app/x/page.tsx');
    const past = new Date('2020-01-01T00:00:00Z');
    utimesSync(dest, past, past);
    expect(run(root, '--quiet').code).toBe(0);
    expect(statSync(dest).mtimeMs).toBe(past.getTime());
    expect(run(root, '--check', '--quiet').code).toBe(0);
  });

  it('writes each output through a temp file and renames it, replacing a stale temp from a crashed run', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'page' });
    // A run that crashed mid-copy left a partial temp file next to the destination, and no output.
    writeAt(root, `src/app/x/page.tsx${OUTPUT_TMP_SUFFIX}`, 'pa');
    expect(run(root, '--quiet').code).toBe(0);
    expect(read(root, 'src/app/x/page.tsx')).toBe('page');
    expect(existsSync(join(root, `src/app/x/page.tsx${OUTPUT_TMP_SUFFIX}`))).toBe(false);
    expect(Object.keys(readManifest(root).files)).toEqual(['src/app/x/page.tsx']);
    expect(run(root, '--check', '--quiet').code).toBe(0);
  });

  it('cleans the temp file of a crashed copy whose overlay source was removed before the next run', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'page' });
    expect(run(root, '--quiet').code).toBe(0);
    // Crash mid-copy of a new output: pending manifest written, temp file partly copied, no output.
    writeAt(root, `${OVERLAY}/app/x/new.tsx`, 'new');
    const plan = planOverlayMirror({ root });
    expect(plan.refusals).toEqual([]);
    writeManifest(root, plan.pendingManifest.files, plan.pendingManifest.roots);
    writeAt(root, `src/app/x/new.tsx${OUTPUT_TMP_SUFFIX}`, 'ne');
    // The overlay drops the file before the next run: the temp is still the mirror's own.
    rmSync(join(root, `${OVERLAY}/app/x/new.tsx`));
    const next = planOverlayMirror({ root });
    expect(next.refusals).toEqual([]);
    expect(next.tempRemoves).toEqual([`src/app/x/new.tsx${OUTPUT_TMP_SUFFIX}`]);
    const { code, out } = run(root);
    expect(code).toBe(0);
    expect(out).toContain('1 stale temp file(s) of a crashed run cleaned');
    expect(existsSync(join(root, `src/app/x/new.tsx${OUTPUT_TMP_SUFFIX}`))).toBe(false);
    expect(existsSync(join(root, 'src/app/x/new.tsx'))).toBe(false);
    expect(Object.keys(readManifest(root).files)).toEqual(['src/app/x/page.tsx']);
    expect(run(root, '--check', '--quiet').code).toBe(0);
  });

  it('a stale temp beside a kept output or the root .gitignore is reported by --check, cleaned, and never blocks pruning', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'page' });
    expect(run(root, '--quiet').code).toBe(0);
    writeAt(root, `src/app/x/page.tsx${OUTPUT_TMP_SUFFIX}`, 'pa');
    writeAt(root, `src/app/x/.gitignore${OUTPUT_TMP_SUFFIX}`, '#');
    // Nothing else changed, but the temps would become visible once the root is pruned.
    expect(run(root, '--check', '--quiet').code).toBe(1);
    rmSync(join(root, `${OVERLAY}/app/x/page.tsx`));
    expect(run(root, '--quiet').code).toBe(0);
    expect(existsSync(join(root, 'src/app/x'))).toBe(false);
    expect(run(root, '--check', '--quiet').code).toBe(0);
  });

  it('still refuses a foreign file that only looks like a temp (no known output beside it)', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'page' });
    expect(run(root, '--quiet').code).toBe(0);
    writeAt(root, `src/app/x/mine.tsx${OUTPUT_TMP_SUFFIX}`, 'hand-made');
    const refused = run(root);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(REASON.ROOT_HAS_FOREIGN_FILES);
    expect(read(root, `src/app/x/mine.tsx${OUTPUT_TMP_SUFFIX}`)).toBe('hand-made');
  });

  it('refuses, and never deletes, a tracked file named like the temp of a known output in a stale root', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'page' });
    expect(run(root, '--quiet').code).toBe(0);
    // The overlay drops the file (src/app/x becomes a stale root), and someone tracks a file
    // whose name matches the temp of the recorded output.
    rmSync(join(root, `${OVERLAY}/app/x/page.tsx`));
    const temp = `src/app/x/page.tsx${OUTPUT_TMP_SUFFIX}`;
    writeAt(root, temp, 'tracked');
    git(root, 'add', '-f', temp);
    const plan = planOverlayMirror({ root });
    expect(plan.tempRemoves).toEqual([]);
    expect(plan.refusals).toContainEqual(expect.objectContaining({ path: temp, reason: REASON.TRACKED }));
    const { code, err } = run(root);
    expect(code).toBe(1);
    expect(err).toContain(REASON.TRACKED);
    expect(read(root, temp)).toBe('tracked');
    expect(read(root, 'src/app/x/page.tsx')).toBe('page');
  });

  it('a run that crashed after copying a new output, before its final manifest, is finished by the next run', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'page' });
    expect(run(root, '--quiet').code).toBe(0);
    // Emulate the crash: the overlay gains a file, the run writes its pending manifest and copies
    // the output, then dies before the final manifest.
    writeAt(root, `${OVERLAY}/app/x/new.tsx`, 'new v1');
    const plan = planOverlayMirror({ root });
    expect(plan.refusals).toEqual([]);
    writeManifest(root, plan.pendingManifest.files, plan.pendingManifest.roots);
    writeAt(root, 'src/app/x/new.tsx', 'new v1');
    // Before the fix this output was unknown to the manifest, and an overlay change made the next
    // run refuse it as UNTRACKED_DIFFERS.
    writeAt(root, `${OVERLAY}/app/x/new.tsx`, 'new v2');
    expect(run(root, '--quiet').code).toBe(0);
    expect(read(root, 'src/app/x/new.tsx')).toBe('new v2');
    expect(run(root, '--check', '--quiet').code).toBe(0);
  });

  it('a run that crashed after its pending manifest, before replacing an output, is finished by the next run', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'v1', 'app/x/gone.tsx': 'gone' });
    expect(run(root, '--quiet').code).toBe(0);
    writeAt(root, `${OVERLAY}/app/x/page.tsx`, 'v2');
    rmSync(join(root, `${OVERLAY}/app/x/gone.tsx`));
    const plan = planOverlayMirror({ root });
    expect(plan.refusals).toEqual([]);
    writeManifest(root, plan.pendingManifest.files, plan.pendingManifest.roots);
    const pending = readManifest(root);
    // The planned write records the bytes it replaces; the pending removal stays listed.
    expect(pending.files['src/app/x/page.tsx'].prior).toBe(plan.writes[0].onDisk);
    expect(pending.files['src/app/x/gone.tsx']).toBeDefined();
    // Crash: nothing copied or deleted. The overlay moves on again before the next run.
    writeAt(root, `${OVERLAY}/app/x/page.tsx`, 'v3');
    expect(run(root, '--quiet').code).toBe(0);
    expect(read(root, 'src/app/x/page.tsx')).toBe('v3');
    expect(existsSync(join(root, 'src/app/x/gone.tsx'))).toBe(false);
    const final = readManifest(root);
    expect(Object.keys(final.files)).toEqual(['src/app/x/page.tsx']);
    expect(final.files['src/app/x/page.tsx'].prior).toBeUndefined();
    expect(run(root, '--check', '--quiet').code).toBe(0);
  });

  it('a pending manifest left by a crash after the last copy is reported by --check and cleared by the next run', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'v1' });
    expect(run(root, '--quiet').code).toBe(0);
    writeAt(root, `${OVERLAY}/app/x/page.tsx`, 'v2');
    const plan = planOverlayMirror({ root });
    writeManifest(root, plan.pendingManifest.files, plan.pendingManifest.roots);
    writeAt(root, 'src/app/x/page.tsx', 'v2');
    expect(run(root, '--check', '--quiet').code).toBe(1);
    expect(run(root, '--quiet').code).toBe(0);
    expect(readManifest(root).files['src/app/x/page.tsx'].prior).toBeUndefined();
    expect(run(root, '--check', '--quiet').code).toBe(0);
  });

  it('still refuses an output edited in place after a crash (neither the recorded nor the prior bytes)', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'v1' });
    expect(run(root, '--quiet').code).toBe(0);
    writeAt(root, `${OVERLAY}/app/x/page.tsx`, 'v2');
    const plan = planOverlayMirror({ root });
    writeManifest(root, plan.pendingManifest.files, plan.pendingManifest.roots);
    writeAt(root, 'src/app/x/page.tsx', 'hand edit');
    const refused = run(root);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(REASON.EDITED_IN_PLACE);
    expect(read(root, 'src/app/x/page.tsx')).toBe('hand edit');
  });

  it('rejects a manifest whose "prior" is not a sha256', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'v1' });
    expect(run(root, '--quiet').code).toBe(0);
    const manifest = JSON.parse(read(root, MANIFEST_NAME));
    manifest.files['src/app/x/page.tsx'].prior = 'not-a-sha';
    writeFileSync(join(root, MANIFEST_NAME), JSON.stringify(manifest));
    expect(() => readManifest(root)).toThrow(/"prior" that is not a hex sha256/);
  });

  it('rewrites an output when its overlay source changed', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'v1' });
    run(root, '--quiet');
    writeAt(root, `${OVERLAY}/app/x/page.tsx`, 'v2');
    expect(run(root, '--check').code).toBe(1);
    expect(run(root, '--quiet').code).toBe(0);
    expect(read(root, 'src/app/x/page.tsx')).toBe('v2');
  });

  it('adopts a byte-identical pre-existing output without rewriting it', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'same' });
    writeAt(root, 'src/app/x/page.tsx', 'same');
    const plan = planOverlayMirror({ root });
    expect(plan.refusals).toEqual([]);
    expect(plan.adopts.map((e) => e.dest)).toEqual(['src/app/x/page.tsx']);
    expect(plan.writes).toEqual([]);
    expect(run(root, '--quiet').code).toBe(0);
    expect(readManifest(root).files['src/app/x/page.tsx']).toBeDefined();
  });

  it('is a no-op that never asks git when there is no overlay and no manifest', () => {
    const root = makeRepo();
    const throwingGit = {
      trackedSet: () => {
        throw new Error('git must not be called');
      },
      committedIgnored: () => {
        throw new Error('git must not be called');
      },
    };
    const plan = planOverlayMirror({ root, git: throwingGit });
    expect(plan.refusals).toEqual([]);
    const { code, out } = run(root);
    expect(code).toBe(0);
    expect(out).toContain('no overlay folder');
    expect(existsSync(join(root, MANIFEST_NAME))).toBe(false);
  });

  it('runs as a CLI (entry-point guard) and rejects an unknown flag before touching anything', () => {
    let status = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [join(REPO_ROOT, 'scripts/mirror-private-overlay.mjs'), '--bogus'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      status = /** @type {{ status: number }} */ (err).status;
      stderr = String(/** @type {{ stderr: unknown }} */ (err).stderr);
    }
    expect(status).toBe(2);
    expect(stderr).toContain('unknown argument(s): --bogus');
  });

  it('rejects unknown arguments with exit 2', () => {
    const root = makeRepo();
    const { code, err } = run(root, '--frce');
    expect(code).toBe(2);
    expect(err).toContain('--frce');
  });
});

describe('mirror-private-overlay: guards', () => {
  it('refuses a destination git tracks and writes nothing', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'overlay', 'lib/x/util.ts': 'util' });
    writeAt(root, 'src/app/x/page.tsx', 'tracked');
    git(root, 'add', '-f', 'src/app/x/page.tsx');
    const { code, err } = run(root);
    expect(code).toBe(1);
    expect(err).toContain(REASON.TRACKED);
    expect(read(root, 'src/app/x/page.tsx')).toBe('tracked');
    // one refusal stops the run: the unrelated file is not written either
    expect(existsSync(join(root, 'src/lib/x/util.ts'))).toBe(false);
    expect(existsSync(join(root, MANIFEST_NAME))).toBe(false);
  });

  it.runIf(caseInsensitiveFs)('refuses a letter-case variant of a tracked destination (win32, darwin)', () => {
    const root = makeRepo({ 'app/x/Page.tsx': 'overlay' });
    writeAt(root, 'src/app/x/page.tsx', 'tracked');
    git(root, 'add', '-f', 'src/app/x/page.tsx');
    const plan = planOverlayMirror({ root });
    expect(plan.refusals.map((r) => r.reason)).toContain(REASON.TRACKED);
  });

  it('writes a self-ignoring .gitignore into every output root, so git sees nothing to add', () => {
    // The committed .gitignore names no output root at all: only the private pack and the manifest.
    const root = makeRepo(
      { 'components/y/Card.tsx': 'card', 'app/z/page.tsx': 'page' },
      `/src/format-packs/private/\n/${MANIFEST_NAME}\n`,
    );
    expect(run(root, '--quiet').code).toBe(0);
    expect(read(root, 'src/components/y/Card.tsx')).toBe('card');
    expect(read(root, 'src/components/y/.gitignore')).toBe(ROOT_IGNORE_CONTENT);
    expect(read(root, 'src/app/z/.gitignore')).toBe(ROOT_IGNORE_CONTENT);
    expect(readManifest(root).roots).toEqual(['src/app/z', 'src/components/y']);
    expect(git(root, 'status', '--porcelain', '--untracked-files=all')).toBe('');
    expect(git(root, 'add', '-A', '--dry-run')).toBe('');
  });

  it('picks the shallowest folder without tracked files as the root', () => {
    const root = makeRepo({ 'lib/x/deep/er/util.ts': 'u' }, `/src/format-packs/private/\n/${MANIFEST_NAME}\n`);
    const plan = planOverlayMirror({ root });
    expect(plan.refusals).toEqual([]);
    expect(plan.roots).toEqual(['src/lib/x']);
    expect(run(root, '--quiet').code).toBe(0);
    expect(read(root, 'src/lib/x/.gitignore')).toBe(ROOT_IGNORE_CONTENT);
    expect(existsSync(join(root, 'src/lib/x/deep/er/.gitignore'))).toBe(false);
    expect(git(root, 'status', '--porcelain', '--untracked-files=all')).toBe('');
  });

  it('refuses a single private file dropped into a public folder (FILE_IN_PUBLIC_DIR)', () => {
    const root = makeRepo({ 'lib/new.ts': 'private', 'lib/x/util.ts': 'u' });
    const { code, err } = run(root);
    expect(code).toBe(1);
    expect(err).toContain(`${REASON.FILE_IN_PUBLIC_DIR}: src/lib/new.ts`);
    expect(existsSync(join(root, 'src/lib/new.ts'))).toBe(false);
    expect(existsSync(join(root, 'src/lib/x/util.ts'))).toBe(false);
    expect(existsSync(join(root, MANIFEST_NAME))).toBe(false);
  });

  it('refuses a root that already holds a file the mirror did not write (it would be hidden)', () => {
    const root = makeRepo({ 'lib/x/util.ts': 'u' });
    writeAt(root, 'src/lib/x/notes.md', 'someone else');
    const { code, err } = run(root);
    expect(code).toBe(1);
    expect(err).toContain(REASON.ROOT_HAS_FOREIGN_FILES);
    expect(err).toContain('src/lib/x/notes.md');
    expect(existsSync(join(root, 'src/lib/x/util.ts'))).toBe(false);
    expect(existsSync(join(root, 'src/lib/x/.gitignore'))).toBe(false);
  });

  it('refuses a root whose .gitignore the mirror did not write', () => {
    const root = makeRepo({ 'lib/x/util.ts': 'u' });
    writeAt(root, 'src/lib/x/.gitignore', '!keep-me\n');
    const { code, err } = run(root);
    expect(code).toBe(1);
    expect(err).toContain(REASON.ROOT_HAS_FOREIGN_FILES);
    expect(read(root, 'src/lib/x/.gitignore')).toBe('!keep-me\n');
  });

  it("refuses an overlay file that would replace a root's own .gitignore (RESERVED_NAME)", () => {
    const root = makeRepo({ 'lib/x/.gitignore': '!*\n', 'lib/x/util.ts': 'u' });
    const plan = planOverlayMirror({ root });
    expect(plan.refusals.map((r) => r.reason)).toContain(REASON.RESERVED_NAME);
  });

  it('refuses an output nothing ignores (fail closed, e.g. a negation the roots cannot override)', () => {
    const root = makeRepo({ 'lib/x/util.ts': 'u' });
    const real = gitQueries(root);
    const plan = planOverlayMirror({ root, git: { trackedSet: real.trackedSet, committedIgnored: () => new Set() } });
    expect(plan.refusals.map((r) => r.reason)).toEqual([REASON.NOT_COMMITTED_IGNORED]);
  });

  it('counts only committed .gitignore files and the roots, never .git/info/exclude', () => {
    const root = makeRepo({ 'components/y/Card.tsx': 'card' });
    writeFileSync(join(root, '.git', 'info', 'exclude'), '/src/components/z/\n');
    expect(committedIgnoredSet(root, ['src/components/z/a.ts']).size).toBe(0);
    expect(committedIgnoredSet(root, ['src/components/y/Card.tsx']).size).toBe(0);
    expect([...committedIgnoredSet(root, ['src/components/y/Card.tsx'], ['src/components/y'])]).toHaveLength(1);
  });

  it('reads nested committed .gitignore files from HEAD as well', () => {
    const root = makeRepo({ 'components/y/Card.tsx': 'card' });
    writeAt(root, 'src/components/.gitignore', '/y/\n');
    expect(committedIgnoredSet(root, ['src/components/y/Card.tsx']).size).toBe(0);
    git(root, 'add', 'src/components/.gitignore');
    commit(root, 'nested ignore');
    expect([...committedIgnoredSet(root, ['src/components/y/Card.tsx'])]).toHaveLength(1);
  });

  it('answers the same when started from a subdirectory of the repository', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'p' });
    const lib = pathToFileURL(join(REPO_ROOT, 'scripts/lib/overlay-mirror.mjs')).href;
    const probe = `import { committedIgnoredSet } from ${JSON.stringify(lib)};\n` +
      `console.log(JSON.stringify([...committedIgnoredSet(process.argv[1], ['src/app/x/page.tsx', 'src/other.ts'])]));`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe, root], { cwd: join(root, 'src'), encoding: 'utf8', windowsHide: true });
    const fold = (p) => (caseInsensitiveFs ? p.toLowerCase() : p);
    expect(JSON.parse(out)).toEqual([fold('src/app/x/page.tsx')]);
  });

  it('refuses (fail closed) in a repository without a commit', () => {
    const root = mkdtempSync(join(tmpdir(), 'mirror-overlay-'));
    dirs.push(root);
    git(root, 'init', '-q');
    writeFileSync(join(root, '.gitignore'), COMMITTED_IGNORE);
    writeAt(root, `${OVERLAY}/app/x/page.tsx`, 'p');
    const plan = planOverlayMirror({ root });
    expect(plan.refusals.map((r) => r.reason)).toEqual([REASON.GIT_UNAVAILABLE]);
    expect(plan.refusals[0].detail).toContain('HEAD');
    expect(existsSync(join(root, 'src/app/x/page.tsx'))).toBe(false);
  });

  it("a negated committed pattern does not count, but the root's own .gitignore still covers the output", () => {
    const root = makeRepo({ 'app/x/page.tsx': 'p' }, `/src/app/*\n!/src/app/x/\n/${MANIFEST_NAME}\n`);
    expect(committedIgnoredSet(root, ['src/app/x/page.tsx']).size).toBe(0);
    expect(committedIgnoredSet(root, ['src/app/x/page.tsx'], ['src/app/x']).size).toBe(1);
    expect(run(root, '--quiet').code).toBe(0);
    expect(git(root, 'status', '--porcelain', '--untracked-files=all', '--', 'src/app')).toBe('');
  });

  it('refuses an output edited in place, and --force overwrites it', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'overlay' });
    run(root, '--quiet');
    writeAt(root, 'src/app/x/page.tsx', 'hand edit');
    const refused = run(root);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(REASON.EDITED_IN_PLACE);
    expect(read(root, 'src/app/x/page.tsx')).toBe('hand edit');
    expect(run(root, '--force', '--quiet').code).toBe(0);
    expect(read(root, 'src/app/x/page.tsx')).toBe('overlay');
  });

  it('refuses an untracked pre-existing output that differs from the overlay', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'overlay' });
    writeAt(root, 'src/app/x/page.tsx', 'someone else');
    const { code, err } = run(root);
    expect(code).toBe(1);
    expect(err).toContain(REASON.UNTRACKED_DIFFERS);
    expect(read(root, 'src/app/x/page.tsx')).toBe('someone else');
  });

  it('refuses when git cannot answer (fail closed)', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'p' });
    const brokenGit = {
      trackedSet: () => {
        throw new Error('spawn git ENOENT');
      },
      committedIgnored: () => new Set(),
    };
    const plan = planOverlayMirror({ root, git: brokenGit });
    expect(plan.refusals.map((r) => r.reason)).toEqual([REASON.GIT_UNAVAILABLE]);
    expect(plan.refusals[0].detail).toContain('ENOENT');
  });

  it('refuses a symlink inside the overlay', (ctx) => {
    const root = makeRepo({ 'app/x/page.tsx': 'p' });
    const outside = join(root, 'outside.txt');
    writeFileSync(outside, 'secret');
    try {
      symlinkSync(outside, join(root, OVERLAY, 'app/x/link.ts'), 'file');
    } catch (err) {
      // Windows without Developer Mode cannot create symlinks.
      if (err && typeof err === 'object' && 'code' in err && err.code === 'EPERM') return ctx.skip();
      throw err;
    }
    const plan = planOverlayMirror({ root });
    expect(plan.refusals.map((r) => r.reason)).toContain(REASON.SYMLINK);
  });

  it('rejects a malformed manifest and a manifest entry that escapes src/', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'p' });
    writeFileSync(join(root, MANIFEST_NAME), '{ not json');
    expect(() => planOverlayMirror({ root })).toThrow(/not valid JSON/);
    writeFileSync(
      join(root, MANIFEST_NAME),
      JSON.stringify({ version: 1, files: { 'src/../package.json': { source: `${OVERLAY}/a`, sha256: 'a'.repeat(64) } } })
    );
    expect(() => planOverlayMirror({ root })).toThrow(/outside src\//);
    writeFileSync(join(root, MANIFEST_NAME), JSON.stringify({ version: 3, files: {}, roots: [] }));
    expect(() => planOverlayMirror({ root })).toThrow(/unsupported version/);
    writeFileSync(join(root, MANIFEST_NAME), JSON.stringify({ version: 2, files: {}, roots: ['src/../x'] }));
    expect(() => planOverlayMirror({ root })).toThrow(/outside src\//);
    writeFileSync(join(root, MANIFEST_NAME), JSON.stringify({ version: 2, files: {} }));
    expect(() => planOverlayMirror({ root })).toThrow(/"roots" is not an array/);
  });
});

describe('mirror-private-overlay: stale outputs', () => {
  it('removes the output of a deleted overlay file, updates the manifest and prunes empty folders', () => {
    const root = makeRepo({ 'app/x/deep/page.tsx': 'p', 'lib/x/util.ts': 'u' });
    run(root, '--quiet');
    rmSync(join(root, OVERLAY, 'app/x/deep/page.tsx'));
    expect(run(root, '--check').code).toBe(1);
    expect(run(root, '--quiet').code).toBe(0);
    expect(existsSync(join(root, 'src/app/x/deep/page.tsx'))).toBe(false);
    // the root lost its last output: its .gitignore goes and the emptied folders are pruned
    expect(existsSync(join(root, 'src/app/x'))).toBe(false);
    expect(existsSync(join(root, 'src'))).toBe(true);
    expect(Object.keys(readManifest(root).files)).toEqual(['src/lib/x/util.ts']);
    expect(readManifest(root).roots).toEqual(['src/lib/x']);
    expect(read(root, 'src/lib/x/.gitignore')).toBe(ROOT_IGNORE_CONTENT);
  });

  it('reads a version 1 manifest (no roots) and upgrades it on the next run', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'p' });
    writeAt(root, 'src/app/x/page.tsx', 'p');
    const sha = planOverlayMirror({ root }).adopts[0].sha256;
    writeFileSync(
      join(root, MANIFEST_NAME),
      JSON.stringify({ version: 1, files: { 'src/app/x/page.tsx': { source: `${OVERLAY}/app/x/page.tsx`, sha256: sha } } }),
    );
    expect(readManifest(root).roots).toEqual([]);
    expect(run(root, '--check').code).toBe(1);
    expect(run(root, '--quiet').code).toBe(0);
    const upgraded = JSON.parse(read(root, MANIFEST_NAME));
    expect(upgraded.version).toBe(2);
    expect(upgraded.roots).toEqual(['src/app/x']);
    expect(read(root, 'src/app/x/.gitignore')).toBe(ROOT_IGNORE_CONTENT);
    expect(run(root, '--check', '--quiet').code).toBe(0);
  });

  it('refuses to delete an edited output of a removed overlay file unless --force', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'p', 'lib/x/util.ts': 'u' });
    run(root, '--quiet');
    rmSync(join(root, OVERLAY, 'app/x/page.tsx'));
    writeAt(root, 'src/app/x/page.tsx', 'hand edit');
    const refused = run(root);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(REASON.EDITED_IN_PLACE);
    expect(read(root, 'src/app/x/page.tsx')).toBe('hand edit');
    expect(run(root, '--force', '--quiet').code).toBe(0);
    expect(existsSync(join(root, 'src/app/x/page.tsx'))).toBe(false);
  });

  it('fails when the overlay folder is gone but outputs remain, and --prune removes them', () => {
    const root = makeRepo({ 'app/x/page.tsx': 'p' });
    run(root, '--quiet');
    rmSync(join(root, OVERLAY), { recursive: true });
    const refused = run(root);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(REASON.OVERLAY_MISSING_WITH_OUTPUTS);
    expect(existsSync(join(root, 'src/app/x/page.tsx'))).toBe(true);
    expect(run(root, '--prune', '--quiet').code).toBe(0);
    expect(existsSync(join(root, 'src/app/x/page.tsx'))).toBe(false);
    expect(existsSync(join(root, 'src/app/x'))).toBe(false);
    expect(existsSync(join(root, MANIFEST_NAME))).toBe(false);
    // and the checkout is back to the public no-op state
    expect(run(root, '--quiet').code).toBe(0);
  });
});

describe('mirror-private-overlay: this repository', () => {
  const gitignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');
  const start = gitignore.indexOf('# overlay mirror outputs:');
  // The block runs from its header comment to the first blank line.
  const blockLines = gitignore.slice(start).split(/\r?\n/).slice(1);
  const blockEnd = blockLines.indexOf('');
  const block = (blockEnd === -1 ? blockLines : blockLines.slice(0, blockEnd)).filter((l) => l.startsWith('/'));
  const roots = block.filter((l) => l.endsWith('/'));

  it('the committed .gitignore carries the overlay-mirror block with the manifest', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain(`/${MANIFEST_NAME}`);
  });

  // Private folders ignore themselves (the mirror's root .gitignore), so no public file names an
  // output root beyond the ones the .gitignore block already listed.
  it.runIf(existsSync(join(REPO_ROOT, OVERLAY)))('names no newer output root in a public config file (maintainer checkout)', () => {
    const plan = planOverlayMirror({ root: REPO_ROOT });
    const listed = new Set(roots.map((r) => r.slice(1, -1)));
    const unlisted = plan.roots.filter((r) => !listed.has(r));
    const configs = ['.gitignore', 'tsconfig.json', 'tsconfig.example.json', 'vitest.config.ts', 'next.config.mjs', 'eslint.config.mjs'];
    for (const file of configs) {
      const text = readFileSync(join(REPO_ROOT, file), 'utf8');
      for (const r of unlisted) expect(text.includes(r), `${file} names ${r}`).toBe(false);
    }
  });

  // tsconfig.example.json replaces the base `exclude` wholesale and must leave out exactly the
  // overlay outputs, or typecheck:example checks private copies (or skips public code).
  it('tsconfig.example.json excludes exactly the private pack folder and the .gitignore mirror roots', () => {
    const tsconfig = JSON.parse(readFileSync(join(REPO_ROOT, 'tsconfig.example.json'), 'utf8'));
    const excluded = tsconfig.exclude.filter((/** @type {string} */ e) => e.startsWith('src/'));
    const expected = ['src/format-packs/private', ...roots.map((r) => r.slice(1, -1))];
    expect([...excluded].sort()).toEqual([...expected].sort());
  });

  it('no mirror output root holds a tracked file', () => {
    for (const r of roots) {
      expect(git(REPO_ROOT, 'ls-files', '-z', '--', r.slice(1)), r).toBe('');
    }
  });

  // The mirror trusts only the .gitignore committed at HEAD. These checks run the branch's
  // .gitignore through a temp repo that commits it, so they hold before the branch is committed.
  it('this .gitignore alone, once committed, ignores every mirror root and the manifest', () => {
    const probes = [...roots.map((r) => `${r.slice(1)}probe.ts`), MANIFEST_NAME];
    const ignored = committedIgnoredSet(repoWithCommittedGitignore(gitignore), probes);
    for (const p of probes) expect(ignored.has(caseInsensitiveFs ? p.toLowerCase() : p), p).toBe(true);
  });

  it.runIf(existsSync(join(REPO_ROOT, OVERLAY)))('every file in the attached overlay lands in a private, ignored root (maintainer checkout)', () => {
    const probeRoot = repoWithCommittedGitignore(gitignore);
    const real = gitQueries(REPO_ROOT);
    const plan = planOverlayMirror({
      root: REPO_ROOT,
      git: {
        trackedSet: real.trackedSet,
        committedIgnored: (rels, selfIgnoredRoots) => committedIgnoredSet(probeRoot, rels, selfIgnoredRoots),
      },
    });
    const structural = [REASON.NOT_COMMITTED_IGNORED, REASON.TRACKED, REASON.FILE_IN_PUBLIC_DIR, REASON.RESERVED_NAME];
    expect(plan.refusals.filter((r) => structural.includes(r.reason))).toEqual([]);
    expect(plan.roots.length).toBeGreaterThan(0);
  });
});
