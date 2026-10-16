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
  LOCAL_WORLD_ASSETS_URL,
  assertNoBucketEgress,
  assetOriginSummary,
  bucketGuardVerdict,
  captureServerEnv,
} from '../lib/look-evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const BUCKET_URL = 'https://abc.supabase.co/storage/v1/object/public/world-assets';

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

  it('capture-route spawns next dev with that env', () => {
    const source = readFileSync(resolve(repoRoot, 'scripts', 'capture-route.mjs'), 'utf8');
    const spawnAt = source.indexOf("'dev', '--port', String(port)]");
    expect(spawnAt).toBeGreaterThan(-1);
    const call = source.slice(source.lastIndexOf('spawn(', spawnAt), source.indexOf(');', spawnAt));
    expect(call).toMatch(/env: captureServerEnv\(process\.env\)/);
    expect(source).toMatch(/import \{[^}]*\bcaptureServerEnv\b[^}]*\} from '\.\/lib\/look-evidence\.mjs'/);
  });

  it('matches the .claude/local-assets.cjs preload', () => {
    const out = execFileSync(process.execPath, ['--require', './.claude/local-assets.cjs', '-e', 'process.stdout.write(process.env.NEXT_PUBLIC_WORLD_ASSETS_URL)'], {
      cwd: repoRoot,
      env: { ...process.env, NEXT_PUBLIC_WORLD_ASSETS_URL: BUCKET_URL },
      encoding: 'utf8',
    });
    expect(out).toBe(LOCAL_WORLD_ASSETS_URL);
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
    expect(bucketGuardVerdict(localLoad)).toEqual({ verdict: 'pass', bucket: 0, allowBucket: false });
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
    expect(verdict.reason).toMatch(/2 world-asset request\(s\) hit the Supabase bucket/);
    expect(verdict.reason).toMatch(/--allow-bucket/);
    expect(verdict.reason).toContain('abc.supabase.co/storage/v1/object/public/world-assets/env/hdri/gold.hdr');
  });

  it('fails on a bare sidecar record too (sources only)', () => {
    expect(bucketGuardVerdict({ sources: { localMirror: 10, appTextures: 0, bucket: 1 } }).verdict).toBe('fail');
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
    expect(source).toMatch(/\n {2}--allow-bucket {10}Let world assets come from the Supabase/);
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
      ['board', 3111],
      ['board-local', 3111],
      ['prod-local', 3112],
    ]);
  });

  it('preloads local-assets.cjs before next in every next dev/start config', () => {
    expect(nextConfigs.length).toBe(4);
    for (const config of nextConfigs) {
      const args = config.runtimeArgs;
      const req = args.indexOf('--require');
      const next = args.findIndex((a) => a.endsWith('node_modules/next/dist/bin/next'));
      expect(req, config.name).toBeGreaterThan(-1);
      expect(args[req + 1], config.name).toBe('./.claude/local-assets.cjs');
      expect(req, config.name).toBeLessThan(next);
    }
  });
});
