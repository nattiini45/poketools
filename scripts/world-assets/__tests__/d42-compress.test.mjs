import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accessor } from '@gltf-transform/core';
import { afterAll, describe, expect, it } from 'vitest';
import {
  RECIPES,
  compressMirror,
  describeSourceAccessor,
  encodeGlb,
  expectedAnimationFilter,
  expectedAttributeFormat,
  indexExact,
  indexModeOf,
  sha256,
} from '../compress-mirror.mjs';
import { createWorldIO, glbAccessorFormats, glbJson, glbUsesMeshopt } from '../meshopt-codec.mjs';
import { figureDocument } from './d42-fixtures.mjs';

/**
 * D42 SEAT ASSET step 2: the hand-composed meshopt recipes. Every encode is
 * asserted against the recipe table by the accessor formats a loader sees
 * (componentType, normalized, filter), never by option names; the scene
 * volume keeps one skin; the encode is deterministic and refuses a meshopt
 * source; env/ is copied byte for byte.
 */

const CT = Accessor.ComponentType;
const tmp = mkdtempSync(join(tmpdir(), 'd42-compress-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function glb(document) {
  const io = await createWorldIO();
  return Buffer.from(await io.writeBinary(document));
}

async function sourceFormats(bytes) {
  const io = await createWorldIO();
  const document = await io.readBinary(new Uint8Array(bytes));
  const out = new Map();
  document
    .getRoot()
    .listMeshes()
    .forEach((mesh, m) =>
      mesh.listPrimitives().forEach((prim, p) => {
        for (const semantic of prim.listSemantics()) out.set(`${m}/${p}/${semantic}`, describeSourceAccessor(prim.getAttribute(semantic)));
      }),
    );
  return out;
}

describe('recipes (plan §4 ASSET step 2)', () => {
  it('are the four candidates with the planned bits and methods, plus the index-exact nqx', () => {
    expect(Object.keys(RECIPES)).toEqual(['hq10', 'high8', 'medium', 'nq', 'nqx']);
    expect(RECIPES.hq10).toMatchObject({ bits: { position: 16, normal: 10, texcoord: 16, weight: 16, color: 16 }, method: 'quantize', reorder: true });
    expect(RECIPES.high8).toMatchObject({ bits: { position: 14, normal: 8, texcoord: 12, weight: 8, color: 8 }, method: 'filter' });
    expect(RECIPES.medium.bits).toEqual({ position: 16, normal: 16, texcoord: 16, weight: 16, color: 16 });
    expect(RECIPES.nq).toMatchObject({ bits: null, method: 'quantize', reorder: false });
    expect(RECIPES.nqx).toEqual({ ...RECIPES.nq, indexMode: 'indices' });
    expect(['hq10', 'high8', 'medium', 'nq'].map(indexModeOf)).toEqual(['triangles', 'triangles', 'triangles', 'triangles']);
    expect(indexModeOf('nqx')).toBe('indices');
    expect(Object.keys(RECIPES).filter(indexExact)).toEqual(['nqx']);
    expect(() => indexModeOf('nqz')).toThrow(/unknown recipe/);
  });

  it('animation filters only under FILTER', () => {
    expect(expectedAnimationFilter('hq10', 'rotation')).toBe('NONE');
    expect(expectedAnimationFilter('high8', 'rotation')).toBe('QUATERNION');
    expect(expectedAnimationFilter('high8', 'translation')).toBe('EXPONENTIAL');
  });

  it('never widens a coarser source (10-bit recipe keeps an 8-bit normal)', () => {
    expect(expectedAttributeFormat('hq10', 'NORMAL', { componentType: CT.BYTE, normalized: true })).toEqual({
      componentType: CT.BYTE,
      normalized: true,
      filter: 'NONE',
    });
    expect(expectedAttributeFormat('hq10', 'TEXCOORD_0', { componentType: CT.FLOAT, normalized: false, unitRange: false })).toEqual({
      componentType: CT.FLOAT,
      normalized: false,
      filter: 'NONE',
    });
  });

  for (const recipe of Object.keys(RECIPES)) {
    it(`${recipe}: every accessor matches the recipe table`, async () => {
      const src = await glb(figureDocument({ skinned: true, color: true }));
      const { bytes } = await encodeGlb(src, recipe);
      expect(glbUsesMeshopt(bytes)).toBe(true);
      const before = await sourceFormats(src);
      const after = glbAccessorFormats(bytes);
      for (const row of after) {
        if (row.semantic === 'indices') continue;
        if (row.semantic.startsWith('output:')) {
          expect(row.filter, `${recipe} ${row.semantic}`).toBe(expectedAnimationFilter(recipe, row.semantic.slice(7)));
          continue;
        }
        const want = expectedAttributeFormat(recipe, row.semantic, before.get(`${row.mesh}/${row.prim}/${row.semantic}`));
        expect({ componentType: row.componentType, normalized: row.normalized, filter: row.filter }, `${recipe} ${row.semantic}`).toEqual(want);
      }
    });
  }

  it('hq10 stores 16-bit positions, 10-bit normals in SHORT, 16-bit UVs/weights/colours', async () => {
    const { bytes } = await encodeGlb(await glb(figureDocument({ skinned: true, color: true })), 'hq10');
    const by = Object.fromEntries(glbAccessorFormats(bytes).filter((r) => r.mesh === 0).map((r) => [r.semantic, r]));
    expect(by.POSITION).toMatchObject({ componentType: CT.SHORT, normalized: true, filter: 'NONE' });
    expect(by.NORMAL).toMatchObject({ componentType: CT.SHORT, normalized: true, filter: 'NONE' });
    expect(by.TEXCOORD_0).toMatchObject({ componentType: CT.UNSIGNED_SHORT, normalized: true });
    expect(by.WEIGHTS_0).toMatchObject({ componentType: CT.UNSIGNED_SHORT, normalized: true });
    expect(by.COLOR_0).toMatchObject({ componentType: CT.UNSIGNED_SHORT, normalized: true });
    expect(by.JOINTS_0).toMatchObject({ componentType: CT.UNSIGNED_BYTE, normalized: false });
  });
});

describe('encode invariants', () => {
  it('is deterministic (idempotent re-run)', async () => {
    const src = await glb(figureDocument({ skinned: true, color: true }));
    for (const recipe of ['hq10', 'nqx']) {
      const a = await encodeGlb(src, recipe);
      const b = await encodeGlb(src, recipe);
      expect(sha256(a.bytes), recipe).toBe(sha256(b.bytes));
    }
  });

  it('refuses a meshopt-compressed source', async () => {
    const { bytes } = await encodeGlb(await glb(figureDocument()), 'hq10');
    await expect(encodeGlb(bytes, 'hq10')).rejects.toThrow(/refusing a meshopt-compressed source/);
  });

  it('keeps exactly one skin at scene volume', async () => {
    for (const recipe of ['hq10', 'high8', 'medium']) {
      const { bytes } = await encodeGlb(await glb(figureDocument({ skinned: true, twoPrims: true })), recipe);
      const io = await createWorldIO();
      const document = await io.readBinary(new Uint8Array(bytes));
      expect(document.getRoot().listSkins(), recipe).toHaveLength(1);
      expect(document.getRoot().listNodes().length, recipe).toBe(4);
    }
  });

  it('--no-reorder-blend keeps a BLEND primitive’s triangle order', async () => {
    const src = await glb(figureDocument({ blend: true, twoPrims: true, rings: 24, segments: 32 }));
    const io = await createWorldIO();
    // Triangle centroids in draw order (world space): the meshopt index codec
    // may rotate a triangle's corners, which keeps winding and draw order.
    const order = async (bytes) => {
      const doc = await io.readBinary(new Uint8Array(bytes));
      const node = doc.getRoot().listNodes().find((n) => n.getMesh());
      const m = node.getWorldMatrix();
      const prim = node.getMesh().listPrimitives()[1];
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      const out = [];
      const el = [];
      for (let t = 0; t < idx.getCount(); t += 3) {
        const c = [0, 0, 0];
        for (let k = 0; k < 3; k += 1) {
          const [x, y, z] = pos.getElement(idx.getScalar(t + k), el);
          c[0] += (m[0] * x + m[4] * y + m[8] * z + m[12]) / 3;
          c[1] += (m[1] * x + m[5] * y + m[9] * z + m[13]) / 3;
          c[2] += (m[2] * x + m[6] * y + m[10] * z + m[14]) / 3;
        }
        out.push(c);
      }
      return out;
    };
    const same = (a, b) => a.length === b.length && a.every((c, i) => Math.hypot(c[0] - b[i][0], c[1] - b[i][1], c[2] - b[i][2]) < 1e-3);
    const kept = await encodeGlb(src, 'hq10', { noReorderBlend: true });
    const reordered = await encodeGlb(src, 'hq10');
    expect(kept.reorder).toBe(false);
    expect(reordered.reorder).toBe(true);
    const base = await order(src);
    expect(same(await order(kept.bytes), base)).toBe(true);
    expect(same(await order(reordered.bytes), base)).toBe(false);
  });
});

// ── nqx: the index-exact lossless B (ASSET-11) ──────────────────────────────

/** A two-primitive skinned figure; `narrow` stores its indices as UNSIGNED_SHORT (most of mirror A). */
async function figureGlb({ narrow = false } = {}) {
  const document = figureDocument({ skinned: true, color: true, twoPrims: true, rings: 24, segments: 32 });
  if (narrow) {
    for (const prim of document.getRoot().listMeshes()[0].listPrimitives()) prim.getIndices().setArray(new Uint16Array(prim.getIndices().getArray()));
  }
  return glb(document);
}

const arrayBytes = (accessor) => {
  const array = accessor.getArray();
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
};

/** Every accessor a primitive, skin or clip references, by role: { componentType, normalized, count, sha256 } (gltf-transform + meshopt decoder). */
async function decodedByRole(bytes) {
  const io = await createWorldIO();
  const root = (await io.readBinary(new Uint8Array(bytes))).getRoot();
  const out = {};
  const put = (key, accessor) => {
    out[key] = { componentType: accessor.getComponentType(), normalized: accessor.getNormalized(), count: accessor.getCount(), sha256: sha256(arrayBytes(accessor)) };
  };
  root.listMeshes().forEach((mesh, m) =>
    mesh.listPrimitives().forEach((prim, p) => {
      for (const semantic of prim.listSemantics()) put(`${m}/${p}/${semantic}`, prim.getAttribute(semantic));
      if (prim.getIndices()) put(`${m}/${p}/indices`, prim.getIndices());
    }),
  );
  root.listSkins().forEach((skin, s) => put(`skin${s}/ibm`, skin.getInverseBindMatrices()));
  root.listAnimations().forEach((anim, a) =>
    anim.listSamplers().forEach((sampler, s) => {
      put(`anim${a}/${s}/input`, sampler.getInput());
      put(`anim${a}/${s}/output`, sampler.getOutput());
    }),
  );
  return out;
}

/** Each primitive's index bytes decoded from the raw GLB by three's meshopt_decoder.module.js (the decoder figure-loader hands GLTFLoader). */
async function threeIndexBytes(bytes) {
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
  await MeshoptDecoder.ready;
  const json = glbJson(bytes);
  const jsonLength = bytes.readUInt32LE(12);
  const bin = bytes.subarray(20 + jsonLength + 8, 20 + jsonLength + 8 + bytes.readUInt32LE(20 + jsonLength));
  const width = { 5121: 1, 5123: 2, 5125: 4 };
  const out = {};
  json.meshes.forEach((mesh, m) =>
    mesh.primitives.forEach((prim, p) => {
      const accessor = json.accessors[prim.indices];
      const ext = json.bufferViews[accessor.bufferView].extensions.EXT_meshopt_compression;
      const view = new Uint8Array(ext.count * ext.byteStride);
      MeshoptDecoder.decodeGltfBuffer(view, ext.count, ext.byteStride, bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength), ext.mode, ext.filter ?? 'NONE');
      const start = accessor.byteOffset ?? 0;
      out[`${m}/${p}/indices`] = sha256(Buffer.from(view.subarray(start, start + accessor.count * width[accessor.componentType])));
    }),
  );
  return out;
}

const indexRoles = (byRole) => Object.fromEntries(Object.entries(byRole).filter(([key]) => key.endsWith('/indices')));

describe('nqx: index-exact lossless (ASSET-11)', () => {
  for (const narrow of [false, true]) {
    it(`every index view is INDICES mode and decodes to the source's index bytes through both decoders (${narrow ? 'UNSIGNED_SHORT' : 'UNSIGNED_INT'})`, async () => {
      const src = await figureGlb({ narrow });
      const { bytes, indexMode } = await encodeGlb(src, 'nqx');
      expect(indexMode).toBe('indices');
      const modes = glbJson(bytes)
        .bufferViews.map((view) => view.extensions?.EXT_meshopt_compression?.mode)
        .filter(Boolean);
      expect(modes).toContain('INDICES');
      expect(modes).not.toContain('TRIANGLES');
      const want = Object.fromEntries(Object.entries(indexRoles(await decodedByRole(src))).map(([key, row]) => [key, row.sha256]));
      expect(Object.keys(want)).toHaveLength(2);
      const viaGltfTransform = indexRoles(await decodedByRole(bytes));
      expect(Object.fromEntries(Object.entries(viaGltfTransform).map(([key, row]) => [key, row.sha256]))).toEqual(want);
      expect(await threeIndexBytes(bytes)).toEqual(want);
      expect(Object.values(viaGltfTransform).map((row) => row.componentType)).toEqual(narrow ? [CT.UNSIGNED_SHORT, CT.UNSIGNED_SHORT] : [CT.UNSIGNED_INT, CT.UNSIGNED_INT]);
    });
  }

  it('nq on the same source keeps the triangles but rotates corners (the bytes nqx restores)', async () => {
    const src = await figureGlb({ narrow: true });
    const { bytes, indexMode } = await encodeGlb(src, 'nq');
    expect(indexMode).toBe('triangles');
    expect(glbAccessorFormats(bytes).filter((row) => row.semantic === 'indices').map((row) => row.mode)).toEqual(['TRIANGLES', 'TRIANGLES']);
    const io = await createWorldIO();
    const prims = async (b) => (await io.readBinary(new Uint8Array(b))).getRoot().listMeshes()[0].listPrimitives().map((prim) => Array.from(prim.getIndices().getArray()));
    const a = await prims(src);
    const b = await prims(bytes);
    const canonical = (tri) => [0, 1, 2].map((r) => [tri[r], tri[(r + 1) % 3], tri[(r + 2) % 3]].join(',')).sort()[0];
    const triangles = (list) => Array.from({ length: list.length / 3 }, (_, t) => canonical(list.slice(t * 3, t * 3 + 3)));
    a.forEach((list, i) => expect(triangles(b[i])).toEqual(triangles(list)));
    expect(a.some((list, i) => list.some((v, k) => v !== b[i][k]))).toBe(true);
  });

  it('keeps every attribute, the skin and the clip bit-identical (formats and bytes)', async () => {
    const src = await figureGlb();
    const { bytes } = await encodeGlb(src, 'nqx');
    const want = await decodedByRole(src);
    expect(Object.keys(want).filter((key) => /\/(POSITION|NORMAL|TEXCOORD_0|COLOR_0|JOINTS_0|WEIGHTS_0)$/.test(key))).toHaveLength(12);
    expect(Object.keys(want)).toEqual(expect.arrayContaining(['skin0/ibm', 'anim0/0/input', 'anim0/0/output']));
    expect(await decodedByRole(bytes)).toEqual(want);
  });

  it('the stamp and every row record the index mode; a per-file recipe carries its own', async () => {
    const src = join(tmp, 'mirror-x');
    mkdirSync(join(src, 'models', 'regular'), { recursive: true });
    mkdirSync(join(src, 'props'), { recursive: true });
    mkdirSync(join(src, 'env'), { recursive: true });
    writeFileSync(join(src, 'models', 'regular', '1.glb'), await figureGlb({ narrow: true }));
    writeFileSync(join(src, 'props', 'lamp.glb'), await glb(figureDocument()));
    writeFileSync(join(src, 'env', 'a.hdr'), 'hdr-bytes');
    writeFileSync(join(src, 'manifest.json'), '{"version":3,"figures":[]}');
    writeFileSync(join(src, 'ATTRIBUTION.md'), '# attribution');
    const exact = await compressMirror({ src, out: join(tmp, 'out-nqx'), recipe: 'nqx', jobs: 1 });
    expect(exact.stamp).toMatchObject({ recipe: 'nqx', indexMode: 'indices', recipeSpec: { indexMode: 'indices', reorder: false, bits: null } });
    expect(exact.files.map((row) => [row.file, row.recipe, row.indexMode])).toEqual([
      ['models/regular/1.glb', 'nqx', 'indices'],
      ['props/lamp.glb', 'nqx', 'indices'],
    ]);
    const mixed = await compressMirror({ src, out: join(tmp, 'out-nq'), recipe: 'nq', recipeFor: { 'props/lamp.glb': 'nqx' }, jobs: 1 });
    expect(mixed.stamp.indexMode).toBe('triangles');
    expect(mixed.files.map((row) => [row.file, row.indexMode])).toEqual([
      ['models/regular/1.glb', 'triangles'],
      ['props/lamp.glb', 'indices'],
    ]);
    // the per-file nqx output is the whole-mirror nqx output, byte for byte
    expect(mixed.files[1].sha256).toBe(exact.files[1].sha256);
    const again = await compressMirror({ src, out: join(tmp, 'out-nqx'), recipe: 'nqx', jobs: 1 });
    expect(again.files).toEqual(exact.files);
  });
});

describe('compressMirror', () => {
  it('encodes models and props, copies env byte-identical, and skips unchanged files on a re-run', async () => {
    const src = join(tmp, 'mirror');
    const out = join(tmp, 'out');
    mkdirSync(join(src, 'models', 'regular'), { recursive: true });
    mkdirSync(join(src, 'props'), { recursive: true });
    mkdirSync(join(src, 'env', 'kit'), { recursive: true });
    writeFileSync(join(src, 'models', 'regular', '1.glb'), await glb(figureDocument({ skinned: true })));
    writeFileSync(join(src, 'props', 'lamp.glb'), await glb(figureDocument()));
    const kit = await glb(figureDocument());
    writeFileSync(join(src, 'env', 'kit', 'bay.glb'), kit);
    writeFileSync(join(src, 'env', 'a.hdr'), 'hdr-bytes');
    writeFileSync(join(src, 'manifest.json'), '{"version":3,"figures":[]}');
    writeFileSync(join(src, 'ATTRIBUTION.md'), '# attribution');
    const first = await compressMirror({ src, out, recipe: 'hq10', jobs: 1 });
    expect(first.files.map((row) => row.file)).toEqual(['models/regular/1.glb', 'props/lamp.glb']);
    expect(glbUsesMeshopt(readFileSync(join(out, 'models', 'regular', '1.glb')))).toBe(true);
    expect(sha256(readFileSync(join(out, 'env', 'kit', 'bay.glb')))).toBe(sha256(kit));
    expect(readFileSync(join(out, 'env', 'a.hdr'), 'utf8')).toBe('hdr-bytes');
    expect(first.stamp).toMatchObject({ meshoptimizer: '1.2.0', codec: 'v0', recipe: 'hq10', quantizationVolume: 'scene' });
    const second = await compressMirror({ src, out, recipe: 'hq10', jobs: 1 });
    expect(second.files.map((row) => row.sha256)).toEqual(first.files.map((row) => row.sha256));
  });

  it('--recipe-for gives one file its own recipe, recorded on its row', async () => {
    const src = join(tmp, 'mirror');
    const out = join(tmp, 'out-for');
    const report = await compressMirror({ src, out, recipe: 'hq10', recipeFor: { 'props/lamp.glb': 'nq' }, jobs: 1 });
    const byFile = Object.fromEntries(report.files.map((row) => [row.file, row]));
    expect(byFile['props/lamp.glb'].recipe).toBe('nq');
    expect(byFile['models/regular/1.glb'].recipe).toBe('hq10');
    const position = glbAccessorFormats(readFileSync(join(out, 'props', 'lamp.glb'))).find((r) => r.semantic === 'POSITION');
    expect(position.componentType).toBe(CT.FLOAT);
  });

  it('refuses to encode in place', async () => {
    await expect(compressMirror({ src: tmp, out: tmp, recipe: 'hq10' })).rejects.toThrow(/differ/);
  });
});
