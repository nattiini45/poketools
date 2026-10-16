import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unweld } from '@gltf-transform/functions';
import {
  CLOSE_UP_PX,
  NORMAL_WEIGHT_LADDER,
  OUTLIERS,
  TARGET_LADDER,
  TARGET_TRIANGLES,
  acePixelsPerMetre,
  attributeSignature,
  colourTransferError,
  countTriangles,
  decimateDocument,
  decimateFigures,
  degenerateTriangles,
  mergeReports,
  reportName,
  symmetricHausdorff,
  targetLadderFrom,
  textureHashes,
  triangleSoup,
} from '../decimate-figures.mjs';
import { MeshoptSimplifier, createWorldIO } from '../meshopt-codec.mjs';
import { figureDocument } from './d42-fixtures.mjs';

/**
 * D42 SEAT ASSET step 3 / A1: the outlier decimation keeps every primitive's
 * attribute set and storage (so its bytes are the A-encoding castKb), never
 * touches a texture, never adds a NORMAL, refuses skinned or animated files,
 * and the A1 measures read 0 on identical geometry.
 */

async function roundTrip(document) {
  const io = await createWorldIO();
  return io.readBinary(await io.writeBinary(document));
}

describe('the outlier list (D18: file paths, never species)', () => {
  it('is the 13 static outliers with their templates', () => {
    expect(OUTLIERS).toHaveLength(13);
    for (const o of OUTLIERS) expect(o.file).toMatch(/^models\/(regular|hisuian)\/\d+\.glb$/);
    expect(OUTLIERS.map((o) => o.file)).not.toContain('models/regular/858.glb');
    const byFile = Object.fromEntries(OUTLIERS.map((o) => [o.file, o.template]));
    expect(byFile['models/regular/907.glb']).toBe('permissive-color');
    expect(byFile['models/regular/913.glb']).toBe('permissive-color');
    expect(byFile['models/regular/328.glb']).toBe('permissive-normal');
    expect(byFile['models/regular/930.glb']).toBe('seam-lock');
    expect(byFile['models/regular/110.glb']).toBe('seam-lock');
  });

  it('escalates the target to 40 k at most (plan §5 A1)', () => {
    expect(TARGET_LADDER[0]).toBe(36000);
    expect(Math.max(...TARGET_LADDER)).toBe(40000);
    expect(NORMAL_WEIGHT_LADDER[0]).toBe(0.5);
  });
});

describe('decimateDocument', () => {
  it('reaches the per-primitive target and keeps attribute set, storage and textures', async () => {
    const document = await roundTrip(figureDocument({ texture: true, twoPrims: true, rings: 40, segments: 60 }));
    const before = countTriangles(document);
    const sig = attributeSignature(document);
    const tex = textureHashes(document);
    const target = Math.round(before * 0.4);
    const result = await decimateDocument(document, { target, template: 'seam-lock' });
    expect(result.trianglesAfter).toBeLessThanOrEqual(target);
    expect(result.trianglesAfter).toBeGreaterThan(target * 0.9);
    expect(result.primitives).toHaveLength(2);
    expect(attributeSignature(document)).toEqual(sig);
    expect(textureHashes(document)).toEqual(tex);
  });

  it('never adds a NORMAL to a file without one (930 is unlit)', async () => {
    const document = await roundTrip(figureDocument({ normal: false, rings: 30, segments: 40 }));
    await decimateDocument(document, { target: 800, template: 'seam-lock' });
    const prim = document.getRoot().listMeshes()[0].listPrimitives()[0];
    expect(prim.getAttribute('NORMAL')).toBeNull();
    expect(prim.getAttribute('TEXCOORD_0')).not.toBeNull();
  });

  it('weights COLOR_0 under the permissive-color template', async () => {
    const document = await roundTrip(figureDocument({ color: true, uv: false, rings: 30, segments: 40 }));
    const result = await decimateDocument(document, { target: 900, template: 'permissive-color', weights: { normal: 0.5, texcoord: 1, color: 4 } });
    expect(result.primitives[0].flags).toEqual(['Permissive']);
    expect(document.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('COLOR_0')).not.toBeNull();
  });

  it('refuses skinned or animated documents', async () => {
    const document = await roundTrip(figureDocument({ skinned: true }));
    await expect(decimateDocument(document, { target: 100 })).rejects.toThrow(/static figures only/);
  });

  it('is a no-op under the target', async () => {
    const document = await roundTrip(figureDocument({ rings: 4, segments: 4 }));
    const result = await decimateDocument(document, { target: 36000 });
    expect(result.trianglesAfter).toBe(result.trianglesBefore);
    expect(result.ratio).toBe(1);
  });
});

/** POSITION count summed over primitives. */
function vertices(document) {
  return document
    .getRoot()
    .listMeshes()
    .reduce((s, mesh) => s + mesh.listPrimitives().reduce((t, prim) => t + prim.getAttribute('POSITION').getCount(), 0), 0);
}

/** A figure whose vertices are split per corner (every triangle its own three vertices): what a weld merges. */
async function unwelded(options) {
  const document = await roundTrip(figureDocument(options));
  await document.transform(unweld());
  return document;
}

describe('--weld-only (plan §5 G0: the weld-only calibration arm on the 13)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('welds, keeps every triangle, the attribute set and the textures, and records ratio 1', async () => {
    const document = await unwelded({ texture: true, twoPrims: true, rings: 20, segments: 30 });
    const before = countTriangles(document);
    const verticesBefore = vertices(document);
    const sig = attributeSignature(document);
    const tex = textureHashes(document);
    const soup = triangleSoup(document);
    const result = await decimateDocument(document, { template: 'seam-lock', simplify: false });
    expect(result.ratio).toBe(1);
    expect(result.template).toBe('weld-only');
    expect(result.trianglesBefore).toBe(before);
    expect(result.trianglesAfter).toBe(before);
    expect(countTriangles(document)).toBe(before);
    expect(vertices(document)).toBeLessThan(verticesBefore);
    expect(attributeSignature(document)).toEqual(sig);
    expect(textureHashes(document)).toEqual(tex);
    expect(symmetricHausdorff(soup, triangleSoup(document)).symmetric.max).toBeLessThan(1e-9);
    expect(result.primitives).toHaveLength(2);
    for (const p of result.primitives) {
      expect(p.trianglesAfter).toBe(p.trianglesBefore);
      expect(p.reached).toBe(true);
      expect(p.errorCap).toBeNull();
      expect(p.flags).toEqual([]);
    }
  });

  it('never calls the simplifier (the decimation path does)', async () => {
    const spy = vi.spyOn(MeshoptSimplifier, 'simplifyWithAttributes');
    await decimateDocument(await unwelded({ rings: 30, segments: 40 }), { template: 'seam-lock', simplify: false });
    expect(spy).not.toHaveBeenCalled();
    await decimateDocument(await unwelded({ rings: 30, segments: 40 }), { target: 800, template: 'seam-lock' });
    expect(spy).toHaveBeenCalled();
  });

  it('is the decimation pipeline with the simplifier skipped: an identity simplifier writes the same bytes', async () => {
    const io = await createWorldIO();
    const options = { color: true, twoPrims: true, rings: 24, segments: 32 };
    const weldOnly = await unwelded(options);
    await decimateDocument(weldOnly, { template: 'permissive-normal', simplify: false });
    // The decimation path with meshoptimizer replaced by "return the indices unchanged".
    vi.spyOn(MeshoptSimplifier, 'simplifyWithAttributes').mockImplementation((indices) => [indices, 0]);
    const identity = await unwelded(options);
    const result = await decimateDocument(identity, { target: countTriangles(identity) - 1, template: 'permissive-normal' });
    expect(result.trianglesAfter).toBe(result.trianglesBefore);
    expect(Buffer.from(await io.writeBinary(weldOnly)).equals(Buffer.from(await io.writeBinary(identity)))).toBe(true);
  });

  it('welds under the target too (the A1 no-op shortcut is a simplification rule)', async () => {
    const document = await unwelded({ rings: 4, segments: 4 });
    const verticesBefore = vertices(document);
    const result = await decimateDocument(document, { simplify: false });
    expect(result.trianglesAfter).toBe(result.trianglesBefore);
    expect(vertices(document)).toBeLessThan(verticesBefore);
    const untouched = await unwelded({ rings: 4, segments: 4 });
    expect((await decimateDocument(untouched, { target: 36000 })).primitives).toEqual([]);
    expect(vertices(untouched)).toBe(verticesBefore);
  });

  it('counts degenerate triangles; a weld drops only those (here none)', async () => {
    const document = await roundTrip(figureDocument({ rings: 6, segments: 8 }));
    // The UV sphere's north-pole triangles have two corners at the bitwise-same pole position (each with its own UV).
    const poles = degenerateTriangles(document);
    expect(poles).toBeGreaterThan(0);
    // Plus one index-degenerate triangle.
    const idx = document.getRoot().listMeshes()[0].listPrimitives()[0].getIndices();
    idx.setArray(Uint32Array.from([...idx.getArray(), 0, 0, 1]));
    const degenerateBefore = degenerateTriangles(document);
    expect(degenerateBefore).toBe(poles + 1);
    const result = await decimateDocument(document, { simplify: false });
    const dropped = result.trianglesBefore - result.trianglesAfter;
    expect(dropped).toBe(degenerateBefore - degenerateTriangles(document));
    expect(dropped).toBe(0); // gltf-transform 4.5 weld merges vertices and never drops a triangle
  });

  it('refuses skinned or animated documents', async () => {
    const document = await roundTrip(figureDocument({ skinned: true }));
    await expect(decimateDocument(document, { simplify: false })).rejects.toThrow(/static figures only/);
  });

  it('merges its per-file reports under its own name (never the A1 report)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'd42-weld-merge-'));
    try {
      expect(reportName(true)).toBe('weld-report');
      expect(reportName()).toBe('a1-report');
      const part = (file, castKb) => JSON.stringify({ stamp: { step: 'G0 weld-only' }, files: [{ file, castKb, weldOnly: true, ratio: 1 }] });
      writeFileSync(join(dir, 'weld-report.models_regular_930.glb.json'), part('models/regular/930.glb', 900));
      writeFileSync(join(dir, 'weld-report.models_regular_907.glb.json'), part('models/regular/907.glb', 7000));
      writeFileSync(join(dir, 'a1-report.models_regular_110.glb.json'), JSON.stringify({ stamp: { step: 'A1' }, files: [{ file: 'models/regular/110.glb', castKb: 1 }] }));
      const merged = mergeReports(dir, { weldOnly: true });
      expect(merged.files).toBe(2);
      const report = JSON.parse(readFileSync(join(dir, 'weld-report.json'), 'utf8'));
      expect(report.files.map((f) => f.file)).toEqual(['models/regular/907.glb', 'models/regular/930.glb']);
      expect(report.stamp.step).toBe('G0 weld-only');
      expect(JSON.parse(readFileSync(join(dir, 'cast-kb.json'), 'utf8'))).toEqual({ 'models/regular/907.glb': 7000, 'models/regular/930.glb': 900 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('--target-triangles (plan §5 G2: a FAIL raises the triangle target, up to 40 k)', () => {
  const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'decimate-figures.mjs');

  it('starts the target ladder there: the default is the A1 ladder, 40 000 a single rung, 40 k always last', () => {
    expect(TARGET_TRIANGLES).toBe(36000);
    expect(targetLadderFrom()).toEqual(TARGET_LADDER);
    expect(targetLadderFrom(36000)).toEqual([36000, 37000, 38000, 39000, 40000]);
    expect(targetLadderFrom(40000)).toEqual([40000]);
    expect(targetLadderFrom(38500)).toEqual([38500, 39500, 40000]);
  });

  it('refuses a target over the 40 k hard cap or not a positive integer', () => {
    for (const bad of [40001, 0, -1, 36000.5, Number.NaN]) expect(() => targetLadderFrom(bad)).toThrow(/--target-triangles/);
  });

  it('the CLI refuses 40 001 before reading anything, and the flag under --weld-only', () => {
    const missing = join(tmpdir(), 'd42-no-such-mirror');
    const over = spawnSync(process.execPath, [SCRIPT, '--src', missing, '--out', missing, '--target-triangles', '40001'], { encoding: 'utf8' });
    expect(over.status).toBe(1);
    expect(over.stderr).toMatch(/--target-triangles must be an integer in 1\.\.40000, not 40001/);
    const weld = spawnSync(process.execPath, [SCRIPT, '--src', missing, '--out', missing, '--weld-only', '--target-triangles', '40000'], { encoding: 'utf8' });
    expect(weld.status).toBe(2);
    expect(weld.stderr).toMatch(/usage/);
  }, 60000);

  it('decimates an outlier at 40 000: only that rung, per-primitive targets by share, the A1 report records it', async () => {
    const src = mkdtempSync(join(tmpdir(), 'd42-dec40-src-'));
    const out = mkdtempSync(join(tmpdir(), 'd42-dec40-out-'));
    try {
      const file = 'models/regular/930.glb';
      const io = await createWorldIO();
      // Two equal UV spheres, 22 000 triangles each: 44 000 > 40 000.
      const document = figureDocument({ texture: true, twoPrims: true, rings: 110, segments: 100 });
      mkdirSync(join(src, 'models', 'regular'), { recursive: true });
      writeFileSync(join(src, file), await io.writeBinary(document));
      const figures = [{ file, heightm: 1, bounds: { min: [-1, 0, -1], max: [3.5, 2, 1] } }];
      writeFileSync(join(src, 'manifest.json'), JSON.stringify({ figures }));
      const report = await decimateFigures({ src, out, only: file, targetTriangles: 40000 });
      expect(report.stamp.targetLadder).toEqual([40000]);
      const [row] = report.files;
      expect(row.attempts.map((a) => a.target)).toEqual(row.attempts.map(() => 40000));
      expect(row.q6).toBeUndefined();
      expect(row.target).toBe(40000);
      expect(row.trianglesBefore).toBe(44000);
      expect(row.trianglesAfter).toBeLessThanOrEqual(40000);
      expect(row.trianglesAfter).toBeGreaterThan(39000);
      expect(row.ratio).toBe(+(40000 / 44000).toFixed(4));
      // round(40 000 × share): each primitive holds half the triangles.
      expect(row.primitives.map((p) => p.target)).toEqual([20000, 20000]);
      expect(row.primitives.every((p) => p.reached && p.flags.includes('LockBorder') && !p.flags.includes('Permissive'))).toBe(true);
      expect(row.pass.all).toBe(true);
      expect(countTriangles(await io.read(join(out, file)))).toBe(row.trianglesAfter);
      expect(JSON.parse(readFileSync(join(out, 'cast-kb.json'), 'utf8'))).toEqual({ [file]: row.castKb });
    } finally {
      rmSync(src, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  }, 180000);
});

describe('--out equal to --src (mirror A is gitignored: git cannot restore an overwritten original)', () => {
  const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'decimate-figures.mjs');

  it('is refused before anything is read or written, however the same directory is spelled', async () => {
    const src = mkdtempSync(join(tmpdir(), 'd42-dec-same-'));
    try {
      const file = 'models/regular/930.glb';
      mkdirSync(join(src, 'models', 'regular'), { recursive: true });
      writeFileSync(join(src, file), 'the original');
      writeFileSync(join(src, 'manifest.json'), JSON.stringify({ figures: [{ file, heightm: 1, bounds: { min: [0, 0, 0], max: [1, 1, 1] } }] }));
      for (const out of [src, join(src, '.'), `${src}/`, join(src, 'models', '..')]) {
        await expect(decimateFigures({ src, out, only: file })).rejects.toThrow(/--out must differ from --src/);
      }
      const cli = spawnSync(process.execPath, [SCRIPT, '--src', src, '--out', join(src, '.'), '--only', file], { encoding: 'utf8' });
      expect(cli.status).toBe(1);
      expect(cli.stderr).toMatch(/--out must differ from --src/);
      expect(readFileSync(join(src, file), 'utf8')).toBe('the original');
      for (const written of ['cast-kb.json', 'a1-report.json', `a1-report.${file.replace(/\//g, '_')}.json`]) expect(existsSync(join(src, written))).toBe(false);
    } finally {
      rmSync(src, { recursive: true, force: true });
    }
  }, 60000);
});

describe('A1 measures', () => {
  it('read zero on identical geometry and colour', async () => {
    const document = await roundTrip(figureDocument({ color: true, rings: 12, segments: 16 }));
    const soup = triangleSoup(document);
    const h = symmetricHausdorff(soup, soup);
    expect(h.symmetric.max).toBeLessThan(1e-9);
    const c = colourTransferError(soup, soup);
    expect(c.seamAware.max).toBe(0);
  });

  it('see a displaced surface in both directions', async () => {
    const a = triangleSoup(await roundTrip(figureDocument({ rings: 12, segments: 16 })));
    const b = { ...a, positions: a.positions.map((v, i) => (i % 3 === 1 ? v + 0.01 : v)) };
    const h = symmetricHausdorff(a, b);
    expect(h.symmetric.max).toBeGreaterThan(0.005);
    expect(h.aToB.max).toBeGreaterThan(0.005);
    expect(h.bToA.max).toBeGreaterThan(0.005);
  });

  it('px/m comes from the shipped teams formations; the close-up rule is 844 px / height', async () => {
    const ace = await acePixelsPerMetre({ heightM: 1.2, footprintM: 1, widthM: 1 });
    expect(ace.ppm).toBeGreaterThan(50);
    expect(ace.ppm).toBeLessThan(CLOSE_UP_PX / 1.2);
    expect(['plaza', 'sakura', 'mountain']).toContain(ace.site);
  }, 60000);
});
