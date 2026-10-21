import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createLinkCap,
  createLoadWarm,
  createLoadWarmIO,
  deferExternalUploads,
  stepLinkCap,
  stepLoadWarm,
  warmLinkBudget,
  WARM_BUFFER_LAYER,
  WARM_FRAME_SLOW_MS,
  WARM_FRAME_STALLED_MS,
  WARM_LINK_CAP_RAMP_FRAMES,
  WARM_LINK_CAP_START,
  WARM_MAX_LINKS_IN_FLIGHT,
  WARM_NEW_PROGRAMS_PER_FRAME,
  WARM_SIGNATURE_STABLE_FRAMES,
  WARM_VERIFY_MAX_PASSES,
  type LoadWarmIO,
} from '../useStationWarmup';

/**
 * ENGINE r2 (LOOK round 2): the load-warm behaviours added after the round-1
 * judges — the scene program-state signature (lights / environment / fog)
 * and stale-variant eviction, the compile gate, the verification pass, the
 * adaptive link cap, the byte-budgeted buffer uploads, the screen-variant
 * pass compile and the deferral of outside `initTexture` batches.
 */

interface FakeProgram {
  ready: boolean;
  isReady: () => boolean;
  usedTimes: number;
}

function fakeGl() {
  const props = new Map<object, { currentProgram?: FakeProgram }>();
  const programs: FakeProgram[] = [];
  let bound: unknown = null;
  const boundAtCompile: unknown[] = [];
  const compile = vi.fn((object: THREE.Object3D) => {
    boundAtCompile.push(bound);
    object.traverse((node) => {
      const material = (node as THREE.Mesh).material as THREE.Material | undefined;
      if (!material) return;
      const entry = props.get(material) ?? {};
      if (!entry.currentProgram) {
        const program: FakeProgram = { ready: false, isReady: () => program.ready, usedTimes: 1 };
        programs.push(program);
        entry.currentProgram = program;
      }
      props.set(material, entry);
    });
    return new Set<THREE.Material>();
  });
  const initTexture = vi.fn();
  const gl = {
    extensions: { has: () => true },
    properties: { get: (object: object) => props.get(object) ?? {} },
    compile,
    initTexture,
    info: { programs },
    shadowMap: { enabled: false, type: THREE.PCFShadowMap, autoUpdate: true },
    getRenderTarget: () => bound,
    setRenderTarget: (next: unknown) => {
      bound = next;
    },
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    domElement: { width: 1440, height: 900 },
    clear: vi.fn(),
  };
  return { gl: gl as unknown as THREE.WebGLRenderer, compile, programs, props, initTexture, boundAtCompile };
}

function makeIO(
  scene: THREE.Scene,
  gl: THREE.WebGLRenderer,
  opts: {
    compileReady?: () => boolean;
    rawRender?: (scene: THREE.Scene, camera: THREE.Camera) => void;
    screenMaterials?: () => THREE.Material[];
  } = {},
) {
  return createLoadWarmIO({
    gl,
    scene,
    camera: new THREE.PerspectiveCamera(),
    contentComplete: () => true,
    compileReady: opts.compileReady,
    poses: () => [],
    rawRender: opts.rawRender ?? (() => {}),
    requestFrame: () => {},
    frameDrawn: () => true,
    passes: () => [],
    screenMaterials: opts.screenMaterials,
    signal: () => {},
  });
}

function settle(io: LoadWarmIO): void {
  for (let i = 0; i <= WARM_SIGNATURE_STABLE_FRAMES; i += 1) io.collect();
}

describe('adaptive link cap (ENGINE r2)', () => {
  it('starts low, grows on smooth frames, halves on a slow one', () => {
    let cap = createLinkCap();
    expect(cap.cap).toBe(WARM_LINK_CAP_START);
    for (let i = 0; i < WARM_LINK_CAP_RAMP_FRAMES; i += 1) cap = stepLinkCap(cap, 16);
    expect(cap.cap).toBe(WARM_LINK_CAP_START + 1);
    for (let i = 0; i < 200; i += 1) cap = stepLinkCap(cap, 16);
    expect(cap.cap).toBe(WARM_MAX_LINKS_IN_FLIGHT);
    cap = stepLinkCap(cap, WARM_FRAME_SLOW_MS);
    expect(cap.cap).toBe(Math.ceil(WARM_MAX_LINKS_IN_FLIGHT / 2));
    for (let i = 0; i < 20; i += 1) cap = stepLinkCap(cap, 200);
    expect(cap.cap).toBe(2);
  });

  it('budgets new programs by frame health, never past the cap', () => {
    expect(warmLinkBudget(16, 0, 8)).toBe(Math.min(WARM_NEW_PROGRAMS_PER_FRAME, 8));
    expect(warmLinkBudget(16, 7, 8)).toBe(1);
    expect(warmLinkBudget(16, 8, 8)).toBe(0);
    expect(warmLinkBudget(WARM_FRAME_SLOW_MS, 0, 8)).toBe(1);
    // A stalled frame: one only when nothing links (the load always moves on).
    expect(warmLinkBudget(WARM_FRAME_STALLED_MS, 0, 8)).toBe(1);
    expect(warmLinkBudget(WARM_FRAME_STALLED_MS, 1, 8)).toBe(0);
  });
});

describe('verify stage (ENGINE r2)', () => {
  function machineIO(creates: number[], links = { pending: false }): LoadWarmIO {
    return {
      prepare: () => {},
      collect: () => 0,
      compileSlice: () => 0,
      linksPending: () => links.pending,
      contentComplete: () => true,
      shadowSlice: () => 0,
      verifySlice: () => creates.shift() ?? 0,
      textureSlice: () => 0,
      bufferSlice: () => 0,
      passSlice: () => 0,
      poseSlice: () => 0,
      requestFrame: () => {},
      frameDrawn: () => true,
      programCount: () => 10,
    };
  }

  it('repeats until a pass over the real scene creates nothing', () => {
    const io = machineIO([3, 1, 0]);
    let state = createLoadWarm();
    const stages: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      state = stepLoadWarm(state, io);
      stages.push(state.stage);
    }
    expect(stages.slice(0, 5)).toEqual(['shadows', 'verify', 'verify', 'verify', 'textures']);
  });

  it('is bounded: content that mints a program every pass does not hold the warm', () => {
    const io = machineIO(Array.from({ length: 50 }, () => 2));
    let state = createLoadWarm();
    for (let i = 0; i < 2 + WARM_VERIFY_MAX_PASSES; i += 1) state = stepLoadWarm(state, io);
    expect(state.stage).toBe('textures');
    expect(state.verifyPasses).toBe(WARM_VERIFY_MAX_PASSES);
  });
});

describe('load warm IO: program state and gating (ENGINE r2)', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => 1000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('compiles nothing until the compile gate (content complete) and the program state hold', () => {
    const { gl, programs } = fakeGl();
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    let ready = false;
    const io = makeIO(scene, gl, { compileReady: () => ready });
    settle(io);
    expect(io.compileSlice()).toBeGreaterThan(0);
    expect(programs).toHaveLength(0);
    ready = true;
    expect(io.compileSlice()).toBe(0);
    expect(programs).toHaveLength(1);
    expect(io.compileOpenedAt()).toBe(1000);
  });

  it('a light arriving re-queues every variant and evicts the lit ones compiled before it', () => {
    const { gl } = fakeGl();
    const scene = new THREE.Scene();
    const lit = new THREE.MeshStandardMaterial();
    const unlit = new THREE.MeshBasicMaterial();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), lit), new THREE.Mesh(new THREE.BoxGeometry(), unlit));
    const io = makeIO(scene, gl);
    settle(io);
    io.compileSlice();
    const litDispose = vi.fn();
    const unlitDispose = vi.fn();
    lit.addEventListener('dispose', litDispose);
    unlit.addEventListener('dispose', unlitDispose);
    scene.add(new THREE.PointLight());
    // The signature moved: both variants are fresh again (the machine returns to compile).
    expect(io.collect()).toBe(2);
    expect(litDispose).toHaveBeenCalledTimes(1);
    expect(unlitDispose).not.toHaveBeenCalled();
    expect(io.report().evicted).toBe(1);
    // …and the compile waits for the new state to hold still.
    expect(io.compileSlice()).toBeGreaterThan(0);
  });

  it('an invisible light does not count (three collects visible lights only)', () => {
    const { gl } = fakeGl();
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    const io = makeIO(scene, gl);
    settle(io);
    const light = new THREE.PointLight();
    light.visible = false;
    scene.add(light);
    expect(io.collect()).toBe(0);
  });

  it('verifies against the real scene into the scratch target and reports what it created', () => {
    const { gl, compile, boundAtCompile } = fakeGl();
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    const io = makeIO(scene, gl);
    expect(io.verifySlice()).toBe(1);
    expect(compile).toHaveBeenLastCalledWith(scene, expect.any(THREE.PerspectiveCamera));
    expect((boundAtCompile.at(-1) as THREE.WebGLRenderTarget).isWebGLRenderTarget).toBe(true);
    expect(io.verifySlice()).toBe(0);
  });

  it('compiles the terminal pass for the screen (null target) after the passes', () => {
    const { gl, boundAtCompile } = fakeGl();
    const screen = new THREE.ShaderMaterial();
    const io = makeIO(new THREE.Scene(), gl, { screenMaterials: () => [screen] });
    expect(io.passSlice()).toBe(1);
    expect(boundAtCompile.at(-1)).toBeNull();
    expect(io.passSlice()).toBe(0);
    expect(io.report().screenMaterials).toBe(1);
  });
});

describe('buffer uploads (ENGINE r2)', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => 1000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws byte-budgeted chunks through a private layer and restores every layer and cull flag', () => {
    const { gl } = fakeGl();
    const scene = new THREE.Scene();
    const light = new THREE.DirectionalLight();
    scene.add(light);
    // ~1.2 MB of positions each: two per chunk under the 1.5 MB budget.
    const meshes = Array.from({ length: 3 }, () => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(100_000 * 3), 3));
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      scene.add(mesh);
      return mesh;
    });
    const draws: { visible: THREE.Object3D[]; light: boolean }[] = [];
    const io = makeIO(scene, gl, {
      rawRender: (_scene, camera) => {
        draws.push({
          visible: meshes.filter((mesh) => mesh.layers.test(camera.layers) && mesh.frustumCulled === false),
          light: light.layers.test(camera.layers),
        });
      },
    });
    // ENGINE r4: a step carries at most one draw with a first-drawn material
    // (each mesh here has its own), each draw flushed as its own GPU task.
    let guard = 0;
    while (io.bufferSlice() > 0 && guard < 10) guard += 1;
    expect(draws).toHaveLength(3);
    expect(draws.reduce((sum, draw) => sum + draw.visible.length, 0)).toBe(3);
    // Lights ride along, so the light state (every program key) is the real one.
    expect(draws.every((draw) => draw.light)).toBe(true);
    for (const mesh of meshes) {
      expect(mesh.layers.isEnabled(WARM_BUFFER_LAYER)).toBe(false);
      expect(mesh.frustumCulled).toBe(true);
    }
    expect(light.layers.isEnabled(WARM_BUFFER_LAYER)).toBe(false);
    expect(gl.getRenderTarget()).toBeNull();
    expect(gl.shadowMap.autoUpdate).toBe(true);
  });
});

describe('outside texture uploads during the load (ENGINE r2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('defers initTexture before the handoff and the warm uploads it in its slice', () => {
    let live = false;
    vi.stubGlobal('document', { documentElement: { classList: { contains: (name: string) => live && name === 'world-route-live' } } });
    vi.spyOn(performance, 'now').mockImplementation(() => 1000);
    const { gl, initTexture } = fakeGl();
    const stop = deferExternalUploads(gl);
    const texture = new THREE.Texture();
    texture.image = { width: 4, height: 4 };
    texture.needsUpdate = true;
    gl.initTexture(texture);
    expect(initTexture).not.toHaveBeenCalled();
    const io = makeIO(new THREE.Scene(), gl);
    io.textureSlice();
    expect(initTexture).toHaveBeenCalledWith(texture);
    // After the handoff the wrapper passes straight through.
    live = true;
    const later = new THREE.Texture();
    gl.initTexture(later);
    expect(initTexture).toHaveBeenLastCalledWith(later);
    stop();
  });
});
