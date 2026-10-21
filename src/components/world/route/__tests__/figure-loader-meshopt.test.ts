import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

/**
 * D42 commit G: the committed meshopt fixture (`figures/__tests__/fixtures/
 * meshopt-fixture.glb`, written by `make-meshopt-fixture.mjs`) and the
 * promotion timing. The fixture is the decoder's proof object: it parses
 * through three-stdlib's GLTFLoader (drei's) with three's meshopt decoder and
 * throws without one; the figure loader's afterRoot promotion runs on it and
 * is timed (`route:vertexPromotion`).
 */

vi.mock('three/examples/jsm/loaders/KTX2Loader.js', () => ({
  KTX2Loader: class {
    setTranscoderPath() {
      return this;
    }
    setWorkerLimit() {
      return this;
    }
    detectSupport() {
      return this;
    }
  },
}));

const DIR = join(__dirname, '..', 'figures', '__tests__', 'fixtures');
const FIXTURE = join(DIR, 'meshopt-fixture.glb');

function fixtureBytes(): ArrayBuffer {
  const buffer = readFileSync(FIXTURE);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

interface Parsed {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

async function parse(withDecoder: boolean, extend?: (loader: unknown) => void): Promise<Parsed> {
  const { GLTFLoader } = await import('three-stdlib');
  const loader = new GLTFLoader();
  extend?.(loader);
  if (withDecoder) {
    const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
    loader.setMeshoptDecoder(MeshoptDecoder as never);
  } else {
    loader.setMeshoptDecoder(null as never);
  }
  return new Promise<Parsed>((resolve, reject) => loader.parse(fixtureBytes(), '', resolve as never, reject));
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) out.push(node as THREE.Mesh);
  });
  return out;
}

describe('the committed meshopt fixture (D42)', () => {
  it('is EXT_meshopt_compression-required, and the generator reproduces it byte for byte', async () => {
    const bytes = new Uint8Array(fixtureBytes());
    const jsonLength = new DataView(bytes.buffer).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as { extensionsRequired?: string[] };
    expect(json.extensionsRequired).toContain('EXT_meshopt_compression');
    const { buildFixture } = (await import('../figures/__tests__/fixtures/make-meshopt-fixture.mjs')) as { buildFixture: () => Promise<Uint8Array> };
    const rebuilt = await buildFixture();
    expect(Buffer.from(rebuilt).equals(Buffer.from(bytes))).toBe(true);
  }, 30_000);

  it('parses through three-stdlib GLTFLoader with three’s decoder (192 triangles, the idle clip)', async () => {
    const gltf = await parse(true);
    const meshes = meshesOf(gltf.scene);
    expect(meshes).toHaveLength(1);
    const index = meshes[0].geometry.getIndex();
    expect(index ? index.count / 3 : 0).toBe(192);
    expect(gltf.animations.map((clip) => clip.name)).toEqual(['idle']);
  }, 30_000);

  it('throws without a decoder (the failure `failedFigureLoads` counts)', async () => {
    await expect(parse(false)).rejects.toThrow(/setMeshoptDecoder/);
  }, 30_000);

  it('the figure loader promotes it to Float32 and times the promotion (route:vertexPromotion)', async () => {
    const { extendFigureLoader, vertexPromotionTotals, VERTEX_PROMOTION_MEASURE } = await import('../figures/figure-loader');
    const before = { ...vertexPromotionTotals() };
    const marksBefore = performance.getEntriesByName(VERTEX_PROMOTION_MEASURE).length;
    const gltf = await parse(true, (loader) => extendFigureLoader(loader as never));
    const geometry = meshesOf(gltf.scene)[0].geometry;
    // KHR_mesh_quantization's SHORT normals and positions are Float32 before the result resolves.
    expect(geometry.getAttribute('normal').array).toBeInstanceOf(Float32Array);
    expect(geometry.getAttribute('position').array).toBeInstanceOf(Float32Array);
    const after = vertexPromotionTotals();
    expect(after.loads - before.loads).toBe(1);
    expect(after.attributes - before.attributes).toBeGreaterThanOrEqual(2);
    expect(after.ms).toBeGreaterThanOrEqual(before.ms);
    expect(after.longestMs).toBeLessThanOrEqual(after.ms + 1e-9);
    const measures = performance.getEntriesByName(VERTEX_PROMOTION_MEASURE);
    expect(measures.length - marksBefore).toBe(1);
    const detail = (measures[measures.length - 1] as PerformanceMeasure).detail as { promotedBytes: number };
    expect(detail.promotedBytes).toBeGreaterThan(0);
  }, 30_000);
});
