import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createLoadWarmIO, type WarmDataFace } from '../useStationWarmup';
import { BAND_MAX_BYTES, markBandedUpload, planUploadBands, resetBandedUploadsForTests } from '../content/banded-upload';
import { canvasSource, readRoute, warmSource } from './route-sources';

/**
 * ROLLOUT-PLAN §3.2, ENGINE B2:
 * - E3: the load warm uploads a marked giant face in bands (≤ 2 MiB a step),
 *   keeps it at the head of its queue, and counts it as NOT uploaded until
 *   the last band has landed — so neither `uploaded` nor the reveal can pass
 *   a half-banded face;
 * - E5: the warm's prepare hooks are world-agnostic (any painted world's
 *   sweep registers them), the content gate waits on the paint queue (the
 *   sliced crown builds), and the debug handle carries `__warmAudit.lateLinks`.
 */

const ROUTE = join(process.cwd(), 'src', 'components', 'world', 'route');
const read = (file: string) => readFileSync(file, 'utf8');

function bandingGl() {
  const textureProps = new Map<object, { __version?: number }>();
  const copies: { dst: THREE.Texture; y: number; h: number }[] = [];
  const allocations: { texture: THREE.Texture; dataReady: boolean }[] = [];
  const gl = {
    getContext: () => ({ NONE: 0, BROWSER_DEFAULT_WEBGL: 1, UNPACK_COLORSPACE_CONVERSION_WEBGL: 2 }),
    extensions: { has: () => true },
    properties: { get: (object: object) => textureProps.get(object) ?? {} },
    state: { pixelStorei: vi.fn() },
    compile: vi.fn(() => new Set()),
    initTexture: vi.fn((texture: THREE.Texture) => {
      allocations.push({ texture, dataReady: texture.source.dataReady });
      textureProps.set(texture, { __version: texture.version });
    }),
    copyTextureToTexture: vi.fn((_src: THREE.Texture, dst: THREE.Texture, region: THREE.Box2) => {
      copies.push({ dst, y: region.min.y, h: region.max.y - region.min.y });
    }),
    info: { programs: [] },
    shadowMap: { enabled: false, type: THREE.PCFShadowMap, autoUpdate: true, needsUpdate: false },
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.NoToneMapping,
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    domElement: { width: 1440, height: 900 },
    clear: vi.fn(),
  };
  return { gl: gl as unknown as THREE.WebGLRenderer, copies, allocations };
}

function ioFor(gl: THREE.WebGLRenderer, scene: THREE.Scene, faces: () => readonly WarmDataFace[] = () => []) {
  return createLoadWarmIO({
    gl,
    scene,
    camera: new THREE.PerspectiveCamera(),
    contentComplete: () => true,
    poses: () => [],
    rawRender: () => {},
    requestFrame: () => {},
    frameDrawn: () => true,
    passes: () => [],
    signal: () => {},
    faces,
  });
}

function canvasTexture(width: number, height: number): THREE.Texture {
  const texture = new THREE.Texture({ width, height } as unknown as HTMLCanvasElement);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

describe('E3: the load warm bands giant faces', () => {
  let now = 1000;
  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('textures stage: one ≤ 2 MiB step per call, the face held at the head until its last band', () => {
    const { gl, copies, allocations } = bandingGl();
    const scene = new THREE.Scene();
    const face = markBandedUpload(canvasTexture(4096, 1024));
    const small = canvasTexture(64, 64);
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: face })));
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: small })));
    const io = ioFor(gl, scene);
    const bands = planUploadBands(4096, 1024).length;
    const steps: number[] = [];
    for (let guard = 0; guard < 50; guard += 1) {
      const before = copies.length;
      const left = io.textureSlice();
      steps.push(copies.length - before);
      now += 16;
      if (left === 0) break;
      // Never more than one band's budget of the face per step.
      expect((copies.length - before) * 2048 * 256 * 4).toBeLessThanOrEqual(BAND_MAX_BYTES);
    }
    expect(copies.filter((c) => c.dst === face)).toHaveLength(bands);
    // Allocation only (no texel transfer), once; the small map uploaded whole.
    expect(allocations.filter((a) => a.texture === face)).toEqual([{ texture: face, dataReady: false }]);
    expect(allocations.filter((a) => a.texture === small)).toEqual([{ texture: small, dataReady: true }]);
    expect(steps.filter((n) => n > 0)).toHaveLength(bands);
    expect(io.report().bandSteps).toBe(bands);
  });

  it('E6: while the compile has not opened, each warm frame bands one step of a registered face (early bands)', () => {
    resetBandedUploadsForTests();
    const { gl, copies } = bandingGl();
    const scene = new THREE.Scene();
    const face = markBandedUpload(canvasTexture(3072, 1280));
    const gone = markBandedUpload(canvasTexture(4096, 1024));
    gone.dispose(); // a repainted face leaves the registry: never re-allocated
    const io = ioFor(gl, scene);
    const bands = planUploadBands(3072, 1280).length;
    for (let frame = 0; frame < 40; frame += 1) {
      io.uploadWhileLinking?.();
      now += 16;
    }
    expect(copies.filter((c) => c.dst === face)).toHaveLength(bands);
    expect(copies.some((c) => c.dst === gone)).toBe(false);
    expect(io.report().earlyBandSteps).toBe(io.report().bandSteps);
    // The textures stage then finds it resident.
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: face })));
    expect(io.textureSlice()).toBe(0);
    expect(copies.filter((c) => c.dst === face)).toHaveLength(bands);
  });

  it('facesSlice: a face with bands still owed is not ready', () => {
    const { gl } = bandingGl();
    const scene = new THREE.Scene();
    const texture = markBandedUpload(canvasTexture(2386, 2710));
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: texture }));
    scene.add(panel);
    const io = ioFor(gl, scene, () => [{ id: 'board:pulse', painted: true, object: panel, textures: [texture] }]);
    const bands = planUploadBands(2386, 2710).length;
    let calls = 0;
    while (io.facesSlice() > 0) {
      calls += 1;
      now += 16;
      expect(calls).toBeLessThanOrEqual(bands);
    }
    expect(calls).toBeGreaterThan(1);
    expect(io.facesSlice()).toBe(0);
  });
});

describe('E5: warm coverage for every painted world', () => {
  it('prepare hooks run for whatever registered them (no plaza gate), and PaintSweep registers them per scope', () => {
    const warm = warmSource();
    const run = warm.slice(warm.indexOf('export function runWarmPrepare'), warm.indexOf('/** Which post pass'));
    expect(run).toMatch(/for \(const hook of \[\.\.\.prepareHooks\]\)/);
    expect(run).not.toMatch(/plaza|theme/i);
    const sweep = read(join(ROUTE, 'paint', 'paint-sweep.ts'));
    expect(sweep).toMatch(/export function PaintSweep\(\{ scope \}/);
    expect(sweep).toMatch(/registerWarmPrepare\(/);
    const rig = read(join(ROUTE, 'paint', 'PaintRig.tsx'));
    expect(rig).toMatch(/sweep \? <PaintSweep scope=\{theme\.id\} \/> : null/);
  });

  it('the content gate waits on the paint queue (sliced crowns and face paints land before any compile)', () => {
    const loadWarmer = readRoute('canvas/LoadWarmer.tsx');
    const warmer = loadWarmer.slice(loadWarmer.indexOf('function LoadWarmer'));
    expect(warmer.match(/paintQueueIdle\(\) &&/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    const tree = read(join(ROUTE, 'trees', 'Tree.tsx'));
    expect(tree).toMatch(/return queuePaint\(\(\) => \{\s*const built = builder\(input\);/);
  });

  it('the debug handle carries __warmAudit.lateLinks, counted from the reveal arm', () => {
    const canvas = canvasSource();
    expect(canvas).toMatch(/host\.__warmAudit = \(\) => \(\{/);
    expect(canvas).toMatch(/lateLinks: lateAudit\.generation === generation \? lateAudit\.late\.length : 0/);
    expect(canvas).toMatch(/if \(getRevealArmedAt\(\) !== null\) \{\s*if \(debug\) auditLateLinks\(\);/);
  });
});
