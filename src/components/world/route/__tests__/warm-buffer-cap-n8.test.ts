import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createLoadWarmIO,
  nextFreshBudget,
  WARM_BUFFER_DRAW_NEW_MATERIALS,
  WARM_BUFFER_NEW_MATERIALS,
  WARM_BUFFER_NEW_MATERIALS_MAX,
  WARM_GPU_HEAVY_MS,
} from '../useStationWarmup';

/**
 * D42 N8: the warm's `buffers` stage carries up to TWO first-drawn materials
 * per step while the GPU fence is idle (the previous step's fence signalled
 * at its first poll, and the step was light), and drops back to one after any
 * step the GPU needed more frames for. Each draw still carries one.
 */

describe('nextFreshBudget (N8)', () => {
  it('the cap is 2, the base 1, one per draw', () => {
    expect(WARM_BUFFER_NEW_MATERIALS).toBe(1);
    expect(WARM_BUFFER_NEW_MATERIALS_MAX).toBe(2);
    expect(WARM_BUFFER_DRAW_NEW_MATERIALS).toBe(1);
  });

  it('grows 1 → 2 on an idle, light step and never past the cap', () => {
    expect(nextFreshBudget(1, 0, 4)).toBe(2);
    expect(nextFreshBudget(2, 0, 4)).toBe(2);
  });

  it('does not grow after a heavy step, even one signalled at the first poll', () => {
    expect(nextFreshBudget(1, 0, WARM_GPU_HEAVY_MS)).toBe(1);
    expect(nextFreshBudget(2, 0, WARM_GPU_HEAVY_MS + 10)).toBe(2);
  });

  it('halves back to the base after a step that needed more frames', () => {
    expect(nextFreshBudget(2, 1, 40)).toBe(1);
    expect(nextFreshBudget(1, 3, 40)).toBe(1);
  });
});

type FakeSync = { signaled: boolean };

function fencedGl() {
  const syncs: FakeSync[] = [];
  const context = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    SYNC_STATUS: 2,
    SIGNALED: 3,
    UNSIGNALED: 4,
    fenceSync: vi.fn(() => {
      const sync = { signaled: false };
      syncs.push(sync);
      return sync;
    }),
    getSyncParameter: vi.fn((sync: FakeSync) => (sync.signaled ? 3 : 4)),
    deleteSync: vi.fn(),
    flush: vi.fn(),
  };
  const textureProps = new Map<object, { __version?: number }>();
  const gl = {
    getContext: () => context,
    extensions: { has: () => true },
    properties: { get: (object: object) => textureProps.get(object) ?? {} },
    compile: vi.fn(() => new Set()),
    initTexture: vi.fn((texture: THREE.Texture) => textureProps.set(texture, { __version: texture.version })),
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
  return { gl: gl as unknown as THREE.WebGLRenderer, syncs };
}

describe('the buffers stage under the adaptive cap (N8)', () => {
  let now = 1000;
  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setup() {
    const { gl, syncs } = fencedGl();
    const scene = new THREE.Scene();
    const meshes = [
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()),
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial()),
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()),
    ];
    for (const mesh of meshes) scene.add(mesh);
    let draws = 0;
    const io = createLoadWarmIO({
      gl,
      scene,
      camera: new THREE.PerspectiveCamera(),
      contentComplete: () => true,
      poses: () => [],
      rawRender: () => {
        draws += 1;
      },
      requestFrame: () => {},
      frameDrawn: () => true,
      passes: () => [],
      signal: () => {},
      faces: () => [],
    });
    const step = (): number => {
      const before = draws;
      io.bufferSlice();
      return draws - before;
    };
    return { io, syncs, step };
  }

  it('starts at one first-drawn material per step (no fence read yet)', () => {
    const { io, step } = setup();
    expect(io.report().freshBudget).toBe(1);
    expect(step()).toBe(1);
  });

  it('an idle fence grows the step to two first draws; a busy one drops it back to one', () => {
    const { io, syncs, step } = setup();
    // A light fenced step: signalled before the first poll a frame later.
    io.fenceGpu?.();
    now += 8;
    syncs[0].signaled = true;
    expect(io.gpuIdle?.()).toBe(true);
    expect(io.report().freshBudget).toBe(2);
    expect(step()).toBe(2); // two draws, one first-drawn material each
    // A step the GPU needed another frame for: back to one.
    io.fenceGpu?.();
    now += 16;
    expect(io.gpuIdle?.()).toBe(false);
    syncs[1].signaled = true;
    now += 16;
    expect(io.gpuIdle?.()).toBe(true);
    expect(io.report().freshBudget).toBe(1);
    expect(step()).toBe(1);
  });
});
