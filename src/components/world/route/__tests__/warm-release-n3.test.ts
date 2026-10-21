import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { armStationWarmup, guardCompileFrame, isCompileHeld, releaseHeldMask, WARM_BUFFER_LAYER } from '../useStationWarmup';
import { N3_TAG_BITS, N3_TAG_DW_OFF, N3_TAG_DW_OFF_LAYER, N3_TAG_DW_ON, N3_TAG_DW_ON_LAYER } from '../post/n3-tags';

/**
 * D42 X15: the compile guard's release is tag-aware. N3 (ENGINE-P) tags
 * objects with two camera layer bits; a renderable held for compile (its
 * mask parked at 0) that gets tagged while held must come back with its
 * original layers AND the tag. Any other write while held stays a
 * deliberate write and is kept, as before.
 */

interface FakeProgram {
  ready: boolean;
  isReady: () => boolean;
}

function fakeRenderer() {
  const props = new Map<object, { currentProgram?: FakeProgram }>();
  const programs: FakeProgram[] = [];
  const gl = {
    extensions: { has: (name: string) => name === 'KHR_parallel_shader_compile' },
    properties: { get: (object: object) => props.get(object) ?? {} },
    compile: vi.fn((object: THREE.Object3D) => {
      object.traverse((node) => {
        const material = (node as THREE.Mesh).material as THREE.Material | undefined;
        if (!material) return;
        const entry = props.get(material) ?? {};
        if (!entry.currentProgram) {
          const program: FakeProgram = { ready: false, isReady: () => program.ready };
          programs.push(program);
          entry.currentProgram = program;
        }
        props.set(material, entry);
      });
      return new Set<THREE.Material>();
    }),
    compileAsync: vi.fn(() => Promise.resolve()),
    initTexture: vi.fn(),
  };
  return { gl: gl as unknown as THREE.WebGLRenderer, programs };
}

type Hook = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, target: object | null) => void;

function frame(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  guardCompileFrame(gl, scene, true);
  (scene.onBeforeRender as unknown as Hook)(gl, scene, camera, null);
}

describe('n3-tags (X15)', () => {
  it('two layer bits no app layer uses (not 0, not the warm buffer layer)', () => {
    expect(N3_TAG_DW_OFF).toBe(1 << N3_TAG_DW_OFF_LAYER);
    expect(N3_TAG_DW_ON).toBe(1 << N3_TAG_DW_ON_LAYER);
    expect(N3_TAG_DW_OFF & N3_TAG_DW_ON).toBe(0);
    expect(N3_TAG_BITS).toBe(N3_TAG_DW_OFF | N3_TAG_DW_ON);
    for (const layer of [N3_TAG_DW_OFF_LAYER, N3_TAG_DW_ON_LAYER]) {
      expect(layer).not.toBe(0);
      expect(layer).not.toBe(WARM_BUFFER_LAYER);
      expect(layer).toBeLessThan(32);
    }
    // A default object is on none of them.
    expect(new THREE.Object3D().layers.mask & N3_TAG_BITS).toBe(0);
  });
});

describe('releaseHeldMask (X15)', () => {
  it('untouched while held: the saved mask comes back', () => {
    expect(releaseHeldMask(1, 0)).toBe(1);
    expect(releaseHeldMask(1 | N3_TAG_DW_ON, 0)).toBe(1 | N3_TAG_DW_ON);
  });

  it('tagged while held: saved | the tags written', () => {
    expect(releaseHeldMask(1, N3_TAG_DW_OFF)).toBe(1 | N3_TAG_DW_OFF);
    expect(releaseHeldMask(1, N3_TAG_BITS)).toBe(1 | N3_TAG_BITS);
  });

  it('any other bit is a deliberate write: kept as is (null)', () => {
    expect(releaseHeldMask(1, 1 << 3)).toBeNull();
    expect(releaseHeldMask(1, (1 << 3) | N3_TAG_DW_OFF)).toBeNull();
  });
});

describe('compile guard release with N3 tags (X15)', () => {
  let now = 0;

  beforeEach(() => {
    now = 1000;
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { documentElement: { classList: { contains: (name: string) => name === 'world-route-live' } } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function setup() {
    const { gl, programs } = fakeRenderer();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    armStationWarmup(gl, scene, camera);
    frame(gl, scene, camera);
    return { gl, programs, scene, camera };
  }

  it('tag a held object, release it: layer 0 restored and the tag kept', () => {
    const { gl, programs, scene, camera } = setup();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ transparent: true }));
    scene.add(mesh);
    frame(gl, scene, camera);
    expect(isCompileHeld(gl, mesh)).toBe(true);
    expect(mesh.layers.mask).toBe(0);
    // N3's tagging traversal runs while the mesh is held (base 0, tag bit only).
    mesh.layers.mask = (mesh.layers.mask & ~N3_TAG_BITS) | N3_TAG_DW_OFF;
    for (const program of programs) program.ready = true;
    now += 16;
    frame(gl, scene, camera);
    expect(isCompileHeld(gl, mesh)).toBe(false);
    expect(mesh.layers.isEnabled(0)).toBe(true);
    expect(mesh.layers.isEnabled(N3_TAG_DW_OFF_LAYER)).toBe(true);
    expect(mesh.layers.mask).toBe(1 | N3_TAG_DW_OFF);
    expect(mesh.layers.test(camera.layers)).toBe(true);
  });

  it('a tag carried into the hold survives it untouched', () => {
    const { gl, programs, scene, camera } = setup();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.layers.mask = 1 | N3_TAG_DW_ON;
    scene.add(mesh);
    frame(gl, scene, camera);
    expect(isCompileHeld(gl, mesh)).toBe(true);
    for (const program of programs) program.ready = true;
    now += 16;
    frame(gl, scene, camera);
    expect(mesh.layers.mask).toBe(1 | N3_TAG_DW_ON);
  });

  it('a deliberate layer write while held is still kept', () => {
    const { gl, programs, scene, camera } = setup();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    scene.add(mesh);
    frame(gl, scene, camera);
    mesh.layers.set(3);
    for (const program of programs) program.ready = true;
    now += 16;
    frame(gl, scene, camera);
    expect(mesh.layers.mask).toBe(1 << 3);
  });
});
