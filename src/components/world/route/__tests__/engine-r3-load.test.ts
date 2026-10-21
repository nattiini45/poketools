import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createLoadWarmIO,
  WARM_BUFFER_LAYER,
  WARM_BUFFER_NEW_MATERIALS,
  WARM_SIGNATURE_STABLE_FRAMES,
  type WarmOutput,
} from '../useStationWarmup';
import { STALL_PROGRESS_SIGNALS } from '../scene-progress';

/**
 * ENGINE r3 load-warm contracts:
 * - the `buffers` stage draws every renderable into EVERY output a real frame
 *   can use (a program's first draw into an output builds its D3D executables
 *   synchronously in the ANGLE GPU process), the start rung's output first,
 *   at most WARM_BUFFER_NEW_MATERIALS first-drawn materials per slice;
 * - the start output's slices also draw the shadow pass (its casters only),
 *   and the shadow-map flags are restored;
 * - `collect` memoises variant keys, and still re-keys a changed geometry.
 */

type FakeProgram = { ready: boolean; isReady: () => boolean; usedTimes: number };

function fakeGl() {
  const props = new Map<object, { currentProgram?: FakeProgram }>();
  const programs: FakeProgram[] = [];
  let bound: unknown = null;
  const compile = vi.fn((object: THREE.Object3D) => {
    object.traverse((node) => {
      const material = (node as THREE.Mesh).material as THREE.Material | undefined;
      if (!material) return;
      const entry = props.get(material) ?? {};
      if (!entry.currentProgram) {
        const program: FakeProgram = { ready: true, isReady: () => program.ready, usedTimes: 1 };
        programs.push(program);
        entry.currentProgram = program;
      }
      props.set(material, entry);
    });
    return new Set<THREE.Material>();
  });
  const gl = {
    extensions: { has: () => true },
    properties: { get: (object: object) => props.get(object) ?? {} },
    compile,
    initTexture: vi.fn(),
    info: { programs },
    shadowMap: { enabled: true, type: THREE.PCFShadowMap, autoUpdate: true, needsUpdate: false },
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.NoToneMapping,
    getRenderTarget: () => bound,
    setRenderTarget: (next: unknown) => {
      bound = next;
    },
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    domElement: { width: 1440, height: 900 },
    clear: vi.fn(),
  };
  return { gl: gl as unknown as THREE.WebGLRenderer, programs };
}

const OUTPUTS: WarmOutput[] = [
  { kind: 'hdr', toneMapping: THREE.NoToneMapping },
  { kind: 'screen', toneMapping: THREE.ACESFilmicToneMapping },
];

function makeIO(
  scene: THREE.Scene,
  gl: THREE.WebGLRenderer,
  rawRender: (scene: THREE.Scene, camera: THREE.Camera) => void = () => {},
  outputs: readonly WarmOutput[] = OUTPUTS,
) {
  return createLoadWarmIO({
    gl,
    scene,
    camera: new THREE.PerspectiveCamera(),
    contentComplete: () => true,
    poses: () => [],
    rawRender,
    requestFrame: () => {},
    frameDrawn: () => true,
    passes: () => [],
    signal: () => {},
    outputs: () => outputs,
  });
}

describe('load warm buffers: every output, a first-draw budget (ENGINE r3)', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => 1000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws every renderable into every output, the start output first, and the shadow pass with the start output only', () => {
    const { gl } = fakeGl();
    const scene = new THREE.Scene();
    const material = new THREE.MeshStandardMaterial();
    const meshes = Array.from({ length: 2 }, () => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
      mesh.castShadow = true;
      scene.add(mesh);
      return mesh;
    });
    const draws: { target: THREE.WebGLRenderTarget | null; shadow: boolean; drawn: number }[] = [];
    const io = makeIO(scene, gl, (_scene, camera) => {
      draws.push({
        target: gl.getRenderTarget(),
        shadow: gl.shadowMap.needsUpdate,
        drawn: meshes.filter((mesh) => mesh.layers.test(camera.layers)).length,
      });
    });
    let guard = 0;
    while (io.bufferSlice() > 0 && guard < 20) guard += 1;
    expect(draws.length).toBeGreaterThanOrEqual(2);
    const halfFloat = draws.map((draw) => (draw.target as THREE.WebGLRenderTarget).texture.type === THREE.HalfFloatType);
    // The hdr (start) output's draws come first, then the screen output's.
    expect(halfFloat[0]).toBe(true);
    expect(halfFloat.at(-1)).toBe(false);
    expect(halfFloat.indexOf(false)).toBeGreaterThan(halfFloat.lastIndexOf(true));
    // Every mesh reaches every output.
    const byOutput = (hdr: boolean) =>
      draws.filter((_, index) => halfFloat[index] === hdr).reduce((sum, draw) => sum + draw.drawn, 0);
    expect(byOutput(true)).toBe(2);
    expect(byOutput(false)).toBe(2);
    // The shadow pass draws with the start output only.
    expect(draws.filter((_, index) => halfFloat[index]).every((draw) => draw.shadow)).toBe(true);
    expect(draws.filter((_, index) => !halfFloat[index]).every((draw) => !draw.shadow)).toBe(true);
    // Restored.
    expect(gl.shadowMap.autoUpdate).toBe(true);
    expect(gl.shadowMap.needsUpdate).toBe(false);
    for (const mesh of meshes) expect(mesh.layers.isEnabled(WARM_BUFFER_LAYER)).toBe(false);
    expect(gl.getRenderTarget()).toBeNull();
  });

  it('carries at most WARM_BUFFER_NEW_MATERIALS first-drawn materials per slice', () => {
    const { gl } = fakeGl();
    const scene = new THREE.Scene();
    const count = WARM_BUFFER_NEW_MATERIALS * 2 + 1;
    const meshes = Array.from({ length: count }, () => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
      scene.add(mesh);
      return mesh;
    });
    const perDraw: number[] = [];
    const io = makeIO(
      scene,
      gl,
      (_scene, camera) => {
        perDraw.push(meshes.filter((mesh) => mesh.layers.test(camera.layers)).length);
      },
      [OUTPUTS[0]],
    );
    let guard = 0;
    while (io.bufferSlice() > 0 && guard < 50) guard += 1;
    expect(perDraw.reduce((a, b) => a + b, 0)).toBe(count);
    expect(Math.max(...perDraw)).toBeLessThanOrEqual(WARM_BUFFER_NEW_MATERIALS);
    expect(perDraw).toHaveLength(Math.ceil(count / WARM_BUFFER_NEW_MATERIALS));
  });
});

describe('collect: memoised variant keys (ENGINE r3)', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => 1000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finds nothing fresh on repeat, and re-keys a geometry whose attribute set changed', () => {
    const { gl } = fakeGl();
    const scene = new THREE.Scene();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    scene.add(mesh);
    const io = makeIO(scene, gl, () => {}, [OUTPUTS[0]]);
    expect(io.collect()).toBe(1);
    for (let i = 0; i < WARM_SIGNATURE_STABLE_FRAMES + 2; i += 1) expect(io.collect()).toBe(0);
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
    expect(io.collect()).toBe(1);
    // A new material on the same object is a new variant too.
    mesh.material = new THREE.MeshStandardMaterial();
    expect(io.collect()).toBe(1);
  });
});

describe('stall detector progress signals (ENGINE r3)', () => {
  it('counts the staged world mounts and the paint queue as load progress', () => {
    expect(STALL_PROGRESS_SIGNALS.has('staged')).toBe(true);
    expect(STALL_PROGRESS_SIGNALS.has('paints')).toBe(true);
  });
});

describe('governor step: held material disposals (ENGINE r3)', () => {
  it('holds every Material.dispose until released, then runs them in call order', async () => {
    const { holdMaterialDisposals, releaseMaterialDisposals } = await import('../QualityGovernor');
    const order: string[] = [];
    const a = new THREE.MeshBasicMaterial();
    const b = new THREE.MeshStandardMaterial();
    a.addEventListener('dispose', () => order.push('a'));
    b.addEventListener('dispose', () => order.push('b'));
    holdMaterialDisposals();
    try {
      a.dispose();
      b.dispose();
      expect(order).toEqual([]);
    } finally {
      releaseMaterialDisposals();
    }
    expect(order).toEqual(['a', 'b']);
    // The prototype is restored: later disposals run at once.
    const c = new THREE.MeshBasicMaterial();
    c.addEventListener('dispose', () => order.push('c'));
    c.dispose();
    expect(order).toEqual(['a', 'b', 'c']);
  });
});
