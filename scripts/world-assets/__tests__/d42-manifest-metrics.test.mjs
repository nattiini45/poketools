import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { armManifest, drawPartsFromDocument, encodeNote, fileMetrics, gpuBytes, materialsNote, promotedAttributeBytes } from '../bake-manifest.mjs';
import { figureDocument } from './d42-fixtures.mjs';

/**
 * D42 SEAT ASSET step 5: the arm manifests' additive metrics. `gpuKb` follows
 * the loader's Float32 promotion (vertex-formats.ts), `drawParts` the
 * consolidateFigureMeshes merge families, and `--metrics frozen` vs `flip`
 * differ ONLY in castKb and triangles of the decimated files.
 */

function accessor(doc, type, array, normalized = false) {
  return doc.createAccessor().setType(type).setArray(array).setNormalized(normalized).setBuffer(doc.getRoot().listBuffers()[0] ?? doc.createBuffer());
}

describe('promotedAttributeBytes / gpuBytes (vertex-formats.ts rules)', () => {
  it('promotes 3-component normalized and non-normalized integers to Float32 only', () => {
    const doc = new Document();
    doc.createBuffer();
    expect(promotedAttributeBytes(accessor(doc, 'VEC3', new Int16Array(30), true))).toBe(10 * 3 * 4);
    expect(promotedAttributeBytes(accessor(doc, 'VEC2', new Uint16Array(20), true))).toBe(10 * 2 * 2);
    expect(promotedAttributeBytes(accessor(doc, 'VEC4', new Uint8Array(40), false))).toBe(10 * 4 * 4);
    expect(promotedAttributeBytes(accessor(doc, 'VEC4', new Uint16Array(40), true))).toBe(10 * 4 * 2);
    expect(promotedAttributeBytes(accessor(doc, 'VEC3', new Float32Array(30)))).toBe(10 * 3 * 4);
  });

  it('counts a shared accessor once and adds the indices', () => {
    const doc = figureDocument({ twoPrims: true, uv: false, normal: false, rings: 2, segments: 3 });
    const prims = doc.getRoot().listMeshes()[0].listPrimitives();
    prims[1].setAttribute('POSITION', prims[0].getAttribute('POSITION'));
    const vertices = prims[0].getAttribute('POSITION').getCount();
    const indices = prims[0].getIndices().getCount() + prims[1].getIndices().getCount();
    expect(gpuBytes(doc)).toBe(vertices * 12 + indices * 4);
  });
});

describe('drawPartsFromDocument (consolidateFigureMeshes families)', () => {
  it('merges two primitives of one mesh sharing material and layout', () => {
    expect(drawPartsFromDocument(figureDocument({ twoPrims: true }))).toBe(1);
  });

  it('keeps different materials apart', () => {
    expect(drawPartsFromDocument(figureDocument({ twoPrims: true, blend: true }))).toBe(2);
  });

  it('keeps a vertex-colour variant apart (the loader clones the material)', () => {
    const doc = figureDocument({ twoPrims: true });
    const prim = doc.getRoot().listMeshes()[0].listPrimitives()[1];
    const n = prim.getAttribute('POSITION').getCount();
    prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(n * 4)).setBuffer(doc.getRoot().listBuffers()[0]));
    expect(drawPartsFromDocument(doc)).toBe(2);
  });

  it('merges skinned primitives over one skin', () => {
    expect(drawPartsFromDocument(figureDocument({ skinned: true, twoPrims: true }))).toBe(1);
  });

  it('keeps single-primitive meshes at different node transforms apart', () => {
    const doc = figureDocument();
    const scene = doc.getRoot().listScenes()[0];
    const mesh = doc.getRoot().listMeshes()[0];
    scene.addChild(doc.createNode('copy').setMesh(mesh).setTranslation([3, 0, 0]));
    expect(drawPartsFromDocument(doc)).toBe(2);
    scene.addChild(doc.createNode('twin').setMesh(mesh).setTranslation([3, 0, 0]));
    expect(drawPartsFromDocument(doc)).toBe(2);
  });

  it('fileMetrics reports kb from the byte length', () => {
    const doc = figureDocument();
    expect(fileMetrics(doc, 10 * 1024).kb).toBe(10);
  });
});

describe('armManifest --metrics frozen | flip', () => {
  const base = {
    version: 3,
    generatedAt: 'x',
    figures: [
      { file: 'models/regular/907.glb', kb: 7171, triangles: 240268, bounds: { min: [0, 0, 0], max: [1, 2, 1] }, clips: [] },
      { file: 'models/regular/1.glb', kb: 363, triangles: 4338, bounds: { min: [0, 0, 0], max: [1, 1, 1] }, clips: ['idle'] },
    ],
    props: [{ name: 'lamp', file: 'props/lamp.glb', kb: 900, triangles: 20000, bounds: { min: [0, 0, 0], max: [1, 4, 1] } }],
    environment: [{ file: 'env/hdri/gold.jpg', kb: 50 }],
    pool: { keep: true },
  };
  const measured = {
    'models/regular/907.glb': { kb: 180, gpuKb: 1100, drawParts: 1, triangles: 36000 },
    'models/regular/1.glb': { kb: 170, gpuKb: 300, drawParts: 3, triangles: 4338 },
    'props/lamp.glb': { kb: 400, gpuKb: 700, drawParts: 2, triangles: 20000 },
  };
  const measure = (rel, opts) => (opts?.env ? { kb: 50 } : measured[rel]);
  const castKb = { 'models/regular/907.glb': 874 };
  const overlayBounds = () => ({ min: [0.0004, 0, 0], max: [1, 1.9996, 1] });
  const frozen = armManifest(base, { mode: 'frozen', measure, castKb, overlayBounds });
  const flip = armManifest(base, { mode: 'flip', measure, castKb, overlayBounds });

  it('kb is truthful, castKb is A’s kb under frozen, gpuKb and drawParts are added', () => {
    expect(frozen.figures[0]).toMatchObject({ kb: 180, castKb: 7171, triangles: 240268, gpuKb: 1100, drawParts: 1 });
    expect(frozen.figures[1]).toMatchObject({ kb: 170, castKb: 363, triangles: 4338, gpuKb: 300, drawParts: 3, clips: ['idle'] });
    expect(frozen.props[0]).toMatchObject({ kb: 400, castKb: 900 });
    expect(frozen.pool).toEqual({ keep: true });
  });

  it('flip writes only castKb and triangles, and only for the decimated files', () => {
    const diffs = [];
    for (const section of ['figures', 'props']) {
      frozen[section].forEach((entry, i) => {
        for (const key of new Set([...Object.keys(entry), ...Object.keys(flip[section][i])])) {
          if (JSON.stringify(entry[key]) !== JSON.stringify(flip[section][i][key])) diffs.push(`${entry.file}:${key}`);
        }
      });
    }
    expect(diffs.sort()).toEqual(['models/regular/907.glb:castKb', 'models/regular/907.glb:triangles']);
    expect(flip.figures[0]).toMatchObject({ castKb: 874, triangles: 36000 });
  });

  it('the decimated file takes the recomputed bounds in both modes; others keep A’s', () => {
    expect(frozen.figures[0].bounds).toEqual({ min: [0, 0, 0], max: [1, 2, 1] });
    expect(flip.figures[0].bounds).toEqual(frozen.figures[0].bounds);
    expect(frozen.figures[1].bounds).toBe(base.figures[1].bounds);
  });

  it('--cast-freeze (Q2 = no) pins a decimated file to A’s castKb under flip', () => {
    const pinned = armManifest(base, { mode: 'flip', measure, castKb, castFreeze: ['models/regular/907.glb'], overlayBounds });
    expect(pinned.figures[0]).toMatchObject({ castKb: 7171, triangles: 36000 });
  });

  it('refuses an unknown mode', () => {
    expect(() => armManifest(base, { mode: 'both', measure })).toThrow(/frozen or flip/);
  });

  it('--materials (the material arm) adds only the d42.materials note', () => {
    const encode = {
      tool: 'material-lint',
      source: { dir: 'C:/x/public/models/world/d42' },
      fixes: ['metal', 'single-sided'],
      totals: { changedFiles: 2 },
      byFix: { metal: { materials: 3, files: 2 }, 'single-sided': { materials: 1, files: 1 } },
      files: [],
    };
    const note = materialsNote(encode, 'd42m');
    expect(note).toEqual({ arm: 'd42m', from: 'd42', tool: 'material-lint', fixes: ['metal', 'single-sided'], files: 2, byFix: encode.byFix });
    const noted = armManifest(base, { mode: 'frozen', measure, castKb, overlayBounds, materials: note });
    expect(noted.d42).toEqual({ ...frozen.d42, materials: note });
    expect({ ...noted, d42: frozen.d42 }).toEqual(frozen);
    expect(frozen.d42.materials).toBeUndefined();
    expect(() => materialsNote({ stamp: {} }, 'd42m')).toThrow(/material-lint/);
  });

  it('the encode note records the recipe and index mode from the arm’s stamp, and nothing else changes', () => {
    const nqx = encodeNote({ stamp: { recipe: 'nqx', recipeSpec: { bits: null, indexMode: 'indices' }, indexMode: 'indices' } });
    expect(nqx).toEqual({ recipe: 'nqx', indexMode: 'indices' });
    // a pre-ASSET-11 stamp (no indexMode) wrote TRIANGLES index views
    expect(encodeNote({ stamp: { recipe: 'nq', recipeSpec: { bits: null } } })).toEqual({ recipe: 'nq', indexMode: 'triangles' });
    // a material-lint arm carries its source arm's stamp
    expect(encodeNote({ tool: 'material-lint', stamp: { recipe: 'nqx', indexMode: 'indices', materialFixes: ['metal'] } })).toEqual(nqx);
    expect(encodeNote({ stamp: {} })).toBeNull();
    expect(encodeNote(null)).toBeNull();
    const noted = armManifest(base, { mode: 'frozen', measure, castKb: {}, encode: nqx });
    const plain = armManifest(base, { mode: 'frozen', measure, castKb: {} });
    expect(noted.d42).toEqual({ metrics: 'frozen', decimated: [], castFreeze: [], encode: nqx });
    expect({ ...noted, d42: plain.d42 }).toEqual(plain);
    expect(plain.d42.encode).toBeUndefined();
  });
});
