/**
 * .claude/local-assets.cjs under `next start` (Kilo 4198840210): Next inlines NEXT_PUBLIC_* at build time, so the
 * preload's env pin cannot change a finished build's asset base. The preload refuses to start a build that baked
 * the world-assets or the sprites bucket; `next dev` (compiled with the pinned env) and a build without the bucket start as before.
 * A stub stands in for next's bin; the builds are fixture chunks in a temp dir.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PRELOAD = resolve(here, '..', '..', '.claude', 'local-assets.cjs');
const BUCKET_URL = 'https://abc.supabase.co/storage/v1/object/public/world-assets';

describe('local-assets.cjs: a next start build must not bake the bucket', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'local-assets-'));
    writeFileSync(join(dir, 'next.js'), "process.stdout.write(`served ${process.argv[2]} ${process.env.NEXT_PUBLIC_WORLD_ASSETS_URL}`);\n");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** A build whose client chunk inlined `base` the way next build does (the getWorldAssetBase body). */
  const build = (base) => {
    mkdirSync(join(dir, '.next', 'static', 'chunks', 'app'), { recursive: true });
    writeFileSync(join(dir, '.next', 'static', 'chunks', 'main.js'), 'console.log("main");\n');
    writeFileSync(join(dir, '.next', 'static', 'chunks', 'app', 'route.js'), `function b(){let t=${JSON.stringify(base)}.trim();return t}\n`);
  };
  const run = (cmd) => spawnSync(process.execPath, ['--require', PRELOAD, 'next.js', cmd, '--port', '3112'], {
    cwd: dir,
    env: { ...process.env, NEXT_PUBLIC_WORLD_ASSETS_URL: BUCKET_URL },
    encoding: 'utf8',
  });

  it('refuses next start on a build that baked the bucket URL, naming the chunk and the rebuild', () => {
    build(BUCKET_URL);
    const r = run('start');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/\[local-assets\] refused: this build baked the world-assets bucket/);
    expect(r.stderr).toMatch(/\.next[\\/]static[\\/]chunks[\\/]app[\\/]route\.js/);
    expect(r.stderr).toContain("$env:NEXT_PUBLIC_WORLD_ASSETS_URL='/models/world'; npm run build");
  });

  it('starts a build baked with the local mirror (or any non-bucket base)', () => {
    build('/models/world');
    expect(run('start')).toMatchObject({ status: 0, stdout: 'served start /models/world' });
    build('/models/world/d42');
    expect(run('start').status).toBe(0);
  });

  it('leaves a missing build to next start itself', () => {
    expect(run('start')).toMatchObject({ status: 0, stdout: 'served start /models/world' });
  });

  it('refuses next start on a build that baked the sprites bucket (docs/pkmn.md, Sprite styles)', () => {
    build('https://abc.supabase.co/storage/v1/object/public/sprites');
    const r = run('start');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/\[local-assets\] refused: this build baked the sprites bucket/);
    expect(r.stderr).toContain("$env:NEXT_PUBLIC_SPRITES_URL='/sprites'; npm run build");
  });

  it('does not mistake another bucket whose name starts with sprites, and accepts the /sprites mirror', () => {
    build('https://abc.supabase.co/storage/v1/object/public/sprites-archive');
    expect(run('start').status).toBe(0);
    build('/sprites');
    expect(run('start').status).toBe(0);
  });

  it('pins NEXT_PUBLIC_SPRITES_URL to the local mirror for next dev', () => {
    writeFileSync(join(dir, 'next.js'), 'process.stdout.write(String(process.env.NEXT_PUBLIC_SPRITES_URL));\n');
    expect(run('dev')).toMatchObject({ status: 0, stdout: '/sprites' });
  });

  it('never scans for next dev: the dev server compiles with the pinned env', () => {
    build(BUCKET_URL);
    expect(run('dev')).toMatchObject({ status: 0, stdout: 'served dev /models/world' });
  });
});
