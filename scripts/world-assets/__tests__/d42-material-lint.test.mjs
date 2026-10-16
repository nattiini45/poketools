import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Document } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { applyFixes, classifyGlb, glbBin, isTranslucentShell, lintMirror, lintViolations, minImageAlpha, SHELL_RULE } from '../material-lint.mjs';
import { rewriteGlbJson } from '../d42-parity.mjs';
import { encodeGlb } from '../compress-mirror.mjs';
import { createWorldIO, glbJson } from '../meshopt-codec.mjs';
import { figureDocument, sphereArrays, tinyPng } from './d42-fixtures.mjs';

/**
 * D42 material arm lint (plan §4 ASSET step 6; D46). The accidental metals
 * are exactly the materials whose JSON OMITS metallicFactor and that have no
 * metallicRoughnessTexture; authored metals keep theirs. Fixes patch only the
 * JSON chunk (BIN byte-identical) and are idempotent.
 */

const tmp = mkdtempSync(join(tmpdir(), 'd42-lint-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A GLB whose materials are patched at the JSON level (what an exporter wrote). */
async function glbWith(patch, options = {}) {
  const io = await createWorldIO();
  const bytes = Buffer.from(await io.writeBinary(figureDocument({ twoPrims: true, ...options })));
  const json = glbJson(bytes);
  patch(json);
  return rewriteGlbJson(bytes, json);
}

describe('classifyGlb', () => {
  it('omitted metallicFactor without an MR texture is an accidental metal; authored or textured metals are genuine', async () => {
    const bytes = await glbWith((json) => {
      json.materials[0].pbrMetallicRoughness = { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 } }; // omitted → 1.0
      json.materials.push({ name: 'chrome', pbrMetallicRoughness: { metallicFactor: 1 } });
      json.materials.push({ name: 'textured', pbrMetallicRoughness: { metallicRoughnessTexture: { index: 0 } } });
      json.materials.push({ name: 'matte', pbrMetallicRoughness: { metallicFactor: 0 } });
    }, { texture: true });
    const rows = await classifyGlb(bytes);
    expect(rows.map((r) => [r.name, r.accidentalMetal, r.genuineMetal])).toEqual([
      ['body', true, false],
      ['chrome', false, true],
      ['textured', false, true],
      ['matte', false, false],
    ]);
  });

  it('a BLEND material with nothing translucent is opaque-by-mistake; a translucent factor, texel or vertex alpha is not', async () => {
    const opaque = await classifyGlb(await glbWith((json) => Object.assign(json.materials[0], { alphaMode: 'BLEND' })));
    expect(opaque[0]).toMatchObject({ blend: true, opaqueBlend: true, blendDoubleSided: true });
    expect(lintViolations(opaque)).toHaveLength(1);
    const factor = await classifyGlb(
      await glbWith((json) => Object.assign(json.materials[0], { alphaMode: 'BLEND', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.5] } })),
    );
    expect(factor[0].opaqueBlend).toBe(false);
    expect(lintViolations(factor)).toEqual([]);
  });

  it('reads texel alpha from the embedded image', async () => {
    expect(await minImageAlpha(tinyPng())).toBe(255);
    expect(await minImageAlpha(tinyPng({ alpha: 128 }))).toBe(128);
    const io = await createWorldIO();
    const doc = figureDocument({ texture: true, blend: true });
    doc.getRoot().listTextures()[0].setImage(tinyPng({ alpha: 128 }));
    const rows = await classifyGlb(Buffer.from(await io.writeBinary(doc)));
    expect(rows[0]).toMatchObject({ blend: true, textureAlpha: 128, opaqueBlend: false });
  });

  it('flags transmission and unlit', async () => {
    const rows = await classifyGlb(
      await glbWith((json) => {
        json.materials[0].extensions = { KHR_materials_transmission: { transmissionFactor: 1 }, KHR_materials_unlit: {} };
        json.extensionsUsed = [...(json.extensionsUsed ?? []), 'KHR_materials_transmission', 'KHR_materials_unlit'];
      }),
    );
    expect(rows[0]).toMatchObject({ transmission: true, unlit: true });
    expect(lintViolations(rows).some((v) => v.includes('transmission'))).toBe(true);
  });
});

describe('applyFixes (JSON-only, idempotent)', () => {
  it('sets metallicFactor 0 on accidental metals only, keeps the BIN chunk, and a second pass changes nothing', async () => {
    const bytes = await glbWith((json) => {
      json.materials[0].pbrMetallicRoughness = {};
      json.materials.push({ name: 'chrome', pbrMetallicRoughness: { metallicFactor: 1 } });
    });
    const rows = await classifyGlb(bytes);
    const { bytes: fixed, changes } = applyFixes(bytes, rows, ['metal']);
    expect(changes).toEqual([{ index: 0, fix: 'metal', from: 'omitted (1.0)', to: 0 }]);
    const json = glbJson(fixed);
    expect(json.materials[0].pbrMetallicRoughness.metallicFactor).toBe(0);
    expect(json.materials[1].pbrMetallicRoughness.metallicFactor).toBe(1);
    expect(Buffer.compare(glbBin(fixed), glbBin(bytes))).toBe(0);
    const again = applyFixes(fixed, await classifyGlb(fixed), ['metal']);
    expect(again.changes).toEqual([]);
    expect(Buffer.compare(again.bytes, fixed)).toBe(0);
  });

  it('turns opaque-by-mistake BLEND to OPAQUE and strips transmission (extensionsUsed too)', async () => {
    const bytes = await glbWith((json) => {
      Object.assign(json.materials[0], { alphaMode: 'BLEND', extensions: { KHR_materials_transmission: { transmissionFactor: 1 } } });
      json.extensionsUsed = [...(json.extensionsUsed ?? []), 'KHR_materials_transmission'];
    });
    const { bytes: fixed, changes } = applyFixes(bytes, await classifyGlb(bytes), ['blend-opaque', 'transmission']);
    expect(changes.map((c) => c.fix).sort()).toEqual(['blend-opaque', 'transmission']);
    const json = glbJson(fixed);
    expect(json.materials[0].alphaMode).toBeUndefined();
    expect(json.materials[0].extensions).toBeUndefined();
    expect(json.extensionsUsed ?? []).not.toContain('KHR_materials_transmission');
    expect(lintViolations(await classifyGlb(fixed))).toEqual([]);
  });
});

describe('lintMirror', () => {
  it('dry run reports; --apply writes only the changed files to --out', async () => {
    const src = join(tmp, 'mirror');
    mkdirSync(join(src, 'models', 'regular'), { recursive: true });
    writeFileSync(join(src, 'models', 'regular', '1.glb'), await glbWith((json) => (json.materials[0].pbrMetallicRoughness = {})));
    writeFileSync(join(src, 'models', 'regular', '2.glb'), await glbWith((json) => (json.materials[0].pbrMetallicRoughness = { metallicFactor: 0 })));
    const dry = await lintMirror({ src });
    expect(dry.summary.accidentalMetals).toEqual(['models/regular/1.glb#0 body']);
    const out = join(tmp, 'out');
    const applied = await lintMirror({ src, apply: true, fixes: ['metal'], out });
    expect(applied.files.find((f) => f.file === 'models/regular/1.glb').changes).toHaveLength(1);
    expect(glbJson(readFileSync(join(out, 'models', 'regular', '1.glb'))).materials[0].pbrMetallicRoughness.metallicFactor).toBe(0);
    expect(() => readFileSync(join(out, 'models', 'regular', '2.glb'))).toThrow();
    await expect(lintMirror({ src, apply: true, fixes: ['metal'], out: src })).rejects.toThrow(/--out/);
  });
});

/**
 * One-material document: a closed UV sphere, wound outward (the fixture's
 * `sphereArrays` winds inward; `inward: true` keeps that), or an open quad card.
 */
function partDocument({ shape = 'sphere', inward = false, alpha = 0.5, doubleSided = true, blend = true, texture = null, unlit = false, color = null } = {}) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('scene');
  doc.getRoot().setDefaultScene(scene);
  let a;
  if (shape === 'sphere') {
    a = sphereArrays(8, 12);
    if (!inward) for (let i = 0; i < a.indices.length; i += 3) [a.indices[i + 1], a.indices[i + 2]] = [a.indices[i + 2], a.indices[i + 1]];
  } else {
    a = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    };
  }
  const material = doc.createMaterial('part').setBaseColorFactor([1, 1, 1, alpha]).setDoubleSided(doubleSided);
  if (blend) material.setAlphaMode('BLEND');
  if (texture) material.setBaseColorTexture(doc.createTexture('base').setImage(texture).setMimeType('image/png'));
  if (unlit) material.setExtension('KHR_materials_unlit', doc.createExtension(KHRMaterialsUnlit).createUnlit());
  const prim = doc.createPrimitive().setMaterial(material);
  prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(a.positions).setBuffer(buffer));
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(a.normals).setBuffer(buffer));
  prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(a.uvs).setBuffer(buffer));
  if (color !== null) {
    const n = a.positions.length / 3;
    const rgba = new Uint8Array(n * 4).fill(255);
    if (color !== 'white') rgba[0] = 128;
    prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(rgba).setNormalized(true).setBuffer(buffer));
  }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(a.indices).setBuffer(buffer));
  scene.addChild(doc.createNode('part').setMesh(doc.createMesh('part').addPrimitive(prim)));
  return doc;
}

async function bytesOf(doc) {
  const io = await createWorldIO();
  return Buffer.from(await io.writeBinary(doc));
}

describe('genuine translucent shells (the doubleSided call, SHELL_RULE)', () => {
  it('a closed outward sphere with a uniform alpha is a shell; inward, open or cut-out parts are not', async () => {
    const [shell] = await classifyGlb(await bytesOf(partDocument()));
    expect(shell).toMatchObject({ blendDoubleSided: true, translucentShell: true });
    expect(shell.shell.geometry.outwardShare).toBe(1);
    expect(shell.shell.alpha).toMatchObject({ p5: 127.5, p95: 127.5, invisible: false });

    const [inward] = await classifyGlb(await bytesOf(partDocument({ inward: true })));
    expect(inward.translucentShell).toBe(false);
    expect(inward.shell.geometry.outwardShare).toBe(0);

    const [card] = await classifyGlb(await bytesOf(partDocument({ shape: 'quad' })));
    expect(card.translucentShell).toBe(false);
    expect(card.shell.geometry.largest[0]).toMatchObject({ triangles: 2, boundary: 4 });

    // An opaque texture with one translucent texel: opaque regions (p95 255) make a cut-out, not a layer.
    const [cutout] = await classifyGlb(await bytesOf(partDocument({ alpha: 1, texture: tinyPng({ alpha: 128 }) })));
    expect(cutout).toMatchObject({ opaqueBlend: false, translucentShell: false });
    expect(cutout.shell.alpha.p95).toBe(255);
  });

  it('an invisible part (alpha 0 everywhere) is a shell; single-sided parts and OPAQUE parts are not measured', async () => {
    const [invisible] = await classifyGlb(await bytesOf(partDocument({ alpha: 0 })));
    expect(invisible.shell.alpha.invisible).toBe(true);
    expect(invisible.translucentShell).toBe(true);
    const [single] = await classifyGlb(await bytesOf(partDocument({ doubleSided: false })));
    expect(single).toMatchObject({ blendDoubleSided: false, translucentShell: false });
    expect(single.shell).toBeUndefined();
    const [opaque] = await classifyGlb(await bytesOf(partDocument({ blend: false })));
    expect(opaque.shell).toBeUndefined();
  });

  it('the rule reads the layer spread and the outward share against its thresholds', () => {
    const shell = (p5, p95, outwardShare, normalAgree = 1, invisible = false) => ({ alpha: { p5, p95, invisible }, geometry: { outwardShare, normalAgree } });
    expect(isTranslucentShell(shell(100, 100 + SHELL_RULE.alphaSpreadMax, 1))).toBe(true);
    expect(isTranslucentShell(shell(100, 101 + SHELL_RULE.alphaSpreadMax, 1))).toBe(false);
    expect(isTranslucentShell(shell(240, SHELL_RULE.alphaP95Max, 1))).toBe(false);
    expect(isTranslucentShell(shell(64, 64, SHELL_RULE.outwardShareMin - 0.001))).toBe(false);
    expect(isTranslucentShell(shell(64, 64, 1, SHELL_RULE.normalAgreeMin - 0.001))).toBe(false);
    expect(isTranslucentShell(shell(0, 0, 1, 1, true))).toBe(true);
  });

  it('single-sided clears doubleSided on shells only, keeps the BIN chunk, and is idempotent', async () => {
    const bytes = await bytesOf(partDocument());
    const { bytes: fixed, changes } = applyFixes(bytes, await classifyGlb(bytes), ['single-sided']);
    expect(changes).toEqual([{ index: 0, fix: 'single-sided', from: true, to: false }]);
    expect(glbJson(fixed).materials[0].doubleSided).toBeUndefined();
    expect(Buffer.compare(glbBin(fixed), glbBin(bytes))).toBe(0);
    expect(applyFixes(fixed, await classifyGlb(fixed), ['single-sided']).changes).toEqual([]);
    const card = await bytesOf(partDocument({ shape: 'quad' }));
    expect(applyFixes(card, await classifyGlb(card), ['single-sided']).changes).toEqual([]);
  });
});

describe('unlit-color (R50 item 4: an all-white COLOR_0 on an unlit primitive)', () => {
  it('classifies none / white / colored', async () => {
    expect((await classifyGlb(await bytesOf(partDocument({ blend: false, unlit: true }))))[0]).toMatchObject({ unlit: true, unlitColor: 'none', whiteColorPrims: [] });
    expect((await classifyGlb(await bytesOf(partDocument({ blend: false, unlit: true, color: 'white' }))))[0]).toMatchObject({ unlitColor: 'white', whiteColorPrims: ['0/0'] });
    expect((await classifyGlb(await bytesOf(partDocument({ blend: false, unlit: true, color: 'tinted' }))))[0]).toMatchObject({ unlitColor: 'colored', whiteColorPrims: [] });
    expect((await classifyGlb(await bytesOf(partDocument({ blend: false, color: 'white' }))))[0].unlitColor).toBeUndefined();
  });

  it('drops the white COLOR_0 from the primitive (JSON only, idempotent); a coloured or lit export is untouched', async () => {
    const bytes = await bytesOf(partDocument({ blend: false, unlit: true, color: 'white' }));
    const before = glbJson(bytes);
    const { bytes: fixed, changes } = applyFixes(bytes, await classifyGlb(bytes), ['unlit-color']);
    expect(changes).toEqual([{ index: 0, fix: 'unlit-color', from: 'COLOR_0 (all 1.0)', to: null, prims: ['0/0'] }]);
    const after = glbJson(fixed);
    expect(after.meshes[0].primitives[0].attributes.COLOR_0).toBeUndefined();
    expect(after.accessors).toEqual(before.accessors);
    expect(Buffer.compare(glbBin(fixed), glbBin(bytes))).toBe(0);
    expect((await classifyGlb(fixed))[0].unlitColor).toBe('none');
    expect(applyFixes(fixed, await classifyGlb(fixed), ['unlit-color']).changes).toEqual([]);
    for (const other of [partDocument({ blend: false, unlit: true, color: 'tinted' }), partDocument({ blend: false, color: 'white' })]) {
      const b = await bytesOf(other);
      expect(applyFixes(b, await classifyGlb(b), ['unlit-color']).changes).toEqual([]);
    }
  });
});

describe('the arm on a meshopt encode (d42m = d42 + JSON-only fixes)', () => {
  it('fixes a meshopt (nq) GLB with its BIN chunk byte-identical', async () => {
    const source = await bytesOf(partDocument({ unlit: true, color: 'white' }));
    const { bytes: encoded } = await encodeGlb(source, 'nq');
    expect(glbJson(encoded).extensionsUsed).toContain('EXT_meshopt_compression');
    const rows = await classifyGlb(encoded);
    expect(rows[0]).toMatchObject({ translucentShell: true, unlitColor: 'white' });
    const { bytes: fixed, changes } = applyFixes(encoded, rows, ['single-sided', 'unlit-color', 'metal']);
    expect(changes.map((c) => c.fix).sort()).toEqual(['metal', 'single-sided', 'unlit-color']);
    expect(Buffer.compare(glbBin(fixed), glbBin(encoded))).toBe(0);
    const io = await createWorldIO();
    const doc = await io.readBinary(new Uint8Array(fixed));
    expect(doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('COLOR_0')).toBeNull();
  });

  it('--except leaves a judged-out material alone (every fix)', async () => {
    const bytes = await glbWith((json) => (json.materials[0].pbrMetallicRoughness = {}));
    const rows = await classifyGlb(bytes);
    expect(applyFixes(bytes, rows, ['metal'], { except: new Set([0]) }).changes).toEqual([]);
  });

  it('--mirror copies the whole arm, writes the fixed GLBs over it and records every GLB in _encode.json', async () => {
    const src = join(tmp, 'arm-src');
    const out = join(tmp, 'arm-out');
    mkdirSync(join(src, 'models', 'regular'), { recursive: true });
    mkdirSync(join(src, 'env', 'hdri'), { recursive: true });
    const metal = await glbWith((json) => (json.materials[0].pbrMetallicRoughness = {}));
    const clean = await glbWith((json) => (json.materials[0].pbrMetallicRoughness = { metallicFactor: 0 }));
    writeFileSync(join(src, 'models', 'regular', '1.glb'), metal);
    writeFileSync(join(src, 'models', 'regular', '2.glb'), clean);
    writeFileSync(join(src, 'models', 'regular', '3.glb'), metal);
    writeFileSync(join(src, 'env', 'hdri', 'sky.hdr'), 'env');
    writeFileSync(join(src, 'manifest.json'), '{"figures":[]}');
    writeFileSync(join(src, '_encode.json'), JSON.stringify({ stamp: { recipe: 'nq', codec: 'v0' }, files: [{ file: 'models/regular/1.glb', recipe: 'nq' }] }));
    const result = await lintMirror({ src, apply: true, mirror: true, fixes: ['metal'], out, except: ['models/regular/3.glb#0'] });
    expect(result.summary.encode).toEqual({ changedFiles: 1, byFix: { metal: { materials: 1, files: 1 } } });
    for (const rel of ['models/regular/2.glb', 'models/regular/3.glb', 'env/hdri/sky.hdr', 'manifest.json']) {
      expect(Buffer.compare(readFileSync(join(out, rel)), readFileSync(join(src, rel)))).toBe(0);
    }
    expect(glbJson(readFileSync(join(out, 'models', 'regular', '1.glb'))).materials[0].pbrMetallicRoughness.metallicFactor).toBe(0);
    const encode = JSON.parse(readFileSync(join(out, '_encode.json'), 'utf8'));
    expect(encode).toMatchObject({ tool: 'material-lint', fixes: ['metal'], except: ['models/regular/3.glb#0'], stamp: { recipe: 'nq', codec: 'v0', materialFixes: ['metal'] } });
    expect(encode.source.recipe).toBe('nq');
    expect(encode.files.map((row) => [row.file, row.recipe, row.changes.length, row.sha256 === row.srcSha256])).toEqual([
      ['models/regular/1.glb', 'nq', 1, false],
      ['models/regular/2.glb', 'nq', 0, true],
      ['models/regular/3.glb', 'nq', 0, true],
    ]);
    expect(encode.doubleSided).toEqual({ flipped: [], insideFiles: [], measured: [] });
    expect(encode.exceptReasons).toBeUndefined();
    // --except-reasons: one reason per entry, recorded; a typo or a missing reason is refused before anything is written
    const reasoned = join(tmp, 'arm-out-reasons');
    await lintMirror({ src, apply: true, mirror: true, fixes: ['metal'], out: reasoned, except: ['models/regular/3.glb#0'], exceptReasons: { 'models/regular/3.glb#0': 'judged out' } });
    const withReasons = JSON.parse(readFileSync(join(reasoned, '_encode.json'), 'utf8'));
    expect(withReasons).toMatchObject({ except: ['models/regular/3.glb#0'], exceptReasons: { 'models/regular/3.glb#0': 'judged out' } });
    expect(withReasons.files).toEqual(encode.files);
    const refused = join(tmp, 'arm-out-refused');
    await expect(lintMirror({ src, apply: true, mirror: true, fixes: ['metal'], out: refused, except: ['models/regular/3.glb#1'] })).rejects.toThrow(/names no material/);
    await expect(lintMirror({ src, apply: true, mirror: true, fixes: ['metal'], out: refused, except: ['models/regular/9.glb#0'] })).rejects.toThrow(/names no material/);
    await expect(
      lintMirror({ src, apply: true, mirror: true, fixes: ['metal'], out: refused, except: ['models/regular/3.glb#0'], exceptReasons: { 'models/regular/1.glb#0': 'x' } }),
    ).rejects.toThrow(/one non-empty reason per --except entry/);
    await expect(
      lintMirror({ src, apply: true, mirror: true, fixes: ['metal'], out: refused, except: ['models/regular/3.glb#0'], exceptReasons: { 'models/regular/3.glb#0': ' ' } }),
    ).rejects.toThrow(/one non-empty reason/);
    expect(existsSync(refused)).toBe(false);
    // idempotent: a second build writes the same bytes
    const first = readFileSync(join(out, 'models', 'regular', '1.glb'));
    await lintMirror({ src, apply: true, mirror: true, fixes: ['metal'], out, except: ['models/regular/3.glb#0'] });
    expect(Buffer.compare(readFileSync(join(out, 'models', 'regular', '1.glb')), first)).toBe(0);
    await expect(lintMirror({ src, apply: true, mirror: true, fixes: ['metal'], out: join(src, 'arm') })).rejects.toThrow(/outside --src/);
    expect(existsSync(join(src, 'arm'))).toBe(false);
    await expect(lintMirror({ src, mirror: true, fixes: ['metal'], out })).rejects.toThrow(/--apply/);
  });

  it('--mirror records the doubleSided call: flips, the inside-view files and every measured material', async () => {
    const src = join(tmp, 'ds-src');
    const out = join(tmp, 'ds-out');
    mkdirSync(join(src, 'models', 'regular'), { recursive: true });
    writeFileSync(join(src, 'models', 'regular', '577.glb'), await bytesOf(partDocument()));
    writeFileSync(join(src, 'models', 'regular', '725.glb'), await bytesOf(partDocument({ shape: 'quad' })));
    writeFileSync(join(src, 'manifest.json'), '{}');
    await lintMirror({ src, apply: true, mirror: true, fixes: ['single-sided'], out });
    const { doubleSided } = JSON.parse(readFileSync(join(out, '_encode.json'), 'utf8'));
    expect(doubleSided.flipped).toEqual(['models/regular/577.glb#0']);
    expect(doubleSided.insideFiles).toEqual(['models/regular/577.glb']);
    expect(doubleSided.measured.map((m) => [m.material, m.translucentShell, m.outwardShare])).toEqual([
      ['models/regular/577.glb#0', true, 1],
      ['models/regular/725.glb#0', false, 0],
    ]);
  });
});
