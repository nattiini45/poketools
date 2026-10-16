import { describe, expect, it } from 'vitest';
import { encodeGlb } from '../compress-mirror.mjs';
import {
  A0,
  a0Verdict,
  animationParity,
  formatParity,
  geometryParity,
  indexParity,
  rewriteGlbJson,
  stripImages,
  structure,
} from '../d42-parity.mjs';
import { createWorldIO, glbJson } from '../meshopt-codec.mjs';
import { figureDocument } from './d42-fixtures.mjs';

/**
 * D42 A0 (plan §5): the parity measures read zero on a lossless encode, see
 * the recipe's real loss, hold the accessor contract, and the verdict flags
 * any structural change.
 */

async function pair(recipe, options = { skinned: true, color: true }) {
  const io = await createWorldIO();
  const a = Buffer.from(await io.writeBinary(figureDocument(options)));
  const { bytes: b } = await encodeGlb(a, recipe);
  return { io, a, b, docA: await io.readBinary(new Uint8Array(a)), docB: await io.readBinary(new Uint8Array(b)) };
}

describe('A0 bars', () => {
  it('are the plan’s', () => {
    expect(A0).toMatchObject({ positionP999FracH: 2e-4, positionMaxPx: 1, closeUpPx: 844, normalP99Deg: 1, rotationDeg: 0.01, translationRel: 1e-3, colourLevels: 1 });
    expect(A0.uvMax).toBeCloseTo(1 / 65535, 12);
  });
});

describe('parity measures', () => {
  it('nq is lossless: zero geometry and animation error', async () => {
    const { docA, docB } = await pair('nq');
    const g = geometryParity(docA, docB);
    expect(g.positionFracH.max).toBe(0);
    expect(g.normalDeg.max).toBeLessThan(1e-4);
    expect(g.uvMax).toBe(0);
    expect(g.colourLevelsMax).toBe(0);
    const an = animationParity(docA, docB);
    expect(an.rotationDegMax).toBeLessThan(1e-4);
    expect(an.channels).toBe(1);
  });

  it('hq10 stays inside every A0 bar and its accessor contract', async () => {
    const { docA, docB, b } = await pair('hq10');
    const row = {
      structure: { a: structure(docA), b: structure(docB) },
      format: formatParity('hq10', docA, b),
      validator: { a: [], b: [] },
      geometry: geometryParity(docA, docB),
      animation: animationParity(docA, docB),
    };
    expect(row.format.mismatches).toEqual([]);
    expect(row.geometry.positionFracH.max).toBeGreaterThan(0);
    expect(a0Verdict(row)).toEqual([]);
  });

  it('nqx: index buffers exact, INDICES-mode contract held, clean verdict; nq fails both nqx checks', async () => {
    const x = await pair('nqx', { skinned: true, color: true, twoPrims: true });
    const row = {
      structure: { a: structure(x.docA), b: structure(x.docB) },
      format: formatParity('nqx', x.docA, x.b),
      validator: { a: [], b: [] },
      geometry: geometryParity(x.docA, x.docB),
      animation: animationParity(x.docA, x.docB),
      indices: { ...indexParity(x.docA, x.docB), required: true },
    };
    expect(row.indices).toEqual({ indexed: 2, exact: 2, required: true });
    expect(row.format.mismatches).toEqual([]);
    expect(a0Verdict(row)).toEqual([]);
    const nq = await pair('nq', { skinned: true, color: true, twoPrims: true });
    const rotated = indexParity(nq.docA, nq.docB);
    expect(rotated.indexed).toBe(2);
    expect(rotated.exact).toBeLessThan(2);
    expect(formatParity('nq', nq.docA, nq.b).mismatches).toEqual([]);
    expect(formatParity('nqx', nq.docA, nq.b).mismatches.filter((m) => m.semantic === 'indices')).toHaveLength(2);
    expect(a0Verdict({ ...row, indices: { ...rotated, required: true } })).toEqual([`indices ${rotated.exact}/2 exact`]);
    expect(a0Verdict({ ...row, indices: { ...rotated, required: false } })).toEqual([]);
  });

  it('high8 under the hq10 contract is a format mismatch', async () => {
    const { docA, b } = await pair('high8');
    expect(formatParity('hq10', docA, b).mismatches.length).toBeGreaterThan(0);
    expect(formatParity('high8', docA, b).mismatches).toEqual([]);
  });

  it('the verdict flags a structural change and a new validator code', () => {
    const s = structure(figureDocument());
    const row = {
      structure: { a: s, b: { ...s, skins: s.skins + 1 } },
      format: { mismatches: [] },
      validator: { a: ['SKIN_SKELETON_INVALID'], b: ['SKIN_SKELETON_INVALID', 'ACCESSOR_INVALID_FLOAT'] },
      geometry: { positionFracH: { p999: 0, max: 0 }, normalDeg: null, uvMax: null, colourLevelsMax: null },
      animation: { rotationDegMax: 0, translationRelMax: 0, scaleRelMax: 0, keyCountMismatch: 0, missingChannels: 0 },
    };
    const fails = a0Verdict(row);
    expect(fails.some((f) => f.startsWith('skins'))).toBe(true);
    expect(fails.some((f) => f.startsWith('validator ACCESSOR_INVALID_FLOAT'))).toBe(true);
  });
});

describe('GLB JSON helpers', () => {
  it('stripImages drops images and texture references, keeping the BIN chunk', async () => {
    const io = await createWorldIO();
    const bytes = Buffer.from(await io.writeBinary(figureDocument({ texture: true })));
    const json = glbJson(bytes);
    expect(json.images).toHaveLength(1);
    const stripped = stripImages(bytes);
    const after = glbJson(stripped);
    expect(after.images).toBeUndefined();
    expect(after.materials[0].pbrMetallicRoughness?.baseColorTexture).toBeUndefined();
    const doc = await io.readBinary(new Uint8Array(stripped));
    expect(doc.getRoot().listMeshes()).toHaveLength(1);
  });

  it('rewriteGlbJson round-trips', async () => {
    const io = await createWorldIO();
    const bytes = Buffer.from(await io.writeBinary(figureDocument()));
    const json = glbJson(bytes);
    json.asset.generator = 'd42-test';
    const out = rewriteGlbJson(bytes, json);
    expect(glbJson(out).asset.generator).toBe('d42-test');
    expect(out.readUInt32LE(8)).toBe(out.length);
    expect((await io.readBinary(new Uint8Array(out))).getRoot().listMeshes()).toHaveLength(1);
  });
});

describe('merge parity (the worktree consolidateFigureMeshes, bundled)', () => {
  it('merges what drawPartsFromDocument predicts, through three-stdlib + the meshopt decoder', async () => {
    const { loadThreeKit, threeParse, mergeCount } = await import('../d42-parity.mjs');
    const { drawPartsFromDocument } = await import('../bake-manifest.mjs');
    const kit = await loadThreeKit();
    for (const options of [{ twoPrims: true }, { twoPrims: true, blend: true }, { skinned: true, twoPrims: true }]) {
      const { b, docB } = await pair('hq10', options);
      const counts = mergeCount(kit, await threeParse(kit, b));
      expect(counts.after, JSON.stringify(options)).toBe(drawPartsFromDocument(docB));
    }
  }, 60000);
});
