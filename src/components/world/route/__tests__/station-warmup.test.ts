import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  COMPILE_HOLD_MAX_MS,
  armStationWarmup,
  compileHeldCount,
  guardCompileFrame,
  isCompileHeld,
  isLeadStation,
  PROGRAMS_WARM_STABLE_FRAMES,
  STATION_TRAVEL_LEAD,
  createProgramsWarmTrack,
  getProgramsWarm,
  MOUNT_SLICE_BUDGET_MS,
  noteProgramsFrame,
  onIdleSlice,
  resetProgramsWarmForTests,
  stepProgramsWarm,
  travelLeadWanted,
  compileShadowVariants,
  compileVariantKey,
  createLoadWarm,
  createLoadWarmIO,
  LOAD_WARM_STAGES,
  loadWarmAllowsDraw,
  markLoadWarmComplete,
  passMaterials,
  postPassesToWarm,
  registerWarmPostPass,
  registerWarmPrepare,
  registeredWarmPostPasses,
  resetLoadWarmRegistriesForTests,
  runWarmPrepare,
  stepLoadWarm,
  WARM_MAX_LINKS_IN_FLIGHT,
  WARM_NEW_PROGRAMS_PER_FRAME,
  WARM_SIGNATURE_STABLE_FRAMES,
  WARM_LINK_CAP_START,
  type LoadWarmIO,
  type LoadWarmState,
  type WarmPose,
} from '../useStationWarmup';
import { postPassesFrom } from '@/lib/route-world/quality';

/**
 * W6 compile guard: a renderable whose shader program is still linking is
 * held back (its layer mask is parked so no camera draws it) instead of its
 * first draw blocking the frame, and is released the moment its programs
 * report ready — or after COMPILE_HOLD_MAX_MS whatever happens.
 *
 * Round 3: the hold no longer touches `visible` — the round-2 accessor was
 * clobbered by N8AO's per-frame visibility snapshot/restore and left the
 * plaza's station content hidden for the session.
 */

interface FakeProgram {
  ready: boolean;
  isReady: () => boolean;
}

function fakeRenderer() {
  const props = new Map<object, { currentProgram?: FakeProgram }>();
  const programs: FakeProgram[] = [];
  const compile = vi.fn((object: THREE.Object3D) => {
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
  });
  const gl = {
    extensions: { has: (name: string) => name === 'KHR_parallel_shader_compile' },
    properties: { get: (object: object) => props.get(object) ?? {} },
    compile,
    compileAsync: vi.fn(() => Promise.resolve()),
    initTexture: vi.fn(),
  };
  return { gl: gl as unknown as THREE.WebGLRenderer, compile, programs, props };
}

type Hook = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, target: object | null) => void;

/** What the renderer would draw: own visibility AND the camera layer test. */
function drawn(object: THREE.Object3D, camera: THREE.Camera): boolean {
  return object.visible && object.layers.test(camera.layers);
}

function frame(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, live = true) {
  guardCompileFrame(gl, scene, live);
  (scene.onBeforeRender as unknown as Hook)(gl, scene, camera, null);
}

function setup() {
  const { gl, compile, programs } = fakeRenderer();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  armStationWarmup(gl, scene, camera);
  frame(gl, scene, camera); // installs the hook, nothing to hold yet
  return { gl, compile, programs, scene, camera };
}

describe('compile guard (useStationWarmup)', () => {
  let now = 0;

  beforeEach(() => {
    now = 1000;
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('window', globalThis);
    // The guard is the POST-handoff safety net: before `world-route-live` the
    // load warm owns every compile and upload (ENGINE r2), so these run live.
    vi.stubGlobal('document', { documentElement: { classList: { contains: (name: string) => name === 'world-route-live' } } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('holds a newcomer whose program is linking and releases it when ready', () => {
    const { gl, compile, programs, scene, camera } = setup();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    scene.add(mesh);
    const heldBefore = compileHeldCount();
    frame(gl, scene, camera);
    expect(compileHeldCount()).toBe(heldBefore + 1);
    expect(isCompileHeld(gl, mesh)).toBe(true);
    expect(drawn(mesh, camera)).toBe(false);
    // The hold never touches `visible`: no accessor, the intent still reads.
    expect(mesh.visible).toBe(true);
    expect(Object.getOwnPropertyDescriptor(mesh, 'visible')?.get).toBeUndefined();
    // One batched compile of the scene for the target (not one per object).
    expect(compile).toHaveBeenCalledWith(scene, camera);

    now += 50;
    frame(gl, scene, camera);
    expect(drawn(mesh, camera)).toBe(false);

    for (const program of programs) program.ready = true;
    now += 50;
    frame(gl, scene, camera);
    expect(drawn(mesh, camera)).toBe(true);
    expect(compileHeldCount()).toBe(heldBefore);
  });

  it('keeps an app visibility write made while held', () => {
    const { gl, programs, scene, camera } = setup();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    scene.add(mesh);
    frame(gl, scene, camera);
    mesh.visible = false; // the app hid it meanwhile
    for (const program of programs) program.ready = true;
    frame(gl, scene, camera);
    expect(mesh.visible).toBe(false);
    mesh.visible = true;
    expect(drawn(mesh, camera)).toBe(true);
  });

  it('survives a per-frame visibility snapshot/restore (the N8AO transparency pass)', () => {
    // Round-3 regression: N8AO's renderTransparency records `visible` for the
    // whole scene, overrides it, renders (the guard runs inside that render)
    // and writes the snapshot back. Under the old accessor hold the snapshot
    // read `false`, so the released mesh stayed hidden for good.
    const { gl, programs, scene, camera } = setup();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    scene.add(mesh);
    const n8aoFrame = () => {
      guardCompileFrame(gl, scene, true);
      const snapshot = new Map<THREE.Object3D, boolean>();
      scene.traverse((object) => {
        snapshot.set(object, object.visible);
      });
      // The newcomer is transparent-aware-visible in the first pass.
      (scene.onBeforeRender as unknown as Hook)(gl, scene, camera, {});
      scene.traverse((object) => {
        if ((object as THREE.Mesh).material) object.visible = false;
      });
      (scene.onBeforeRender as unknown as Hook)(gl, scene, camera, {});
      scene.traverse((object) => {
        object.visible = snapshot.get(object) ?? true;
      });
      (scene.onBeforeRender as unknown as Hook)(gl, scene, camera, null);
    };
    n8aoFrame();
    expect(isCompileHeld(gl, mesh)).toBe(true);
    now += 50;
    n8aoFrame();
    for (const program of programs) program.ready = true;
    now += 50;
    n8aoFrame();
    expect(isCompileHeld(gl, mesh)).toBe(false);
    expect(drawn(mesh, camera)).toBe(true);
  });

  it('a held mesh folded by a static-batch pass, then torn down by revalidate, is drawn', () => {
    const { gl, programs, scene, camera } = setup();
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    group.add(mesh);
    scene.add(group);
    frame(gl, scene, camera);
    expect(isCompileHeld(gl, mesh)).toBe(true);

    // Fake batcher: it reads the mesh's intent (visible), merges it, hides the
    // original; the merged batch is never held, so the batch draws it.
    expect(mesh.visible).toBe(true);
    const merged = new THREE.Mesh(mesh.geometry, mesh.material);
    merged.userData.staticBatch = true;
    scene.add(merged);
    mesh.visible = false;
    now += 50;
    frame(gl, scene, camera);
    expect(isCompileHeld(gl, merged)).toBe(false);
    expect(drawn(merged, camera)).toBe(true);

    // Release while batched: the original stays hidden (the batch owns it).
    for (const program of programs) program.ready = true;
    now += 50;
    frame(gl, scene, camera);
    expect(isCompileHeld(gl, mesh)).toBe(false);
    expect(mesh.visible).toBe(false);

    // Revalidate tears the batch down and re-shows the original: drawn.
    scene.remove(merged);
    mesh.visible = true;
    now += 50;
    frame(gl, scene, camera);
    expect(drawn(mesh, camera)).toBe(true);
    expect(isCompileHeld(gl, mesh)).toBe(false);
  });

  it('never withholds content past COMPILE_HOLD_MAX_MS, and never re-holds it', () => {
    const { gl, scene, camera } = setup();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    scene.add(mesh);
    frame(gl, scene, camera);
    expect(drawn(mesh, camera)).toBe(false);
    now += COMPILE_HOLD_MAX_MS + 1;
    armStationWarmup(gl, scene, camera); // a later crossing re-opens the window
    frame(gl, scene, camera);
    expect(drawn(mesh, camera)).toBe(true);
    // Its program never reported ready; re-detection must not hide it again.
    now += 16;
    frame(gl, scene, camera);
    expect(drawn(mesh, camera)).toBe(true);
    expect(isCompileHeld(gl, mesh)).toBe(false);
  });

  it('recompiles a held mesh whose program was released by a material dispose', () => {
    const { gl, compile, programs, scene, camera } = setup();
    const props = (gl as unknown as { properties: { get: (o: object) => { currentProgram?: FakeProgram } } }).properties;
    const material = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    scene.add(mesh);
    frame(gl, scene, camera);
    expect(isCompileHeld(gl, mesh)).toBe(true);
    const calls = compile.mock.calls.length;

    // three disposes the material: usedTimes → 0, the GL program is deleted
    // (its readiness poll can never turn true) and the properties are reset.
    const stale = programs[0] as FakeProgram & { usedTimes?: number };
    stale.usedTimes = 0;
    delete props.get(material).currentProgram;

    now += 50;
    frame(gl, scene, camera);
    expect(compile.mock.calls.length).toBeGreaterThan(calls); // recompiled
    expect(isCompileHeld(gl, mesh)).toBe(true);
    for (const program of programs) if (program !== stale) program.ready = true;
    now += 50;
    frame(gl, scene, camera);
    expect(isCompileHeld(gl, mesh)).toBe(false);
    expect(drawn(mesh, camera)).toBe(true);
  });

  it('recompiles a stale hold even after the warm window closed (no release into a first-draw stall)', () => {
    const { gl, compile, programs, scene, camera } = setup();
    const props = (gl as unknown as { properties: { get: (o: object) => { currentProgram?: FakeProgram } } }).properties;
    const material = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    scene.add(mesh);
    frame(gl, scene, camera);
    expect(isCompileHeld(gl, mesh)).toBe(true);
    now += 4500; // past WARM_WINDOW_MS, inside COMPILE_HOLD_MAX_MS
    const stale = programs[0] as FakeProgram & { usedTimes?: number };
    stale.usedTimes = 0;
    delete props.get(material).currentProgram;
    const calls = compile.mock.calls.length;
    frame(gl, scene, camera);
    expect(isCompileHeld(gl, mesh)).toBe(true);
    expect(compile.mock.calls.length).toBeGreaterThan(calls);
    for (const program of programs) if (program !== stale) program.ready = true;
    now += 16;
    frame(gl, scene, camera);
    expect(drawn(mesh, camera)).toBe(true);
  });

  it('batches one compile per target however many renderables are held', () => {
    const { gl, compile, scene, camera } = setup();
    for (let i = 0; i < 50; i += 1) scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    const calls = compile.mock.calls.length;
    frame(gl, scene, camera);
    expect(compile.mock.calls.length - calls).toBe(1);
  });

  it('keeps a layer assignment made while held', () => {
    const { gl, programs, scene, camera } = setup();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    scene.add(mesh);
    frame(gl, scene, camera);
    mesh.layers.set(3);
    for (const program of programs) program.ready = true;
    frame(gl, scene, camera);
    expect(mesh.layers.mask).toBe(1 << 3);
  });

  it('holds nothing before the route is live (the load compiles under the hidden canvas)', () => {
    const { gl } = fakeRenderer();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    armStationWarmup(gl, scene, camera);
    frame(gl, scene, camera, false);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    scene.add(mesh);
    frame(gl, scene, camera, false);
    expect(drawn(mesh, camera)).toBe(true);
    expect(isCompileHeld(gl, mesh)).toBe(false);
  });

  it('holds nothing outside a warm window', () => {
    const { gl, scene, camera } = setup();
    now += 60_000;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    scene.add(mesh);
    frame(gl, scene, camera);
    expect(drawn(mesh, camera)).toBe(true);
  });

  it('lead station is exactly one outside the window', () => {
    expect(isLeadStation(0, 1, 4)).toBe(true);
    expect(isLeadStation(3, 4, 4)).toBe(true);
    expect(isLeadStation(1, 1, 4)).toBe(false);
    expect(isLeadStation(-1, 0, 4)).toBe(true);
  });
  it('holds a ready-program renderable until its textures are uploaded, a slice per frame (r4)', () => {
    const { gl, programs, props, scene, camera } = (() => {
      const r = fakeRenderer();
      const sc = new THREE.Scene();
      const cam = new THREE.PerspectiveCamera();
      armStationWarmup(r.gl, sc, cam);
      frame(r.gl, sc, cam);
      return { ...r, scene: sc, camera: cam };
    })();
    const uploads: THREE.Texture[] = [];
    (gl as unknown as { initTexture: (t: THREE.Texture) => void }).initTexture = (texture) => {
      uploads.push(texture);
      (props as Map<object, { __version?: number }>).set(texture, { __version: texture.version });
    };
    const map = new THREE.Texture({ width: 4, height: 4 } as unknown as HTMLImageElement);
    map.needsUpdate = true;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map }));
    scene.add(mesh);
    frame(gl, scene, camera);
    expect(isCompileHeld(gl, mesh)).toBe(true);
    // The guard uploads the held texture in its own frame slice.
    expect(uploads).toContain(map);
    for (const program of programs) program.ready = true;
    now += 16;
    frame(gl, scene, camera);
    expect(isCompileHeld(gl, mesh)).toBe(false);
    expect(drawn(mesh, camera)).toBe(true);
  });

  it('does not release on ready programs while a texture is still off the GPU', () => {
    const { gl, programs, scene, camera } = setup();
    // initTexture is a no-op mock here: the texture never reaches the GPU.
    const map = new THREE.Texture({ width: 4, height: 4 } as unknown as HTMLImageElement);
    map.needsUpdate = true;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map }));
    scene.add(mesh);
    frame(gl, scene, camera);
    for (const program of programs) program.ready = true;
    now += 16;
    frame(gl, scene, camera);
    expect(isCompileHeld(gl, mesh)).toBe(true);
    // …but the hold cap still wins.
    now += COMPILE_HOLD_MAX_MS + 1;
    frame(gl, scene, camera);
    expect(drawn(mesh, camera)).toBe(true);
  });

  it('travel lead is symmetric: k−1 is warmed at k + 0.6 going up as k+1 is at k − 0.6 going down', () => {
    for (const k of [1, 2, 3, 4]) {
      // Up (direction −1) at k + 0.6: the window ending at station k−1.
      expect(travelLeadWanted({ position: k + 0.6, direction: -1 }, k - 1, k - 1)).toBe(true);
      // Down (direction +1) at k − 0.6: the window starting at station k+1.
      expect(travelLeadWanted({ position: k - 0.6, direction: 1 }, k + 1, k + 1)).toBe(true);
      // At rest, the idle lead owns it.
      expect(travelLeadWanted({ position: k + 0.6, direction: 0 }, k - 1, k - 1)).toBe(false);
      // Moving away never pre-mounts.
      expect(travelLeadWanted({ position: k + 0.6, direction: 1 }, k - 1, k - 1)).toBe(false);
      expect(travelLeadWanted({ position: k - 0.6, direction: -1 }, k + 1, k + 1)).toBe(false);
    }
    // Same reach both ways, and not beyond it.
    const d = STATION_TRAVEL_LEAD;
    expect(travelLeadWanted({ position: 3 + d, direction: -1 }, 1, 3)).toBe(true);
    expect(travelLeadWanted({ position: 1 - d, direction: 1 }, 1, 3)).toBe(true);
    expect(travelLeadWanted({ position: 3 + d + 0.01, direction: -1 }, 1, 3)).toBe(false);
    expect(travelLeadWanted({ position: 1 - d - 0.01, direction: 1 }, 1, 3)).toBe(false);
    // Inside the window it is the entry latch's business.
    expect(travelLeadWanted({ position: 2, direction: -1 }, 1, 3)).toBe(false);
    // The r3 plaza upward sweep: the aces window [1,3] from rules (4) latches
    // on the first upward sample, well before smooth reaches 3.6.
    expect(travelLeadWanted({ position: 3.97, direction: -1 }, 1, 3)).toBe(true);
  });

  it('programs-warm latches only after the warm pass, all programs ready, and a stable count', () => {
    const track = createProgramsWarmTrack();
    expect(stepProgramsWarm(track, 10, true, false)).toBe(false);
    expect(stepProgramsWarm(track, 12, true, true)).toBe(false); // count still rising
    for (let i = 0; i < PROGRAMS_WARM_STABLE_FRAMES - 1; i += 1) expect(stepProgramsWarm(track, 12, true, true)).toBe(false);
    expect(stepProgramsWarm(track, 12, false, true)).toBe(false); // one still linking
    expect(stepProgramsWarm(track, 12, true, true)).toBe(true);
    // Latched: later programs (station content) are the guard's business.
    expect(stepProgramsWarm(track, 30, false, true)).toBe(true);
  });

  it('prepares every caster\'s shadow variants without a draw (hidden pre-mounts included), deduped, settings restored', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const sun = new THREE.DirectionalLight();
    sun.castShadow = true;
    const lamp = new THREE.PointLight();
    lamp.castShadow = true;
    const plain = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    plain.castShadow = true;
    const twin = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    twin.castShadow = true; // same variant as `plain`
    const leaf = new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, alphaTest: 0.5, map: new THREE.Texture() }),
    );
    leaf.castShadow = true;
    const hidden = new THREE.Group();
    hidden.visible = false;
    const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    skinned.castShadow = true;
    hidden.add(skinned);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    scene.add(sun, lamp, plain, twin, leaf, hidden, receiver);

    const { gl, compile } = fakeRenderer();
    scene.fog = new THREE.FogExp2(0xffffff, 0.01);
    const sceneFog = scene.fog;
    const seenDuringCompile: { fog: unknown; bound: unknown; proxies: THREE.Object3D[]; target: unknown }[] = [];
    let bound: unknown = null;
    const host = gl as unknown as Record<string, unknown>;
    Object.assign(host, {
      shadowMap: { enabled: true, type: THREE.PCFShadowMap },
      getRenderTarget: () => bound,
      setRenderTarget: (next: unknown) => {
        bound = next;
      },
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      info: { programs: [] },
    });
    compile.mockImplementationOnce((object: THREE.Object3D, ...rest: unknown[]) => {
      const target = rest[1];
      seenDuringCompile.push({ fog: scene.fog, bound, proxies: [...object.children], target });
      return new Set<THREE.Material>();
    });

    const prepared = compileShadowVariants(gl, [plain, twin, leaf, skinned, receiver], scene, camera);
    expect(compile).toHaveBeenCalledTimes(1);
    const call = seenDuringCompile[0];
    // Compiled against the REAL scene's lights, as the shadow pass keys it:
    // a render target bound (linear output) and no fog; both restored.
    expect(call.target).toBe(scene);
    expect((call.bound as THREE.WebGLRenderTarget | null)?.isWebGLRenderTarget).toBe(true);
    expect(call.fog).toBeNull();
    expect(bound).toBeNull();
    expect(scene.fog).toBe(sceneFog);
    // plain/twin share variants: depth + distance for mesh, leaf, skinned = 6 proxies.
    expect(call.proxies).toHaveLength(6);
    expect(call.proxies.filter((p) => (p as THREE.SkinnedMesh).isSkinnedMesh)).toHaveLength(2);
    const leafDepth = prepared.get(leaf)?.find((m) => (m as THREE.MeshDepthMaterial).isMeshDepthMaterial) as THREE.MeshDepthMaterial;
    expect(leafDepth.side).toBe(THREE.DoubleSide);
    expect(leafDepth.alphaTest).toBe(0.5);
    expect(leafDepth.map).toBe((leaf.material as THREE.MeshStandardMaterial).map);
    const plainDepth = prepared.get(plain)?.find((m) => (m as THREE.MeshDepthMaterial).isMeshDepthMaterial);
    expect(plainDepth?.side).toBe(THREE.BackSide); // FrontSide casters render back faces
    expect(prepared.get(twin)).toEqual(prepared.get(plain));
    expect(prepared.has(receiver)).toBe(false);
    expect(prepared.get(skinned)).toHaveLength(2);

    // Already prepared: nothing new to compile.
    compileShadowVariants(gl, [plain, leaf, skinned], scene, camera);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('prepares nothing when shadows are off or no light casts', () => {
    const scene = new THREE.Scene();
    const caster = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    caster.castShadow = true;
    scene.add(new THREE.DirectionalLight(), caster);
    const { gl, compile } = fakeRenderer();
    Object.assign(gl as unknown as Record<string, unknown>, {
      shadowMap: { enabled: true, type: THREE.PCFShadowMap },
      getRenderTarget: () => null,
    });
    expect(compileShadowVariants(gl, [caster], scene, new THREE.PerspectiveCamera()).size).toBe(0);
    expect(compile).not.toHaveBeenCalled();
  });

  it('a held shadow caster is released only once its shadow programs are linked too', () => {
    const { gl, programs, scene, camera } = setup();
    Object.assign(gl as unknown as Record<string, unknown>, {
      shadowMap: { enabled: true, type: THREE.PCFShadowMap },
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
    });
    const sun = new THREE.DirectionalLight();
    sun.castShadow = true;
    scene.add(sun);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    mesh.castShadow = true;
    scene.add(mesh);
    frame(gl, scene, camera);
    expect(isCompileHeld(gl, mesh)).toBe(true);
    // Main program + the depth variant.
    expect(programs.length).toBeGreaterThanOrEqual(2);
    const [main, ...rest] = programs;
    main.ready = true;
    frame(gl, scene, camera);
    expect(isCompileHeld(gl, mesh)).toBe(true); // shadow program still linking
    for (const program of rest) program.ready = true;
    frame(gl, scene, camera);
    expect(isCompileHeld(gl, mesh)).toBe(false);
  });

  it('programs-warm (trace) latches only after the load warm completed, all programs ready, 2 stable frames', () => {
    resetProgramsWarmForTests();
    const { gl, programs, compile } = fakeRenderer();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    Object.assign(gl as unknown as Record<string, unknown>, { info: { programs } });
    noteProgramsFrame(gl, scene, camera); // new renderer: tracked — and D23: nothing armed
    vi.advanceTimersByTime(1000);
    for (let i = 0; i < 6; i += 1) noteProgramsFrame(gl, scene, camera);
    expect(compile).not.toHaveBeenCalled(); // no whole-scene first-frame warm any more
    expect(getProgramsWarm()).toBe(false); // the load warm has not completed
    markLoadWarmComplete(gl, scene, camera);
    let frames = 0;
    while (!getProgramsWarm() && frames < 10) {
      noteProgramsFrame(gl, scene, camera);
      frames += 1;
    }
    expect(getProgramsWarm()).toBe(true);
    expect(frames).toBeGreaterThanOrEqual(1);
    resetProgramsWarmForTests();
  });

  it('an idle slice mounts only with >= MOUNT_SLICE_BUDGET_MS of idle time, or on its timeout', () => {
    const callbacks: ((deadline: { timeRemaining: () => number; didTimeout: boolean }) => void)[] = [];
    vi.stubGlobal('requestIdleCallback', (cb: (typeof callbacks)[number]) => {
      callbacks.push(cb);
      return callbacks.length;
    });
    vi.stubGlobal('cancelIdleCallback', () => {});
    const run = vi.fn();
    onIdleSlice(run, MOUNT_SLICE_BUDGET_MS, 400);
    callbacks.shift()?.({ timeRemaining: () => 2, didTimeout: false });
    expect(run).not.toHaveBeenCalled(); // too short a slice: re-requested
    callbacks.shift()?.({ timeRemaining: () => 9, didTimeout: false });
    expect(run).toHaveBeenCalledTimes(1);
    onIdleSlice(run, MOUNT_SLICE_BUDGET_MS, 400);
    callbacks.shift()?.({ timeRemaining: () => 0, didTimeout: true });
    expect(run).toHaveBeenCalledTimes(2); // a busy thread still completes the row
  });
});

/**
 * D23 load warm ceremony (LOOK-PLAN §2 G3): one ordered pass per generation,
 * every stage a per-frame slice. The machine is pure over `LoadWarmIO`; the
 * three.js IO is exercised below against the fake renderer.
 */
interface FakeWarm {
  io: LoadWarmIO;
  log: string[];
  set: (patch: Partial<FakeWarmConfig>) => void;
  config: FakeWarmConfig;
}

interface FakeWarmConfig {
  queued: number;
  compileQueue: number;
  links: number;
  complete: boolean;
  casters: number;
  textures: number;
  passes: number;
  poses: number;
  programs: number;
  drawn: boolean;
  /** Programs each verification pass creates, in order (then 0). */
  verifyCreates: number[];
  buffers: number;
}

function fakeWarm(initial: Partial<FakeWarmConfig> = {}): FakeWarm {
  const config: FakeWarmConfig = {
    queued: 10,
    compileQueue: 0,
    links: 0,
    complete: true,
    casters: 30,
    textures: 5,
    passes: 2,
    poses: 5,
    programs: 40,
    drawn: false,
    verifyCreates: [],
    buffers: 25,
    ...initial,
  };
  const log: string[] = [];
  const io: LoadWarmIO = {
    prepare: () => log.push('prepare'),
    collect: () => {
      log.push('collect');
      const fresh = config.queued;
      config.compileQueue += fresh;
      config.queued = 0;
      return fresh;
    },
    compileSlice: () => {
      log.push('compile');
      config.compileQueue = Math.max(0, config.compileQueue - 4);
      return config.compileQueue;
    },
    linksPending: () => config.links > 0,
    contentComplete: () => config.complete,
    shadowSlice: () => {
      log.push('shadows');
      config.casters = Math.max(0, config.casters - 24);
      return config.casters;
    },
    verifySlice: () => {
      log.push('verify');
      return config.verifyCreates.shift() ?? 0;
    },
    bufferSlice: () => {
      log.push('buffers');
      config.buffers = Math.max(0, config.buffers - 10);
      return config.buffers;
    },
    textureSlice: () => {
      log.push('textures');
      config.textures = Math.max(0, config.textures - 2);
      return config.textures;
    },
    passSlice: () => {
      log.push('passes');
      config.passes = Math.max(0, config.passes - 1);
      return config.passes;
    },
    poseSlice: () => {
      log.push('poses');
      config.poses = Math.max(0, config.poses - 1);
      return config.poses;
    },
    requestFrame: () => log.push('requestFrame'),
    frameDrawn: () => config.drawn,
    programCount: () => config.programs,
  };
  return { io, log, config, set: (patch) => Object.assign(config, patch) };
}

function runWarm(fake: FakeWarm, maxFrames = 200): { state: LoadWarmState; stages: string[]; frames: number } {
  let state = createLoadWarm();
  const stages: string[] = [state.stage];
  let frames = 0;
  while (state.stage !== 'done' && frames < maxFrames) {
    state = stepLoadWarm(state, fake.io);
    if (state.stage === 'frame' && state.frameRequested) fake.set({ drawn: true });
    if (stages[stages.length - 1] !== state.stage) stages.push(state.stage);
    frames += 1;
  }
  return { state, stages, frames };
}

describe('load warm ceremony (D23, useStationWarmup)', () => {
  afterEach(() => {
    resetLoadWarmRegistriesForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('runs the stages in the plan order: compile → shadows → verify → textures → buffers → passes → poses → frame → settle → done', () => {
    const { stages, state } = runWarm(fakeWarm());
    expect(stages).toEqual([...LOAD_WARM_STAGES]);
    expect(state.compiled && state.uploaded && state.warm).toBe(true);
  });

  it('prepares (paint sweep, station-0 uniforms) before it collects or compiles, every frame', () => {
    const fake = fakeWarm();
    runWarm(fake);
    const firstCompile = fake.log.indexOf('compile');
    expect(fake.log.indexOf('prepare')).toBeLessThan(fake.log.indexOf('collect'));
    expect(fake.log.indexOf('collect')).toBeLessThan(firstCompile);
    // Exactly one slice of one stage per frame, each frame opened by prepare + collect.
    const frames = fake.log.join(' ').split('prepare collect').slice(1);
    for (const frame of frames) {
      const slices = frame.trim().split(' ').filter((call) => call !== 'requestFrame' && call !== '');
      expect(slices.length).toBeLessThanOrEqual(2); // settle reads textures as its check
    }
  });

  it('one slice per frame: the compile queue drains over several frames, never in one batch', () => {
    const fake = fakeWarm({ queued: 30 });
    runWarm(fake);
    expect(fake.log.filter((call) => call === 'compile').length).toBeGreaterThanOrEqual(8); // 30 variants, 4 per slice
    expect(fake.log.filter((call) => call === 'shadows').length).toBe(2); // 30 casters, 24 per slice
  });

  it('waits in compile until the content is complete (assets idle AND residency) and links landed', () => {
    const fake = fakeWarm({ complete: false });
    let state = createLoadWarm();
    for (let i = 0; i < 20; i += 1) state = stepLoadWarm(state, fake.io);
    expect(state.stage).toBe('compile');
    fake.set({ complete: true, links: 3 });
    state = stepLoadWarm(state, fake.io);
    expect(state.stage).toBe('compile'); // links still in flight
    fake.set({ links: 0 });
    state = stepLoadWarm(state, fake.io);
    expect(state.stage).toBe('shadows');
  });

  it('compiled rises after shadows AND the post passes; uploaded after textures AND the pose renders', () => {
    const fake = fakeWarm();
    let state = createLoadWarm();
    const seen: { stage: string; compiled: boolean; uploaded: boolean }[] = [];
    while (state.stage !== 'done') {
      state = stepLoadWarm(state, fake.io);
      if (state.stage === 'frame' && state.frameRequested) fake.set({ drawn: true });
      seen.push({ stage: state.stage, compiled: state.compiled, uploaded: state.uploaded });
    }
    const firstCompiled = seen.findIndex((entry) => entry.compiled);
    const firstUploaded = seen.findIndex((entry) => entry.uploaded);
    expect(seen[firstCompiled].stage).toBe('poses');
    expect(seen.slice(0, firstCompiled).some((entry) => entry.stage === 'passes')).toBe(true);
    expect(seen[firstUploaded].stage).toBe('frame');
    expect(fake.log.filter((call) => call === 'poses')).toHaveLength(5); // one pose render per frame
  });

  it('renders every pass the start rung and every LOWER rung can draw (the governor only steps down)', () => {
    const entry = (key: 'rich' | 'lean' | 'ao') => ({ key, materials: () => [] });
    registerWarmPostPass(entry('rich'));
    registerWarmPostPass(entry('lean'));
    registerWarmPostPass(entry('ao'));
    const keys = (start: number) => postPassesToWarm(registeredWarmPostPasses(), postPassesFrom(start)).map((e) => e.key);
    expect(keys(0)).toEqual(['rich', 'lean', 'ao']);
    expect(keys(1)).toEqual(['rich', 'lean']);
    expect(keys(2)).toEqual(['lean']);
  });

  it('holds real draws until the frame stage, requests exactly one, then settles on a stable program count', () => {
    const fake = fakeWarm();
    let state = createLoadWarm();
    while (state.stage !== 'frame') {
      expect(loadWarmAllowsDraw(state)).toBe(false);
      state = stepLoadWarm(state, fake.io);
    }
    expect(loadWarmAllowsDraw(state)).toBe(false); // entered, not yet requested
    state = stepLoadWarm(state, fake.io);
    expect(state.frameRequested).toBe(true);
    expect(loadWarmAllowsDraw(state)).toBe(true);
    state = stepLoadWarm(state, fake.io); // no frame drawn yet: waits
    expect(state.stage).toBe('frame');
    fake.set({ drawn: true });
    state = stepLoadWarm(state, fake.io);
    expect(state.stage).toBe('settle');
    fake.set({ programs: 41 }); // the frame linked one more: the count must hold still again
    for (let i = 0; i < 2; i += 1) state = stepLoadWarm(state, fake.io);
    expect(state.warm).toBe(false);
    state = stepLoadWarm(state, fake.io);
    state = stepLoadWarm(state, fake.io);
    expect(state.warm).toBe(true);
    expect(fake.log.filter((call) => call === 'requestFrame')).toHaveLength(1);
  });

  it('content that mounts late sends the warm back to compile; the milestones stay reached', () => {
    const fake = fakeWarm();
    let state = createLoadWarm();
    while (state.stage !== 'poses') state = stepLoadWarm(state, fake.io);
    expect(state.compiled).toBe(true);
    fake.set({ queued: 30 });
    state = stepLoadWarm(state, fake.io);
    expect(state.stage).toBe('compile');
    expect(state.compiled).toBe(true);
    expect(state.warm).toBe(false);
  });

  it('prepare hooks run in registration order and a throwing hook never stops the warm', () => {
    const calls: string[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerWarmPrepare(() => calls.push('paint-sweep'));
    const release = registerWarmPrepare(() => {
      throw new Error('boom');
    });
    registerWarmPrepare(() => calls.push('station-0-uniforms'));
    const scene = new THREE.Scene();
    runWarmPrepare(scene, new THREE.PerspectiveCamera(), {} as THREE.WebGLRenderer);
    expect(calls).toEqual(['paint-sweep', 'station-0-uniforms']);
    release();
    calls.length = 0;
    runWarmPrepare(scene, new THREE.PerspectiveCamera(), {} as THREE.WebGLRenderer);
    expect(calls).toEqual(['paint-sweep', 'station-0-uniforms']);
  });
});

describe('load warm IO (three.js slices, D23)', () => {
  function warmRenderer() {
    const base = fakeRenderer();
    let bound: unknown = null;
    const rendered: { fov: number; x: number; target: unknown }[] = [];
    Object.assign(base.gl as unknown as Record<string, unknown>, {
      info: { programs: base.programs },
      shadowMap: { enabled: true, type: THREE.PCFShadowMap },
      getRenderTarget: () => bound,
      setRenderTarget: (next: unknown) => {
        bound = next;
      },
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      domElement: { width: 1440, height: 900 },
      clear: vi.fn(),
    });
    return { ...base, rendered, bound: () => bound };
  }

  function io(scene: THREE.Scene, renderer: ReturnType<typeof warmRenderer>, poses: WarmPose[] = []) {
    return createLoadWarmIO({
      gl: renderer.gl,
      scene,
      camera: new THREE.PerspectiveCamera(),
      contentComplete: () => true,
      poses: () => poses,
      rawRender: (_scene, camera) =>
        renderer.rendered.push({
          fov: (camera as THREE.PerspectiveCamera).fov,
          x: camera.position.x,
          target: renderer.bound(),
        }),
      requestFrame: () => {},
      frameDrawn: () => true,
      passes: () => [],
      signal: () => {},
    });
  }

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => 1000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('compiles through proxies into a bound render target, a few new programs per frame, never past the link cap', () => {
    const renderer = warmRenderer();
    const scene = new THREE.Scene();
    const total = WARM_MAX_LINKS_IN_FLIGHT + 3 * WARM_NEW_PROGRAMS_PER_FRAME;
    for (let i = 0; i < total; i += 1) scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    const warm = io(scene, renderer);
    expect(warm.collect()).toBe(total);
    expect(warm.collect()).toBe(0); // idempotent
    // The compile waits for the scene's program state (lights, environment,
    // fog) to hold still for WARM_SIGNATURE_STABLE_FRAMES frames.
    expect(warm.compileSlice()).toBe(total);
    expect(renderer.programs).toHaveLength(0);
    for (let i = 0; i < WARM_SIGNATURE_STABLE_FRAMES; i += 1) warm.collect();
    const boundDuring: unknown[] = [];
    renderer.compile.mockImplementation((object: THREE.Object3D) => {
      boundDuring.push(renderer.bound());
      object.traverse((node) => {
        const material = (node as THREE.Mesh).material as THREE.Material | undefined;
        if (!material) return;
        const entry = renderer.props.get(material) ?? {};
        if (!entry.currentProgram) {
          const program = { ready: false, isReady: () => program.ready };
          renderer.programs.push(program);
          entry.currentProgram = program;
        }
        renderer.props.set(material, entry);
      });
      return new Set<THREE.Material>();
    });
    const first = Math.min(WARM_NEW_PROGRAMS_PER_FRAME, WARM_LINK_CAP_START);
    expect(warm.compileSlice()).toBe(total - first);
    expect(renderer.programs).toHaveLength(first);
    expect((boundDuring[0] as THREE.WebGLRenderTarget).isWebGLRenderTarget).toBe(true);
    expect(renderer.bound()).toBeNull(); // binding restored
    // The adaptive cap starts at WARM_LINK_CAP_START (no frames stepped yet).
    const cap = WARM_LINK_CAP_START;
    for (let i = 0; i < 8 && renderer.programs.length < cap; i += 1) warm.compileSlice();
    expect(renderer.programs).toHaveLength(cap);
    // The cap: nothing new is issued while `cap` links run.
    expect(warm.compileSlice()).toBe(total - cap);
    expect(renderer.programs).toHaveLength(cap);
    expect(warm.linksPending()).toBe(true);
    for (const program of renderer.programs) program.ready = true;
    expect(warm.linksPending()).toBe(false);
    warm.compileSlice();
    expect(renderer.programs).toHaveLength(cap + Math.min(cap, WARM_NEW_PROGRAMS_PER_FRAME));
    // The real scene was never handed to compile (only proxies / slices).
    expect(renderer.compile.mock.calls.some(([object]) => object === scene)).toBe(false);
    warm.dispose();
  });

  it('renders each frozen station pose once, offscreen at quarter resolution, one per slice', () => {
    const renderer = warmRenderer();
    const scene = new THREE.Scene();
    const poses: WarmPose[] = [0, 1, 2, 3, 4].map((i) => ({
      position: { x: i, y: 2, z: 10 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      fov: 40 + i,
    }));
    const warm = io(scene, renderer, poses);
    const remaining: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      remaining.push(warm.poseSlice());
      expect(renderer.rendered).toHaveLength(i + 1);
    }
    expect(remaining).toEqual([4, 3, 2, 1, 0]);
    expect(warm.poseSlice()).toBe(0);
    expect(renderer.rendered).toHaveLength(5);
    const first = renderer.rendered[0];
    const target = first.target as THREE.WebGLRenderTarget;
    expect(target.isWebGLRenderTarget).toBe(true);
    expect(target.width).toBe(360);
    expect(target.height).toBe(225);
    expect(renderer.rendered[3].fov).toBe(43);
    expect(renderer.rendered[3].x).toBe(3);
    expect(renderer.bound()).toBeNull();
    warm.dispose();
  });

  it('a pass material walk finds the pass own materials and never the excluded world scene', () => {
    const world = new THREE.Scene();
    const worldMaterial = new THREE.MeshStandardMaterial();
    world.add(new THREE.Mesh(new THREE.BoxGeometry(), worldMaterial));
    const own = new THREE.ShaderMaterial();
    const inner = new THREE.ShaderMaterial();
    const passScene = new THREE.Scene();
    passScene.add(new THREE.Mesh(new THREE.PlaneGeometry(), own));
    const pass = { scene: world, fullscreen: passScene, effects: [{ blur: { material: inner } }] };
    const found = passMaterials(pass, [world]);
    expect(found).toContain(own);
    expect(found).toContain(inner);
    expect(found).not.toContain(worldMaterial);
  });

  it('clears each pose target before its render (the composer parks autoClear off)', () => {
    const renderer = warmRenderer();
    const warm = io(new THREE.Scene(), renderer, [
      { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, fov: 45 },
    ]);
    warm.poseSlice();
    const clear = (renderer.gl as unknown as { clear: ReturnType<typeof vi.fn> }).clear;
    expect(clear).toHaveBeenCalledWith(true, true, false);
    warm.dispose();
  });

  it('a compile variant is the material plus the object kind (skinned, instanced, plain differ)', () => {
    const material = new THREE.MeshStandardMaterial();
    const geometry = new THREE.BoxGeometry();
    const plain = compileVariantKey(new THREE.Mesh(geometry, material), material);
    expect(compileVariantKey(new THREE.Mesh(geometry, material), material)).toBe(plain);
    expect(compileVariantKey(new THREE.SkinnedMesh(geometry, material), material)).not.toBe(plain);
    expect(compileVariantKey(new THREE.InstancedMesh(geometry, material, 2), material)).not.toBe(plain);
    const other = new THREE.MeshStandardMaterial();
    expect(compileVariantKey(new THREE.Mesh(geometry, other), other)).not.toBe(plain);
  });
});
