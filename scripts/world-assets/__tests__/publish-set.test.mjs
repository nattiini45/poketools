/**
 * DATA-PLAN fix 7 (D37): the hashed publish set and the upload CLI's
 * dry-run-by-default contract. No network: the CLI is only ever run without
 * --live, and a dry run never reads .env.local or creates a client.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HASHED_CACHE_CONTROL,
  LOGICAL_CACHE_CONTROL,
  MANIFEST_CACHE_CONTROL,
  buildPublishSet,
  contentHash,
  contentTypeFor,
  hashedPath,
  manifestAssetFiles,
  uploadPhases,
} from '../publish-set.mjs';
import { livePlanFails, parseArgs, sourceManifestFile } from '../upload-supabase.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(here, '..', 'upload-supabase.mjs');
const REPO = resolve(here, '..', '..', '..');
const MIRROR = join(REPO, 'public', 'models', 'world');
const HASHED_RE = /\.[0-9a-f]{12}\.[a-z0-9]+$/;

const FIXTURE_FILES = {
  'models/regular/1.glb': 'glb-bulbasaur',
  'models/regular/4.glb': 'glb-charmander',
  'models/alolan/27.glb': 'glb-sandshrew-alola',
  'props/lamp.glb': 'glb-lamp',
  'env/hdri/gold.hdr': 'hdr-gold',
  'env/hdri/gold.jpg': 'jpg-gold',
  'env/tex/cobble/diff.webp': 'webp-cobble',
  'env/ATTRIBUTION.md': '# env attribution',
  'ATTRIBUTION.md': '# attribution',
  'orphan.bin': 'not referenced',
};

const FIXTURE_MANIFEST = {
  version: 3,
  generatedAt: '2026-09-28T00:00:00.000Z',
  figures: [
    { dexId: 1, form: 'regular', species: 'Bulbasaur', aliases: [], file: 'models/regular/1.glb', kb: 1 },
    { dexId: 4, form: 'regular', species: 'Charmander', aliases: [], file: 'models/regular/4.glb', kb: 1 },
    { dexId: 27, form: 'alolan', species: 'Sandshrew-Alola', aliases: [], file: 'models/alolan/27.glb', kb: 1 },
    // A stand-in sharing the regular file (sourceForm: regular).
    { dexId: 1, form: 'alolan', species: 'Bulbasaur-Alola', aliases: [], file: 'models/regular/1.glb', sourceForm: 'regular', kb: 1 },
  ],
  props: [{ name: 'lamp', file: 'props/lamp.glb', kb: 1 }],
  environment: [
    { file: 'env/ATTRIBUTION.md', kb: 1 },
    { file: 'env/hdri/gold.hdr', kb: 1 },
    { file: 'env/hdri/gold.jpg', kb: 1 },
    { file: 'env/tex/cobble/diff.webp', kb: 1 },
  ],
  missingForms: [],
  pool: null,
};

function fixtureSet(options = {}) {
  const files = [...Object.keys(FIXTURE_FILES), 'manifest.json'];
  return buildPublishSet({ manifest: FIXTURE_MANIFEST, files, readBytes: (file) => Buffer.from(FIXTURE_FILES[file]), ...options });
}

describe('hashed names', () => {
  it('insert the content hash before the extension and keep the folder', () => {
    expect(hashedPath('models/regular/4.glb', 'abcdef012345')).toBe('models/regular/4.abcdef012345.glb');
    expect(hashedPath('env/tex/cobble/diff.webp', '0123456789ab')).toBe('env/tex/cobble/diff.0123456789ab.webp');
    expect(hashedPath('env/kit/bay-balcony.glb', 'aaaaaaaaaaaa')).toBe('env/kit/bay-balcony.aaaaaaaaaaaa.glb');
    expect(hashedPath('LICENSE', 'aaaaaaaaaaaa')).toBe('LICENSE.aaaaaaaaaaaa');
    expect(hashedPath('.hidden/x', 'aaaaaaaaaaaa')).toBe('.hidden/x.aaaaaaaaaaaa');
  });

  it('are content-addressed: same bytes, same hash; different bytes, different hash', () => {
    expect(contentHash(Buffer.from('a'))).toBe(contentHash(Buffer.from('a')));
    expect(contentHash(Buffer.from('a'))).not.toBe(contentHash(Buffer.from('b')));
    expect(contentHash(Buffer.from('a'))).toMatch(/^[0-9a-f]{12}$/);
  });

  it('keep the loader-relevant content types', () => {
    expect(contentTypeFor('models/regular/4.0123456789ab.glb')).toBe('model/gltf-binary');
    expect(contentTypeFor('env/hdri/gold.0123456789ab.jpg')).toBe('image/jpeg');
    expect(contentTypeFor('env/hdri/gold.hdr')).toBe('image/vnd.radiance');
    expect(contentTypeFor('manifest.json')).toBe('application/json');
    expect(contentTypeFor('ATTRIBUTION.md')).toMatch(/^text\/markdown/);
  });
});

describe('buildPublishSet', () => {
  it('lists every referenced file once, figures first', () => {
    expect(manifestAssetFiles(FIXTURE_MANIFEST).map((a) => a.file)).toEqual([
      'models/regular/1.glb',
      'models/regular/4.glb',
      'models/alolan/27.glb',
      'props/lamp.glb',
      'env/ATTRIBUTION.md',
      'env/hdri/gold.hdr',
      'env/hdri/gold.jpg',
      'env/tex/cobble/diff.webp',
    ]);
  });

  it('publishes hashed assets for a year, env compat copies for a day, the manifest at max-age=0', () => {
    const set = fixtureSet();
    expect(set.missing).toEqual([]);
    expect(set.skipped).toEqual(['orphan.bin']);
    const hashed = set.entries.filter((e) => e.kind === 'hashed');
    expect(hashed).toHaveLength(8);
    for (const e of hashed) {
      expect(e.path).toMatch(HASHED_RE);
      expect(e.path).toBe(hashedPath(e.logical, contentHash(Buffer.from(FIXTURE_FILES[e.logical]))));
      expect(e.cacheControl).toBe(HASHED_CACHE_CONTROL);
    }
    expect(HASHED_CACHE_CONTROL).toBe('31536000');
    const compat = set.entries.filter((e) => e.kind === 'compat');
    expect(compat.map((e) => e.path)).toEqual(['env/ATTRIBUTION.md', 'env/hdri/gold.hdr', 'env/hdri/gold.jpg', 'env/tex/cobble/diff.webp']);
    expect(compat.every((e) => e.cacheControl === LOGICAL_CACHE_CONTROL)).toBe(true);
    expect(set.entries.filter((e) => e.kind === 'doc').map((e) => e.path)).toEqual(['ATTRIBUTION.md']);
    const manifest = set.entries.filter((e) => e.kind === 'manifest');
    expect(manifest).toEqual([expect.objectContaining({ path: 'manifest.json', cacheControl: MANIFEST_CACHE_CONTROL })]);
    expect(MANIFEST_CACHE_CONTROL).toBe('0');
  });

  it('rewrites figure and prop files to the hashed names and keeps env files logical', () => {
    const set = fixtureSet();
    const published = JSON.parse(Buffer.from(set.manifestBytes).toString('utf8'));
    expect(published).toEqual(set.manifest);
    for (const f of published.figures) expect(f.file).toMatch(HASHED_RE);
    expect(published.figures[0].file).toBe(published.figures[3].file);
    expect(published.figures[0].file).toBe(set.files['models/regular/1.glb']);
    expect(published.props[0].file).toBe(set.files['props/lamp.glb']);
    // world-env.ts matches env files by logical name.
    expect(published.environment).toEqual(FIXTURE_MANIFEST.environment);
    expect(Object.keys(published.files)).toEqual(FIXTURE_MANIFEST.environment.map((e) => e.file));
    expect(published.files['env/hdri/gold.jpg']).toMatch(/^env\/hdri\/gold\.[0-9a-f]{12}\.jpg$/);
    // Everything else rides along untouched.
    expect(published.version).toBe(3);
    expect(published.generatedAt).toBe(FIXTURE_MANIFEST.generatedAt);
    expect(published.figures[1]).toEqual({ ...FIXTURE_MANIFEST.figures[1], file: set.files['models/regular/4.glb'] });
    expect(published.publish).toEqual({ hashed: true, hashLength: 12, envCompat: true });
    // Every published file name is an uploaded object.
    const uploaded = new Set(set.entries.map((e) => e.path));
    for (const f of [...published.figures, ...published.props, ...published.environment]) expect(uploaded.has(f.file)).toBe(true);
    for (const hashed of Object.values(published.files)) expect(uploaded.has(hashed)).toBe(true);
  });

  it('never touches the source manifest (the dev loop keeps logical names)', () => {
    const before = JSON.stringify(FIXTURE_MANIFEST);
    fixtureSet();
    expect(JSON.stringify(FIXTURE_MANIFEST)).toBe(before);
  });

  it('is deterministic (same input, byte-identical manifest, so the ETag only changes with content)', () => {
    expect(Buffer.from(fixtureSet().manifestBytes).equals(Buffer.from(fixtureSet().manifestBytes))).toBe(true);
  });

  it('reports referenced files missing from the source', () => {
    const files = Object.keys(FIXTURE_FILES).filter((f) => f !== 'props/lamp.glb' && f !== 'env/hdri/gold.jpg');
    const set = buildPublishSet({ manifest: FIXTURE_MANIFEST, files, readBytes: (file) => Buffer.from(FIXTURE_FILES[file]) });
    expect(set.missing).toEqual(['props/lamp.glb', 'env/hdri/gold.jpg']);
  });

  it('--no-env-compat drops the logical env copies', () => {
    const set = fixtureSet({ envCompat: false });
    expect(set.entries.some((e) => e.kind === 'compat')).toBe(false);
    expect(set.manifest.publish.envCompat).toBe(false);
  });

  it('--only scopes the entries (and only "manifest" publishes the manifest alone)', () => {
    expect(fixtureSet({ only: 'models' }).entries.map((e) => e.kind)).toEqual(['hashed', 'hashed', 'hashed']);
    expect(fixtureSet({ only: 'props' }).entries.map((e) => e.logical)).toEqual(['props/lamp.glb']);
    expect(fixtureSet({ only: 'env' }).entries.every((e) => e.logical.startsWith('env/'))).toBe(true);
    expect(fixtureSet({ only: 'manifest' }).entries.map((e) => e.kind)).toEqual(['manifest']);
    expect(() => fixtureSet({ only: 'bogus' })).toThrow(/unknown --only scope/);
  });

  it('uploads the manifest last', () => {
    const phases = uploadPhases(fixtureSet().entries);
    expect(phases.assets.every((e) => e.kind === 'hashed')).toBe(true);
    expect(phases.logical.map((e) => e.kind).sort()).toEqual(['compat', 'compat', 'compat', 'compat', 'doc']);
    expect(phases.manifest.map((e) => e.path)).toEqual(['manifest.json']);
  });
});

describe('upload-supabase.mjs arguments', () => {
  it('is a dry run unless --live', () => {
    expect(parseArgs([]).options.live).toBe(false);
    expect(parseArgs(['--from-mirror']).options).toMatchObject({ live: false, fromMirror: true });
    expect(parseArgs(['--from-mirror', '--live', '--expect-plan', 'r1']).options.live).toBe(true);
    expect(parseArgs(['--from-mirror', '--live']).error).toMatch(/needs --expect-plan/); // TA-B1
  });

  it('rejects contradictory or unknown arguments', () => {
    expect(parseArgs(['--live', '--dry-run']).error).toMatch(/mutually exclusive/);
    expect(parseArgs(['--from-mirror', '--source', 'x']).error).toMatch(/mutually exclusive/);
    expect(parseArgs(['--only', 'everything']).error).toMatch(/--only/);
    expect(parseArgs(['--only']).error).toMatch(/--only/);
    expect(parseArgs(['--source']).error).toMatch(/--source/);
    expect(parseArgs(['--upload-now']).error).toMatch(/unknown argument/);
  });

  it('--only is dry-run only: --live refuses every scope at parse time, a dry run keeps it', () => {
    for (const only of ['models', 'props', 'env', 'manifest']) {
      const live = ['--from-mirror', '--manifest-name', 'manifest.v3.json', '--only', only, '--live', '--expect-plan', 'r1'];
      expect(parseArgs(live).error).toMatch(new RegExp(`--only is dry-run only.*--only ${only}`));
      expect(parseArgs(['--from-mirror', '--manifest-name', 'manifest.v3.json', '--only', only, '--plan-dir', 'r1']).options).toMatchObject({ only, live: false });
      expect(parseArgs(['--only', only, '--dry-run']).options).toMatchObject({ only, live: false });
    }
  });

  it('why: every --only set fails the live plan checks main() runs, while the full set passes them', () => {
    // main(): the manifest entry is renamed to --manifest-name before livePlanFails (D42: manifest.v3.json).
    const liveFails = (only) => {
      const set = fixtureSet({ only });
      set.entries = set.entries.map((e) => (e.kind === 'manifest' ? { ...e, logical: 'manifest.v3.json', path: 'manifest.v3.json' } : e));
      return livePlanFails(set, { manifestName: 'manifest.v3.json', readSource: (file) => Buffer.from(FIXTURE_FILES[file]) });
    };
    expect(liveFails(null)).toEqual([]);
    for (const only of ['models', 'props', 'env']) expect(liveFails(only)).toContain('the plan publishes no manifest (manifest.v3.json)');
    expect(liveFails('manifest').join('\n')).toMatch(/manifest\.v3\.json references models\/regular\/1\.[0-9a-f]{12}\.glb, which the plan does not publish/);
  });
});

describe('upload-supabase.mjs CLI (dry run only)', () => {
  let tmp;
  const run = (args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      timeout: 90_000,
      // No Supabase env at all: a dry run must not need (or read) it.
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
    });

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'publish-set-'));
    const source = join(tmp, 'source');
    for (const [file, body] of Object.entries(FIXTURE_FILES)) {
      mkdirSync(dirname(join(source, file)), { recursive: true });
      writeFileSync(join(source, file), body);
    }
    writeFileSync(join(source, 'manifest.json'), JSON.stringify(FIXTURE_MANIFEST));
    const empty = join(tmp, 'empty');
    mkdirSync(empty, { recursive: true });
    writeFileSync(join(empty, 'manifest.json'), JSON.stringify({ ...FIXTURE_MANIFEST, figures: [], props: [], environment: [] }));
  });

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('lists the hashed publish set, writes the plan and exits 0 without --live', () => {
    const planDir = join(tmp, 'plan');
    const r = run(['--source', join(tmp, 'source'), '--plan-dir', planDir]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/\(dry run\)/);
    expect(r.stdout).toMatch(/\[hashed\] models\/regular\/1\.[0-9a-f]{12}\.glb .*max-age=31536000 {2}<- models\/regular\/1\.glb/);
    expect(r.stdout).toMatch(/\[manifest\] manifest\.json .*max-age=0/);
    expect(r.stdout).toMatch(/dry run: nothing uploaded/);
    // TA-B1: the hint names the --expect-plan binding a bare --live is refused without.
    expect(r.stdout).toContain(`a real upload (R2) needs --live --expect-plan ${planDir} `);
    const plan = JSON.parse(readFileSync(join(planDir, 'publish-plan.json'), 'utf8'));
    expect(plan.entries.length).toBeGreaterThan(0);
    const published = JSON.parse(readFileSync(join(planDir, 'manifest.json'), 'utf8'));
    expect(published.figures[0].file).toMatch(HASHED_RE);
    // The source directory is untouched.
    expect(JSON.parse(readFileSync(join(tmp, 'source', 'manifest.json'), 'utf8'))).toEqual(FIXTURE_MANIFEST);
  });

  it('exits non-zero on an empty file list', () => {
    const r = run(['--source', join(tmp, 'empty'), '--plan-dir', join(tmp, 'plan-empty')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/0 files to publish/);
  });

  it('exits non-zero when the source has no manifest (the missing out/ case)', () => {
    const r = run(['--source', join(tmp, 'nowhere')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/nothing to publish/);
  });

  it('exits non-zero when a referenced file is missing', () => {
    const broken = join(tmp, 'broken');
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, 'manifest.json'), JSON.stringify(FIXTURE_MANIFEST));
    const r = run(['--source', broken, '--plan-dir', join(tmp, 'plan-broken')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/file\(s\) the manifest references are missing/);
  });

  it('exits 2 on --live --dry-run', () => {
    expect(run(['--live', '--dry-run']).status).toBe(2);
  });

  // The mirror's binaries are gitignored and its manifests are untracked: this runs where
  // both are present (the body reads the manifest the dry run publishes from).
  const mirrorHasBinaries = existsSync(join(MIRROR, 'models', 'regular', '1.glb'));
  const mirrorHasManifest = existsSync(join(MIRROR, sourceManifestFile(MIRROR, 'manifest.v3.json')));
  // The R1 dry run (ENGINE-ASSET-PLAN §7): since commit P the mirror's GLBs are meshopt, which TA-B1 refuses under manifest.json.
  it.skipIf(!mirrorHasBinaries || !mirrorHasManifest)('the R1 dry run --from-mirror --manifest-name manifest.v3.json lists > 0 hashed files, no manifest.json object, and every manifest file exists in the mirror', () => {
    const planDir = join(tmp, 'plan-mirror');
    const r = run(['--dry-run', '--from-mirror', '--manifest-name', 'manifest.v3.json', '--plan-dir', planDir]);
    expect(r.status, r.stderr).toBe(0);
    const plan = JSON.parse(readFileSync(join(planDir, 'publish-plan.json'), 'utf8'));
    const hashed = plan.entries.filter((e) => e.kind === 'hashed');
    expect(hashed.length).toBeGreaterThan(0);
    for (const e of hashed) expect(e.path).toMatch(HASHED_RE);
    expect(plan.entries.filter((e) => e.kind === 'manifest').map((e) => e.path)).toEqual(['manifest.v3.json']);
    expect(plan.entries.map((e) => e.path)).not.toContain('manifest.json');
    const source = JSON.parse(readFileSync(join(MIRROR, sourceManifestFile(MIRROR, 'manifest.v3.json')), 'utf8'));
    for (const { file } of manifestAssetFiles(source)) expect(existsSync(join(MIRROR, file)), file).toBe(true);
  }, 120_000);
});
