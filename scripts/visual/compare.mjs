#!/usr/bin/env node
/**
 * Visual-capture harness: capture a base ref and the head, then diff them (docs/visual-harness.md).
 *
 *   node scripts/visual/compare.mjs --base <git ref> [--head <git ref>] [--head-url <url>] [--set frozen|surfaces|all]
 *        [--only <target id>[,...]] [--concurrency <n>] [--keep]
 *
 * The base ref is checked out into a detached worktree in ../.poketools-visual-worktrees/ (beside the checkout). Its node_modules is a hard-linked
 * copy of this checkout's when both lockfiles match (npm ci otherwise), and the gitignored local assets under public/
 * (world mirror, avatar layers) are hard-linked in too, so both sides render the same assets. The harness itself
 * (scripts/visual/) is copied from the head into the base worktree, so both sides are captured by the same code.
 * Without --head the head is this checkout's working tree; when a dev server already runs here (next dev allows one
 * per directory), pass its URL as --head-url.
 *
 * Exits with diff.mjs's verdict: 0 when every frozen capture is identical, 1 otherwise.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture, DEFAULT_PORT } from './run.mjs';
import { diffLabels } from './diff.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(REPO, '.visual');
/** Outside the checkout, so tsc, vitest, ESLint and Turbopack never see a second copy of the tree. */
const WORKTREES = resolve(REPO, '..', '.poketools-visual-worktrees');

function option(argv, name, fallback) {
  const i = argv.indexOf('--' + name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

function git(args, cwd = REPO) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Ignored paths under public/ that this checkout has (local mirrors), relative to the repo root. */
function ignoredPublicAssets() {
  const out = git(['status', '--short', '--ignored', '--', 'public']);
  return out.split('\n').filter((line) => line.startsWith('!! ')).map((line) => line.slice(3).replace(/\/$/, ''));
}

async function prepareWorktree(ref, name) {
  const dir = join(WORKTREES, name);
  if (existsSync(dir)) {
    spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: REPO });
    await rm(dir, { recursive: true, force: true });
  }
  git(['worktree', 'add', '--detach', dir, ref]);
  const sameLock = (await readFile(join(REPO, 'package-lock.json'), 'utf8')) === (await readFile(join(dir, 'package-lock.json'), 'utf8'));
  if (sameLock) {
    execFileSync('cp', ['-al', join(REPO, 'node_modules'), join(dir, 'node_modules')]);
  } else {
    console.log('visual: ' + ref + ' has another lockfile: npm ci in its worktree');
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' });
  }
  for (const rel of ignoredPublicAssets()) {
    const target = join(dir, rel);
    if (existsSync(target)) continue;
    execFileSync('mkdir', ['-p', dirname(target)]);
    execFileSync('cp', ['-al', join(REPO, rel), target]);
  }
  await rm(join(dir, 'scripts', 'visual'), { recursive: true, force: true });
  await cp(join(REPO, 'scripts', 'visual'), join(dir, 'scripts', 'visual'), { recursive: true });
  return dir;
}

async function main() {
  const argv = process.argv.slice(2);
  const baseRef = option(argv, 'base');
  if (!baseRef) {
    console.error('visual: --base <git ref> is required');
    process.exit(2);
  }
  const headRef = option(argv, 'head', null);
  const headUrl = option(argv, 'head-url', null);
  const set = option(argv, 'set', 'frozen');
  const sets = set === 'all' ? ['frozen', 'surfaces'] : [set];
  const only = (option(argv, 'only', '') || '').split(',').filter(Boolean);
  const concurrency = Number(option(argv, 'concurrency', 4));
  // The frozen roots are data-frozen markers in the components: a base from before the harness has none, so
  // there is nothing to compare against (the PR that adds the harness itself).
  if (spawnSync('git', ['cat-file', '-e', baseRef + ':scripts/visual/frozen.json'], { cwd: REPO }).status !== 0) {
    console.log('visual: ' + baseRef + ' predates the harness (no scripts/visual/frozen.json): nothing to compare');
    process.exit(0);
  }
  const baseLabel = 'base-' + git(['rev-parse', '--short', baseRef]);
  const headLabel = headRef ? 'head-' + git(['rev-parse', '--short', headRef]) : 'head-worktree';

  const baseDir = await prepareWorktree(baseRef, 'base');
  const headDir = headRef ? await prepareWorktree(headRef, 'head') : REPO;
  const base = await capture({ label: baseLabel, sets, only, appDir: baseDir, port: DEFAULT_PORT + 1, concurrency, out: OUT });
  const head = await capture({ label: headLabel, sets, only, appDir: headDir, port: DEFAULT_PORT + 2, baseUrl: headRef ? null : headUrl, concurrency, out: OUT });
  let pass = base.ok && head.ok;
  for (const s of sets) {
    const result = await diffLabels({ base: baseLabel, head: headLabel, set: s, out: OUT });
    console.log('visual: ' + s + ': ' + result.compared + ' compared, ' + result.failing.length + ' failing, ' + result.errored.length + ' errored; ' + join(result.reportDir, 'report.md'));
    pass = pass && result.pass;
  }
  if (!argv.includes('--keep')) {
    for (const name of ['base', 'head']) {
      const dir = join(WORKTREES, name);
      if (existsSync(dir)) spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: REPO });
    }
  }
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
