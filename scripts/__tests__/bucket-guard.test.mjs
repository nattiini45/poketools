/**
 * DATA-PLAN fix 1: automation never spends the Supabase quota.
 *  - the dev server capture-route boots itself gets the local mirror env;
 *  - look-evidence's bucket guard fails a run whose load hit the bucket,
 *    unless --allow-bucket;
 *  - every .claude/launch.json next dev/start config preloads local-assets.cjs.
 * capture-route.mjs runs the harness at import time, so its wiring is checked
 * on the source text (the quiet-probe.test.mjs precedent), never executed.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BucketEgressError,
  LOCAL_SPRITES_URL,
  LOCAL_WORLD_ASSETS_URL,
  assertNoBucketEgress,
  assetOriginSummary,
  bucketGuardVerdict,
  captureServerEnv,
  isSpritesBucketUrl,
} from '../lib/look-evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const BUCKET_URL = 'https://abc.supabase.co/storage/v1/object/public/world-assets';
const SPRITES_BUCKET_URL = 'https://abc.supabase.co/storage/v1/object/public/sprites';

describe('captureServerEnv (the self-booted next dev)', () => {
  it('pins NEXT_PUBLIC_WORLD_ASSETS_URL to the local mirror over a bucket URL', () => {
    const base = { PATH: '/bin', NEXT_PUBLIC_WORLD_ASSETS_URL: BUCKET_URL, NODE_OPTIONS: '--max-old-space-size=4096' };
    const env = captureServerEnv(base);
    expect(env.NEXT_PUBLIC_WORLD_ASSETS_URL).toBe('/models/world');
    expect(env.NEXT_PUBLIC_WORLD_ASSETS_URL).toBe(LOCAL_WORLD_ASSETS_URL);
    expect(env.PATH).toBe('/bin');
    expect(env.NODE_OPTIONS).toBe('--max-old-space-size=4096');
    expect(base.NEXT_PUBLIC_WORLD_ASSETS_URL).toBe(BUCKET_URL);
  });

  it('sets it when the parent env has none', () => {
    expect(captureServerEnv({}).NEXT_PUBLIC_WORLD_ASSETS_URL).toBe('/models/world');
  });

  it('pins NEXT_PUBLIC_SPRITES_URL to the local mirror over a sprites bucket URL (or none)', () => {
    const base = { NEXT_PUBLIC_SPRITES_URL: SPRITES_BUCKET_URL, PATH: '/bin' };
    const env = captureServerEnv(base);
    expect(env.NEXT_PUBLIC_SPRITES_URL).toBe('/sprites');
    expect(env.NEXT_PUBLIC_SPRITES_URL).toBe(LOCAL_SPRITES_URL);
    expect(env.PATH).toBe('/bin');
    expect(base.NEXT_PUBLIC_SPRITES_URL).toBe(SPRITES_BUCKET_URL);
    expect(captureServerEnv({}).NEXT_PUBLIC_SPRITES_URL).toBe('/sprites');
  });

  it('capture-route spawns next dev with that env', () => {
    const source = readFileSync(resolve(repoRoot, 'scripts', 'capture-route.mjs'), 'utf8');
    const spawnAt = source.indexOf("'dev', '--port', String(port)]");
    expect(spawnAt).toBeGreaterThan(-1);
    const call = source.slice(source.lastIndexOf('spawn(', spawnAt), source.indexOf(');', spawnAt));
    expect(call).toMatch(/env: captureServerEnv\(process\.env\)/);
    expect(source).toMatch(/import \{[^}]*\bcaptureServerEnv\b[^}]*\} from '\.\/lib\/look-evidence\.mjs'/);
  });

  it('matches the .claude/local-assets.cjs preload (world assets and sprites)', () => {
    const out = execFileSync(
      process.execPath,
      ['--require', './.claude/local-assets.cjs', '-e', "process.stdout.write(process.env.NEXT_PUBLIC_WORLD_ASSETS_URL + ' ' + process.env.NEXT_PUBLIC_SPRITES_URL)"],
      {
        cwd: repoRoot,
        env: { ...process.env, NEXT_PUBLIC_WORLD_ASSETS_URL: BUCKET_URL, NEXT_PUBLIC_SPRITES_URL: SPRITES_BUCKET_URL },
        encoding: 'utf8',
      },
    );
    expect(out).toBe(`${LOCAL_WORLD_ASSETS_URL} ${LOCAL_SPRITES_URL}`);
  });
});

describe('bucket guard', () => {
  const localLoad = assetOriginSummary(
    [
      { url: 'http://localhost:3111/models/world/models/regular/1.glb', bytes: 300 },
      { url: 'http://localhost:3111/models/world/env/hdri/gold.jpg', bytes: 100 },
    ],
    'http://localhost:3111',
  );
  const bucketLoad = assetOriginSummary(
    [
      { url: 'http://localhost:3111/models/world/models/regular/1.glb', bytes: 300 },
      { url: `${BUCKET_URL}/env/hdri/gold.hdr`, bytes: 1_206_000 },
      { url: `${BUCKET_URL}/models/regular/4.glb`, bytes: 192_000 },
    ],
    'http://localhost:3111',
  );

  it('passes a load served from the local mirror', () => {
    expect(localLoad.sources.bucket).toBe(0);
    expect(bucketGuardVerdict(localLoad)).toEqual({ verdict: 'pass', bucket: 0, spritesBucket: 0, allowBucket: false });
    expect(assertNoBucketEgress(localLoad).verdict).toBe('pass');
  });

  it('passes when no load was recorded', () => {
    expect(bucketGuardVerdict(null).verdict).toBe('pass');
    expect(bucketGuardVerdict({}).verdict).toBe('pass');
  });

  it('FAILS a load with sources.bucket > 0 without --allow-bucket', () => {
    const verdict = bucketGuardVerdict(bucketLoad);
    expect(verdict.verdict).toBe('fail');
    expect(verdict.bucket).toBe(2);
    expect(verdict.reason).toMatch(/2 world-asset request\(s\) hit the Supabase world-assets bucket/);
    expect(verdict.reason).toMatch(/--allow-bucket/);
    expect(verdict.reason).toContain('abc.supabase.co/storage/v1/object/public/world-assets/env/hdri/gold.hdr');
  });

  it('fails on a bare sidecar record too (sources only)', () => {
    expect(bucketGuardVerdict({ sources: { localMirror: 10, appTextures: 0, bucket: 1 } }).verdict).toBe('fail');
  });

  describe('the sprites bucket', () => {
    const spriteLoad = assetOriginSummary(
      [
        { url: 'http://localhost:3111/models/world/models/regular/1.glb', bytes: 300 },
        { url: 'http://localhost:3111/sprites/broadcast/0123456789ab/256/6.webp', bytes: 9_000 },
        { url: `${SPRITES_BUCKET_URL}/broadcast/0123456789ab/256/445.webp`, bytes: 9_000 },
        { url: `${SPRITES_BUCKET_URL}/broadcast/0123456789ab/full/445.webp?v=1`, bytes: 90_000 },
      ],
      'http://localhost:3111',
    );

    it('isSpritesBucketUrl matches the bucket path only (not a local mirror, not a look-alike bucket)', () => {
      expect(isSpritesBucketUrl(`${SPRITES_BUCKET_URL}/broadcast/v/256/1.webp`)).toBe(true);
      expect(isSpritesBucketUrl('http://localhost:3111/sprites/broadcast/v/256/1.webp')).toBe(false);
      expect(isSpritesBucketUrl('https://abc.supabase.co/storage/v1/object/public/sprites-old/1.webp')).toBe(false);
      expect(isSpritesBucketUrl(`${BUCKET_URL}/env/a.hdr`)).toBe(false);
      expect(isSpritesBucketUrl('')).toBe(false);
      expect(isSpritesBucketUrl(undefined)).toBe(false);
    });

    it('counts sprites-bucket requests apart from the world assets', () => {
      expect(spriteLoad.worldAssetRequests).toBe(1);
      expect(spriteLoad.sources).toEqual({ localMirror: 1, appTextures: 0, bucket: 0 });
      expect(spriteLoad.spritesBucket).toEqual({
        requests: 2,
        sample: ['abc.supabase.co/storage/v1/object/public/sprites/broadcast/0123456789ab/256/445.webp', 'abc.supabase.co/storage/v1/object/public/sprites/broadcast/0123456789ab/full/445.webp'],
      });
      expect(assetOriginSummary([], 'http://localhost:3111').spritesBucket).toEqual({ requests: 0, sample: [] });
    });

    it('FAILS a load that hit the sprites bucket, naming the first object', () => {
      const verdict = bucketGuardVerdict(spriteLoad);
      expect(verdict).toMatchObject({ verdict: 'fail', bucket: 0, spritesBucket: 2 });
      expect(verdict.reason).toMatch(/2 sprite request\(s\) hit the Supabase sprites bucket/);
      expect(verdict.reason).toMatch(/must load \/models\/world and \/sprites/);
      expect(verdict.reason).toContain('public/sprites/broadcast/0123456789ab/256/445.webp');
      expect(() => assertNoBucketEgress(spriteLoad)).toThrow(BucketEgressError);
      expect(bucketGuardVerdict({ spritesBucket: { requests: 1 } }).verdict).toBe('fail');
    });

    it('--allow-bucket records it as allowed', () => {
      expect(assertNoBucketEgress(spriteLoad, { allowBucket: true })).toMatchObject({ verdict: 'allowed', spritesBucket: 2 });
    });

    it('capture-route records sprites-bucket requests for the guard', () => {
      const source = readFileSync(resolve(repoRoot, 'scripts', 'capture-route.mjs'), 'utf8');
      expect(source).toContain('if (!isWorldAssetUrl(url) && !isSpritesBucketUrl(url)) return;');
      expect(source).toMatch(/import \{[^}]*\bisSpritesBucketUrl\b[^}]*\} from '\.\/lib\/look-evidence\.mjs'/);
    });
  });

  it('assertNoBucketEgress throws a BucketEgressError carrying the verdict', () => {
    let caught = null;
    try {
      assertNoBucketEgress(bucketLoad);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BucketEgressError);
    expect(caught.message).toMatch(/^bucket guard: 2 world-asset request/);
    expect(caught.verdict.verdict).toBe('fail');
  });

  it('--allow-bucket turns the failure into a recorded "allowed"', () => {
    const verdict = assertNoBucketEgress(bucketLoad, { allowBucket: true });
    expect(verdict).toMatchObject({ verdict: 'allowed', bucket: 2, allowBucket: true });
  });

  it('capture-route parses --allow-bucket, documents it, and guards every recorded asset origin', () => {
    const source = readFileSync(resolve(repoRoot, 'scripts', 'capture-route.mjs'), 'utf8');
    expect(source).toContain("const allowBucketOn = process.argv.includes('--allow-bucket');");
    // Value-less: the positional collector must skip it (else the run exits 2).
    expect(source).toMatch(/\[[^\]]*'--allow-bucket'[^\]]*\]\.includes\(token\)\) continue;/);
    expect(source).toMatch(/\n {2}--allow-bucket {10}Let world assets and sprites come from the Supabase/);
    const fnAt = source.indexOf('function currentAssetOrigin()');
    const body = source.slice(fnAt, source.indexOf('\n}\n', fnAt));
    expect(body).toContain('assertNoBucketEgress(summary, { allowBucket: allowBucketOn })');
    // Sticky: a throw caught somewhere inside the run still fails it at exit.
    expect(source).toMatch(/if \(bucketGuardFailure !== null && exitCode === 0\) \{[\s\S]{0,120}exitCode = 1;/);
  });
});

describe('.claude/launch.json', () => {
  const launch = JSON.parse(readFileSync(resolve(repoRoot, '.claude', 'launch.json'), 'utf8'));
  const nextConfigs = launch.configurations.filter((c) => (c.runtimeArgs ?? []).some((a) => /node_modules\/next\/dist\/bin\/next$/.test(a)));

  it('keeps the existing config names and ports', () => {
    expect(launch.configurations.map((c) => [c.name, c.port])).toEqual([
      ['dev', 3000],
      ['dev-localdb', 3010],
      ['board', 3111],
      ['board-local', 3111],
      ['prod-local', 3112],
    ]);
  });

  it('preloads local-assets.cjs before next in every next dev/start config', () => {
    expect(nextConfigs.length).toBe(5);
    for (const config of nextConfigs) {
      const args = config.runtimeArgs;
      const req = args.indexOf('--require');
      const next = args.findIndex((a) => a.endsWith('node_modules/next/dist/bin/next'));
      expect(req, config.name).toBeGreaterThan(-1);
      // local-db.cjs (the local Supabase stack) loads local-assets.cjs itself: one --require, because some
      // launchers merge repeated --require flags into one module path.
      expect(['./.claude/local-assets.cjs', './.claude/local-db.cjs'], config.name).toContain(args[req + 1]);
      expect(req, config.name).toBeLessThan(next);
    }
  });

  it('local-db.cjs chains local-assets.cjs and never names a hosted project', () => {
    const preload = readFileSync(resolve(repoRoot, '.claude', 'local-db.cjs'), 'utf8');
    expect(preload).toContain("require('./local-assets.cjs')");
    expect(preload).toContain('http://127.0.0.1:');
    expect(preload).not.toContain('supabase.co');
  });
});
