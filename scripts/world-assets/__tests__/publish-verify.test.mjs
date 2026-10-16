/**
 * TOOLS-12 / TOOLS-13 (D42 ENGINE-ASSET-PLAN §4 SEAT TOOLS, §5 A2, §7 R1 / R2): publish-verify.mjs on fixture plans
 * (hash names, references, meshopt only under the published manifest, no manifest.json, the v2 collision case,
 * --expect-plan) and upload-supabase.mjs --manifest-name / --expect-plan (dry runs only: never the network).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOC_PATHS, comparePlans, glbJson, isMeshopt, parseArgs as verifyArgs, planDigest, referencedPaths, verifyPlan } from '../publish-verify.mjs';
import { HASH_LENGTH, contentHash, hashedPath } from '../publish-set.mjs';
import { livePlanFails, meshoptUnderLiveName, parseArgs, sourceManifestFile } from '../upload-supabase.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UPLOAD = resolve(here, '..', 'upload-supabase.mjs');
const VERIFY = resolve(here, '..', 'publish-verify.mjs');

/** A minimal GLB (JSON chunk only). */
function glb(json) {
  let j = Buffer.from(JSON.stringify(json));
  if (j.length % 4) j = Buffer.concat([j, Buffer.alloc(4 - (j.length % 4), 0x20)]);
  const h = Buffer.alloc(20);
  h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(20 + j.length, 8); h.writeUInt32LE(j.length, 12); h.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([h, j]);
}
const MESHOPT_GLB = glb({ asset: { version: '2.0' }, extensionsUsed: ['EXT_meshopt_compression'], extensionsRequired: ['EXT_meshopt_compression'] });
const PLAIN_GLB = glb({ asset: { version: '2.0' } });
const MANIFEST = {
  version: 3,
  figures: [{ dexId: 1, file: 'models/regular/1.glb', kb: 1 }],
  props: [{ id: 'p', file: 'props/p.glb' }],
  environment: [{ file: 'env/kit/k.glb' }, { file: 'env/hdri/h.jpg' }],
};
function source(dir, { envMeshopt = false } = {}) {
  const files = {
    'models/regular/1.glb': MESHOPT_GLB,
    'props/p.glb': PLAIN_GLB,
    'env/kit/k.glb': envMeshopt ? MESHOPT_GLB : PLAIN_GLB,
    'env/hdri/h.jpg': Buffer.from('jpeg'),
    'ATTRIBUTION.md': Buffer.from('# credits\n'),
    'manifest.json': Buffer.from(JSON.stringify(MANIFEST)),
  };
  for (const [f, b] of Object.entries(files)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), b); }
  return dir;
}
const node = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' } });

describe('publish-verify helpers', () => {
  it('reads a GLB JSON chunk and its meshopt declaration', () => {
    expect(glbJson(PLAIN_GLB)).toEqual({ asset: { version: '2.0' } });
    expect(isMeshopt(MESHOPT_GLB)).toBe(true);
    expect(isMeshopt(PLAIN_GLB)).toBe(false);
    expect(glbJson(Buffer.from('not a glb at all, not at all'))).toBeNull();
  });
  it('referencedPaths: figures, props, the files map and env logical names', () => {
    expect([...referencedPaths({ figures: [{ file: 'a.1.glb' }], props: [{ file: 'p.2.glb' }], files: { 'env/x.jpg': 'env/x.3.jpg' }, environment: [{ file: 'env/x.jpg' }] })].sort()).toEqual(['a.1.glb', 'env/x.3.jpg', 'env/x.jpg', 'p.2.glb']);
  });
  it('the v2 collision case: a non-hashed object at a path the v2 manifest references FAILs', () => {
    const plan = { entries: [
      { kind: 'doc', section: null, logical: 'ATTRIBUTION.md', path: 'props/p.glb', bytes: 3 },
      { kind: 'manifest', section: null, logical: 'manifest.v3.json', path: 'manifest.v3.json', bytes: 2 },
    ] };
    const r = verifyPlan({ plan, manifest: { figures: [], props: [], environment: [] }, manifestName: 'manifest.v3.json', readSource: () => Buffer.from('abc'), v2: { figures: [], props: [{ file: 'props/p.glb' }], environment: [] } });
    expect(r.fails.join('\n')).toMatch(/props\/p\.glb: would overwrite an object the v2 manifest references \(doc\)/);
  });
  it('TA-M7: an env compat copy must carry v2\'s bytes; labels are derived, not trusted', () => {
    const kit = PLAIN_GLB;
    const hashed = hashedPath('env/kit/k.glb', contentHash(kit, HASH_LENGTH));
    const entries = [
      { kind: 'hashed', section: 'environment', logical: 'env/kit/k.glb', path: hashed, bytes: kit.length },
      { kind: 'compat', section: 'environment', logical: 'env/kit/k.glb', path: 'env/kit/k.glb', bytes: kit.length },
      { kind: 'manifest', section: null, logical: 'manifest.v3.json', path: 'manifest.v3.json', bytes: 2 },
    ];
    const manifest = { figures: [], props: [], environment: [{ file: 'env/kit/k.glb' }], files: { 'env/kit/k.glb': hashed } };
    const run = (v2, plan = { entries }) => verifyPlan({ plan, manifest, manifestName: 'manifest.v3.json', readSource: () => kit, v2 }).fails;
    expect(run({ figures: [], environment: [{ file: 'env/kit/k.glb' }], files: { 'env/kit/k.glb': hashed } })).toEqual([]);
    expect(run({ figures: [], environment: [{ file: 'env/kit/k.glb' }], files: { 'env/kit/k.glb': 'env/kit/k.000000000000.glb' } }).join('\n')).toMatch(/env\/kit\/k\.glb: would overwrite the v2 env object with other bytes/);
    expect(run({ figures: [], environment: [{ file: 'env/kit/k.glb' }] }).join('\n')).toMatch(/v2 files\[env\/kit\/k\.glb\] = absent/);
    // a non-env file labelled environment (so it could ride as a compat copy), and a doc outside the allow-list
    const forged = { entries: [...entries, { kind: 'compat', section: 'environment', logical: 'props/x.glb', path: 'props/x.glb', bytes: kit.length }, { kind: 'doc', section: null, logical: 'props/y.glb', path: 'props/y.glb', bytes: kit.length }] };
    const f = run(null, forged).join('\n');
    expect(f).toMatch(/props\/x\.glb: labelled section environment, but manifest\.v3\.json's environment list does not name props\/x\.glb/);
    expect(f).toMatch(/props\/x\.glb: a compat object that is not an env file/);
    expect(f).toMatch(/props\/y\.glb: a doc object outside the doc allow-list \(ATTRIBUTION\.md\)/);
    expect(DOC_PATHS).toEqual(['ATTRIBUTION.md']);
  });
  it('TA-M7: publish-verify parseArgs: a new manifest name needs --v2-manifest or --no-v2-check', () => {
    expect(() => verifyArgs(['--plan-dir', 'p', '--manifest-name', 'manifest.v3.json'])).toThrow(/needs --v2-manifest/);
    expect(verifyArgs(['--plan-dir', 'p', '--manifest-name', 'manifest.v3.json', '--v2-manifest', 'v2.json'])).toMatchObject({ v2: 'v2.json', noV2: false });
    expect(verifyArgs(['--plan-dir', 'p', '--manifest-name', 'manifest.v3.json', '--no-v2-check'])).toMatchObject({ v2: null, noV2: true });
    expect(() => verifyArgs(['--plan-dir', 'p', '--v2-manifest', 'a', '--no-v2-check'])).toThrow(/mutually exclusive/);
    expect(verifyArgs(['--plan-dir', 'p'])).toMatchObject({ manifestName: 'manifest.json', v2: null });
  });
  it('planDigest / comparePlans by sha256', () => {
    const a = { entries: [{ kind: 'hashed', path: 'x.1.glb', logical: 'x.glb', sha256: 'aa', bytes: 1, cacheControl: '1', contentType: 'm' }] };
    expect(planDigest(a, Buffer.from('m')).missingSha).toBe(0);
    expect(comparePlans(a, Buffer.from('m'), JSON.parse(JSON.stringify(a)), Buffer.from('m'))).toEqual([]);
    expect(comparePlans(a, Buffer.from('m'), a, Buffer.from('n')).join()).toMatch(/manifest bytes differ/);
    const b = { entries: [{ ...a.entries[0], sha256: 'bb' }] };
    expect(comparePlans(a, Buffer.from('m'), b, Buffer.from('m')).join()).toMatch(/entry list differs/);
    expect(comparePlans(a, Buffer.from('m'), { entries: [{ ...a.entries[0], sha256: undefined }] }, Buffer.from('m')).join()).toMatch(/without sha256/);
  });
});

describe('upload-supabase.mjs --manifest-name / --expect-plan (TOOLS-13) and publish-verify.mjs (TOOLS-12)', () => {
  let tmp;
  beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'd42-publish-')); });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('argument rules: a manifest name, and --live with a new name needs --expect-plan', () => {
    expect(parseArgs(['--manifest-name', 'manifest.v3.json']).options).toMatchObject({ manifestName: 'manifest.v3.json', live: false });
    expect(parseArgs(['--manifest-name', 'evil/../x.json']).error).toMatch(/--manifest-name/);
    expect(parseArgs(['--manifest-name', 'manifest.v3.json', '--live']).error).toMatch(/needs --expect-plan/);
    expect(parseArgs(['--manifest-name', 'manifest.v3.json', '--live', '--expect-plan', 'r1']).options).toMatchObject({ live: true, expectPlan: 'r1' });
    expect(parseArgs(['--expect-plan']).error).toMatch(/--expect-plan/);
    // TA-B1: every --live run is bound to R1, the default manifest name included
    expect(parseArgs(['--from-mirror', '--live']).error).toMatch(/--live needs --expect-plan .*manifest\.json is never written/);
    expect(parseArgs(['--live', '--expect-plan', 'r1']).options).toMatchObject({ live: true, manifestName: 'manifest.json' });
  });

  it('TA-B1 helpers: meshoptUnderLiveName and livePlanFails (verifyPlan over the recomputed set)', () => {
    const read = (f) => ({ 'a.glb': MESHOPT_GLB, 'b.glb': PLAIN_GLB, 'c.jpg': Buffer.from('x') })[f];
    expect(meshoptUnderLiveName([{ kind: 'hashed', logical: 'a.glb' }, { kind: 'hashed', logical: 'b.glb' }, { kind: 'hashed', logical: 'c.jpg' }, { kind: 'manifest', logical: 'manifest.json' }], read)).toEqual(['a.glb']);
    const set = { entries: [{ kind: 'manifest', section: null, logical: 'manifest.json', path: 'manifest.json', bytes: 2 }], manifestBytes: Buffer.from('{}') };
    expect(livePlanFails(set, { manifestName: 'manifest.json', readSource: read }).join('\n')).toMatch(/an object named manifest\.json would be written/);
    expect(livePlanFails({ entries: [], manifestBytes: Buffer.from('nope') }, { manifestName: 'manifest.v3.json', readSource: read })).toEqual(['the published manifest bytes are not JSON']);
  });

  it('TA-B1: a --live run under manifest.json is REFUSED before any network call even when it equals its R1 plan', () => {
    const src = join(tmp, 'src-plain');
    source(src);
    writeFileSync(join(src, 'models/regular/1.glb'), PLAIN_GLB); // no meshopt: the manifest.json dry run is allowed
    const r1 = join(tmp, 'r1-plain');
    expect(node(UPLOAD, ['--source', src, '--plan-dir', r1]).status).toBe(0);
    const live = node(UPLOAD, ['--source', src, '--live', '--expect-plan', r1]);
    expect(live.status).toBe(1);
    expect(live.stdout).toMatch(/--expect-plan: the publish set equals R1's plan/);
    expect(live.stderr).toMatch(/REFUSED: the publish set fails publish-verify .*\n.*an object named manifest\.json would be written/);
    expect(live.stderr).not.toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('R1: a dry run under manifest.v3.json writes no manifest.json and passes publish-verify', () => {
    const src = source(join(tmp, 'src'));
    const plan = join(tmp, 'r1');
    const r = node(UPLOAD, ['--source', src, '--plan-dir', plan, '--manifest-name', 'manifest.v3.json']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/\[manifest\] manifest\.v3\.json .*max-age=0/);
    const p = JSON.parse(readFileSync(join(plan, 'publish-plan.json'), 'utf8'));
    expect(p.manifestName).toBe('manifest.v3.json');
    expect(p.entries.every((e) => /^[0-9a-f]{64}$/.test(e.sha256))).toBe(true);
    expect(p.entries.some((e) => e.path === 'manifest.json')).toBe(false);
    const v2 = join(tmp, 'v2-manifest.json');
    const v3 = JSON.parse(readFileSync(join(plan, 'manifest.v3.json'), 'utf8'));
    writeFileSync(v2, JSON.stringify({ version: 2, figures: [{ file: 'models/regular/1.aaaaaaaaaaaa.glb' }], props: [], environment: v3.environment, files: v3.files }));
    // TA-M7: a new manifest name needs the published v2 manifest (or the explicit, R1-invalid --no-v2-check)
    expect(node(VERIFY, ['--plan-dir', plan, '--manifest-name', 'manifest.v3.json']).status).toBe(2);
    const nov2 = node(VERIFY, ['--plan-dir', plan, '--manifest-name', 'manifest.v3.json', '--no-v2-check']);
    expect(nov2.stdout).toMatch(/v2 check: NOT RUN .*not valid for R1/);
    expect(nov2.stdout).toMatch(/PUBLISH-VERIFY PASS \(WITHOUT the v2 check\)/);
    const v = node(VERIFY, ['--plan-dir', plan, '--manifest-name', 'manifest.v3.json', '--v2-manifest', v2]);
    expect(v.stdout).toMatch(/1 meshopt/);
    expect(v.stdout).toMatch(/compat objects \(2\): env\/kit\/k\.glb, env\/hdri\/h\.jpg/);
    expect(v.stdout).toMatch(/doc objects \(1\): ATTRIBUTION\.md/);
    expect(v.stdout, v.stdout).toMatch(/PUBLISH-VERIFY PASS/);
    expect(v.status).toBe(0);
  });

  it('a plan that writes manifest.json, a meshopt env object, a wrong hash name and an unresolved reference FAIL', () => {
    const src = source(join(tmp, 'src-env'), { envMeshopt: true });
    const plan = join(tmp, 'p-env');
    // TA-B1: upload-supabase itself refuses a manifest.json set with a meshopt GLB (dry run included, no plan);
    // the plan under manifest.json is forged from the manifest.v3.json one so publish-verify's own check is exercised
    const refused = node(UPLOAD, ['--source', src, '--plan-dir', plan]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/REFUSED: 2 EXT_meshopt_compression GLB\(s\) under the manifest name manifest\.json/);
    expect(existsSync(join(plan, 'publish-plan.json'))).toBe(false);
    expect(node(UPLOAD, ['--source', src, '--plan-dir', plan, '--manifest-name', 'manifest.v3.json']).status).toBe(0);
    const forged = JSON.parse(readFileSync(join(plan, 'publish-plan.json'), 'utf8'));
    for (const e of forged.entries) if (e.kind === 'manifest') { e.path = 'manifest.json'; e.logical = 'manifest.json'; }
    writeFileSync(join(plan, 'publish-plan.json'), JSON.stringify(forged));
    writeFileSync(join(plan, 'manifest.json'), readFileSync(join(plan, 'manifest.v3.json')));
    const v = node(VERIFY, ['--plan-dir', plan]);
    expect(v.stdout).toMatch(/an object named manifest\.json would be written/);
    expect(v.stdout).toMatch(/env\/kit\/k\.[0-9a-f]{12}\.glb: an env object carries EXT_meshopt_compression/);
    expect(v.stdout).toMatch(/env\/kit\/k\.glb: a meshopt object under a logical name/);
    expect(v.status).toBe(1);
    // tamper: a hashed name that is not its bytes' hash, and a dropped object the manifest references
    const pj = JSON.parse(readFileSync(join(plan, 'publish-plan.json'), 'utf8'));
    const fig = pj.entries.find((e) => e.logical === 'models/regular/1.glb');
    fig.path = 'models/regular/1.000000000000.glb';
    pj.entries = pj.entries.filter((e) => e.logical !== 'props/p.glb');
    writeFileSync(join(plan, 'publish-plan.json'), JSON.stringify(pj));
    const t = node(VERIFY, ['--plan-dir', plan]);
    expect(t.stdout).toMatch(/models\/regular\/1\.000000000000\.glb: not the sha256\[:12\] name of its bytes/);
    expect(t.stdout).toMatch(/manifest\.json references models\/regular\/1\.[0-9a-f]{12}\.glb, which the plan does not publish/);
    expect(t.stdout).toMatch(/references props\/p\.[0-9a-f]{12}\.glb, which the plan does not publish/);
  });

  it('R2 --expect-plan: equal set PASS (dry run); a changed source REFUSED; publish-verify --expect-plan agrees', () => {
    const src = join(tmp, 'src');
    const r1 = join(tmp, 'r1');
    const same = node(UPLOAD, ['--source', src, '--plan-dir', join(tmp, 'r2'), '--manifest-name', 'manifest.v3.json', '--expect-plan', r1]);
    expect(same.status, same.stderr).toBe(0);
    expect(same.stdout).toMatch(/--expect-plan: the publish set equals R1's plan/);
    expect(node(VERIFY, ['--plan-dir', join(tmp, 'r2'), '--manifest-name', 'manifest.v3.json', '--expect-plan', r1, '--v2-manifest', join(tmp, 'v2-manifest.json')]).status).toBe(0);
    // the same size, other bytes: only a sha256 comparison sees it
    writeFileSync(join(src, 'env/hdri/h.jpg'), Buffer.from('JPEG'));
    const changed = node(UPLOAD, ['--source', src, '--plan-dir', join(tmp, 'r3'), '--manifest-name', 'manifest.v3.json', '--expect-plan', r1]);
    expect(changed.status).toBe(1);
    expect(changed.stderr).toMatch(/REFUSED: the recomputed publish set differs from R1's plan/);
    const v = node(VERIFY, ['--plan-dir', join(tmp, 'r3'), '--manifest-name', 'manifest.v3.json', '--expect-plan', r1, '--no-v2-check']);
    expect(v.status).toBe(2); // r3 was never written (refused before the plan)
    // a live run without --expect-plan is a usage error (exit 2), never a network call
    expect(node(UPLOAD, ['--source', src, '--manifest-name', 'manifest.v3.json', '--live']).status).toBe(2);
  });

  it('D42 commit P: the promoted mirror publishes its manifest.v3.json (the shipped one), never the tracked v2 manifest.json', () => {
    const src = source(join(tmp, 'src-promoted'));
    // the promoted mirror: the tracked v2 manifest.json (other metadata) beside the shipped manifest.v3.json
    const v3 = { ...MANIFEST, figures: [{ ...MANIFEST.figures[0], kb: 2, castKb: 1 }], d42: { metrics: 'frozen' } };
    writeFileSync(join(src, 'manifest.v3.json'), JSON.stringify(v3));
    expect(sourceManifestFile(src, 'manifest.v3.json')).toBe('manifest.v3.json');
    expect(sourceManifestFile(src, 'manifest.json')).toBe('manifest.json');
    // an arm mirror holds only manifest.json: that is the source under any published name
    expect(sourceManifestFile(source(join(tmp, 'src-arm')), 'manifest.v3.json')).toBe('manifest.json');
    const plan = join(tmp, 'r1-promoted');
    const r = node(UPLOAD, ['--source', src, '--plan-dir', plan, '--manifest-name', 'manifest.v3.json']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/\(source manifest manifest\.v3\.json\)/);
    const p = JSON.parse(readFileSync(join(plan, 'publish-plan.json'), 'utf8'));
    expect(p.sourceManifest).toBe('manifest.v3.json');
    expect(p.skipped).toEqual([]);
    expect(p.entries.some((e) => e.path === 'manifest.json' || e.logical === 'manifest.json')).toBe(false);
    expect(p.entries.filter((e) => e.kind === 'manifest').map((e) => e.path)).toEqual(['manifest.v3.json']);
    const published = JSON.parse(readFileSync(join(plan, 'manifest.v3.json'), 'utf8'));
    expect(published.d42).toEqual({ metrics: 'frozen' });
    expect(published.figures[0]).toMatchObject({ kb: 2, castKb: 1 });
    expect(existsSync(join(plan, 'manifest.json'))).toBe(false);
  });
});
