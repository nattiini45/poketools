import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { RESIDENCY_QUIET_MS } from '@/lib/route-world/residency';
import { revealGate } from '@/lib/route-world/ball-loader-state';
import {
  createLoadWarm,
  createLoadWarmIO,
  renderTargetsOf,
  stepLoadWarm,
  WARM_BUFFER_NEW_MATERIALS,
  WARM_FENCE_MAX_MS,
  type LoadWarmIO,
  type LoadWarmState,
  type WarmDataFace,
} from '../useStationWarmup';
import {
  dataFaceEntries,
  getDataFaceLog,
  getResidencySnapshot,
  isResidencyComplete,
  noteDataFaceEvent,
  registerDataFace,
  registerPopulation,
  resetResidencyForTests,
} from '../residency-store';
import { STALL_PROGRESS_SIGNALS } from '../scene-progress';
import {
  releaseDataTextureDisposals,
  RETAIN_DATA_TEXTURE_MAX_BYTES,
  retainDataTextureDisposals,
} from '../QualityGovernor';
import { canvasSource } from './route-sources';

/**
 * ENGINE r4 contracts (LOOK round 4):
 * - CAR r3 veto (blank plaza LED boards at reveal): a data face is a
 *   reveal precondition — a hold that goes pending again on a repaint keeps
 *   residency (a live gate input) incomplete, and the warm's `uploaded` /
 *   `warm` never rise while a face is not painted, shown and uploaded;
 * - CAR r3 cadence: GPU backpressure — the warm issues nothing while its
 *   last step's fence is unsignalled (bounded), and one `buffers` step
 *   carries at most one first-drawn executable;
 * - CAR r3 quiet probe, governor leg: small DataTextures disposed by a rung
 *   step are retained (no GPU deallocation in the judged window).
 */

const ROUTE = join(process.cwd(), 'src', 'components', 'world', 'route');
const read = (file: string) => readFileSync(file, 'utf8');

describe('residency holds re-open (ENGINE r4, CAR r3 veto)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetResidencyForTests();
  });
  afterEach(() => {
    resetResidencyForTests();
    vi.useRealTimers();
  });

  it('a committed hold that re-opens makes residency incomplete until it commits again', () => {
    const board = registerPopulation('face:board:pulse');
    board.commit();
    vi.advanceTimersByTime(RESIDENCY_QUIET_MS + 1);
    expect(isResidencyComplete()).toBe(true);
    // The board repaints (its pages back to null): pending again.
    board.reopen();
    expect(isResidencyComplete()).toBe(false);
    expect(getResidencySnapshot().pending).toBe(1);
    vi.advanceTimersByTime(10 * RESIDENCY_QUIET_MS);
    expect(isResidencyComplete()).toBe(false);
    board.commit();
    vi.advanceTimersByTime(RESIDENCY_QUIET_MS + 1);
    expect(isResidencyComplete()).toBe(true);
    board.release();
  });

  it('holding the board\'s first paint keeps the reveal gate shut', () => {
    const scenery = registerPopulation('plaza:scenery');
    scenery.commit();
    // The face registers pending and its first page never lands.
    const face = registerPopulation('face:board:pulse');
    vi.advanceTimersByTime(10 * RESIDENCY_QUIET_MS);
    const gate = (resident: boolean) =>
      revealGate({
        nowMs: 5_000,
        presented: true,
        assetsIdle: true,
        residencyComplete: resident,
        sceneWarm: true,
        begunAtMs: 0,
        deadlineMs: 20_000,
      });
    expect(isResidencyComplete()).toBe(false);
    expect(gate(isResidencyComplete())).toBe('wait');
    face.commit();
    vi.advanceTimersByTime(RESIDENCY_QUIET_MS + 1);
    expect(gate(isResidencyComplete())).toBe('arm');
  });

  it('data faces register, read through, and log their events (the render-path readout)', () => {
    const readout = { painted: false, object: null, textures: [] };
    const release = registerDataFace({ id: 'board:pulse', read: () => readout });
    expect(dataFaceEntries().map((entry) => entry.id)).toEqual(['board:pulse']);
    expect(dataFaceEntries()[0].read().painted).toBe(false);
    noteDataFaceEvent('board:pulse', 'loaded:2');
    expect(getDataFaceLog().at(-1)).toMatchObject({ id: 'board:pulse', event: 'loaded:2' });
    release();
    expect(dataFaceEntries()).toHaveLength(0);
  });
});

function fakeIO(overrides: Partial<LoadWarmIO> = {}): LoadWarmIO {
  return {
    prepare: () => {},
    collect: () => 0,
    compileSlice: () => 0,
    linksPending: () => false,
    contentComplete: () => true,
    shadowSlice: () => 0,
    verifySlice: () => 0,
    textureSlice: () => 0,
    bufferSlice: () => 0,
    passSlice: () => 0,
    poseSlice: () => 0,
    requestFrame: () => {},
    frameDrawn: () => true,
    programCount: () => 10,
    ...overrides,
  };
}

function run(io: LoadWarmIO, frames: number, from: LoadWarmState = createLoadWarm()): LoadWarmState {
  let state = from;
  for (let i = 0; i < frames && state.stage !== 'done'; i += 1) state = stepLoadWarm(state, io);
  return state;
}

describe('the warm: data faces gate `uploaded` and the settle (ENGINE r4)', () => {
  it('never raises `uploaded` or settles while a face is not ready, and does once it is', () => {
    let facesNotReady = 1;
    const io = fakeIO({ facesSlice: () => facesNotReady });
    let state = run(io, 60);
    expect(state.stage).toBe('poses');
    expect(state.uploaded).toBe(false);
    expect(state.warm).toBe(false);
    facesNotReady = 0;
    state = run(io, 60, state);
    expect(state.uploaded).toBe(true);
    expect(state.warm).toBe(true);
    expect(state.stage).toBe('done');
  });
});

describe('the warm: the post chain targets before the first real frame (ENGINE r4)', () => {
  it('holds `compiled` (and the poses) until every composer target is cleared, one per step', () => {
    let targets = 3;
    const calls: number[] = [];
    const io = fakeIO({
      targetSlice: () => {
        calls.push(targets);
        targets = Math.max(0, targets - 1);
        return targets;
      },
    });
    const state = run(io, 60);
    expect(calls).toEqual([3, 2, 1]);
    expect(state.stage).toBe('done');
    expect(state.compiled).toBe(true);
  });

  it('renderTargetsOf finds nested targets once and skips scenes, materials and textures', () => {
    const a = new THREE.WebGLRenderTarget(8, 8);
    const b = new THREE.WebGLRenderTarget(4, 4);
    const scene = new THREE.Scene();
    const composer = { inputBuffer: a, outputBuffer: a, passes: [{ effects: [{ blur: { targets: [b] } }], scene, material: new THREE.MeshBasicMaterial() }] };
    expect(renderTargetsOf(composer)).toEqual([a, b]);
  });
});

describe('the warm: GPU backpressure (ENGINE r4)', () => {
  it('skips steps while the last fence is unsignalled and fences after every step', () => {
    let idle = false;
    const calls: string[] = [];
    const io = fakeIO({
      gpuIdle: () => idle,
      fenceGpu: () => calls.push('fence'),
      prepare: () => calls.push('prepare'),
    });
    let state = createLoadWarm();
    state = stepLoadWarm(state, io);
    state = stepLoadWarm(state, io);
    expect(calls).toEqual([]);
    expect(state.frames).toBe(2);
    expect(state.stage).toBe('compile');
    idle = true;
    state = stepLoadWarm(state, io);
    expect(calls).toEqual(['prepare', 'fence']);
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
  return { gl: gl as unknown as THREE.WebGLRenderer, context, syncs };
}

function ioFor(gl: THREE.WebGLRenderer, scene: THREE.Scene, faces: () => readonly WarmDataFace[] = () => [], rawRender = () => {}) {
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
    faces,
  });
}

describe('createLoadWarmIO: fences, faces and first draws (ENGINE r4)', () => {
  let now = 1000;
  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('waits on its fence until signalled, and gives up after WARM_FENCE_MAX_MS', () => {
    const { gl, syncs, context } = fencedGl();
    const io = ioFor(gl, new THREE.Scene());
    expect(io.gpuIdle?.()).toBe(true);
    io.fenceGpu?.();
    expect(context.flush).toHaveBeenCalled();
    now += 16;
    expect(io.gpuIdle?.()).toBe(false);
    syncs[0].signaled = true;
    now += 16;
    expect(io.gpuIdle?.()).toBe(true);
    expect(context.deleteSync).toHaveBeenCalledTimes(1);
    // A fence that never signals is bounded.
    io.fenceGpu?.();
    now += WARM_FENCE_MAX_MS + 1;
    expect(io.gpuIdle?.()).toBe(true);
  });

  it('facesSlice: not painted, not shown and not uploaded faces count; missing textures are uploaded', () => {
    const { gl } = fencedGl();
    const scene = new THREE.Scene();
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    scene.add(panel);
    const page = new THREE.Texture({ width: 4, height: 4 } as unknown as HTMLImageElement);
    page.needsUpdate = true;
    let face: WarmDataFace = { id: 'board:pulse', painted: false, object: null, textures: [] };
    const io = ioFor(gl, scene, () => [face]);
    expect(io.facesSlice()).toBe(1);
    face = { ...face, painted: true, object: panel, textures: [page] };
    panel.visible = false;
    expect(io.facesSlice()).toBe(1);
    panel.visible = true;
    expect(io.facesSlice()).toBe(0);
    expect(gl.initTexture).toHaveBeenCalledWith(page);
    // Unmounted: not ready again.
    scene.remove(panel);
    expect(io.facesSlice()).toBe(1);
  });

  it('one buffers step carries at most one first-drawn executable; repeats of a drawn layout ride along', () => {
    const { gl } = fencedGl();
    const scene = new THREE.Scene();
    const shared = new THREE.MeshStandardMaterial();
    const geometry = new THREE.BoxGeometry();
    const meshes = [
      new THREE.Mesh(geometry, shared),
      new THREE.Mesh(geometry, shared),
      new THREE.Mesh(geometry, shared),
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()),
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial()),
    ];
    for (const mesh of meshes) scene.add(mesh);
    const perStep: number[][] = [];
    let current: number[] = [];
    const io = ioFor(gl, scene, () => [], ((_scene: THREE.Scene, camera: THREE.Camera) => {
      current.push(meshes.filter((mesh) => mesh.layers.test(camera.layers)).length);
    }) as () => void);
    let guard = 0;
    for (;;) {
      current = [];
      const left = io.bufferSlice();
      perStep.push(current);
      guard += 1;
      if (left === 0 || guard > 20) break;
    }
    // Three distinct (material, layout) executables: three steps.
    expect(WARM_BUFFER_NEW_MATERIALS).toBe(1);
    expect(perStep.filter((draws) => draws.length > 0)).toHaveLength(3);
    // The first step drew the three meshes that share one executable together.
    expect(perStep[0].reduce((a, b) => a + b, 0)).toBe(3);
    expect(meshes.every((mesh) => !mesh.layers.isEnabled(31))).toBe(true);
  });

  it('`faces` is a stall-detector progress signal', () => {
    expect(STALL_PROGRESS_SIGNALS.has('faces')).toBe(true);
  });
});

describe('governor steps retain small DataTextures (ENGINE r4, quiet probe governor leg)', () => {
  afterEach(() => releaseDataTextureDisposals());

  it('retains a small DataTexture disposal until release; a large one disposes at once', () => {
    retainDataTextureDisposals();
    const small = new THREE.DataTexture(new Uint8Array(64 * 64 * 4), 64, 64);
    const large = new THREE.DataTexture(new Uint8Array(RETAIN_DATA_TEXTURE_MAX_BYTES + 4), RETAIN_DATA_TEXTURE_MAX_BYTES / 4 + 1, 1);
    const onSmall = vi.fn();
    const onLarge = vi.fn();
    small.addEventListener('dispose', onSmall);
    large.addEventListener('dispose', onLarge);
    small.dispose();
    large.dispose();
    expect(onSmall).not.toHaveBeenCalled();
    expect(onLarge).toHaveBeenCalledTimes(1);
    releaseDataTextureDisposals();
    expect(onSmall).toHaveBeenCalledTimes(1);
    // Small canvas textures (a population's VFX / billboard sprite) are retained too.
    retainDataTextureDisposals();
    const sprite = new THREE.CanvasTexture({ width: 64, height: 64 } as unknown as HTMLCanvasElement);
    const onSprite = vi.fn();
    sprite.addEventListener('dispose', onSprite);
    sprite.dispose();
    expect(onSprite).not.toHaveBeenCalled();
    releaseDataTextureDisposals();
    expect(onSprite).toHaveBeenCalledTimes(1);
    expect(Object.prototype.hasOwnProperty.call(THREE.DataTexture.prototype, 'dispose')).toBe(false);
    // Restored: a later disposal goes straight through.
    const later = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const onLater = vi.fn();
    later.addEventListener('dispose', onLater);
    later.dispose();
    expect(onLater).toHaveBeenCalledTimes(1);
  });
});

describe('ENGINE r4 source contracts', () => {
  it('the canvas re-warms a settled-but-unarmed warm, revokes the warm bit, and hands the faces to the warm', () => {
    const canvas = canvasSource();
    expect(canvas).toMatch(/revokeSceneWarm\(generation\)/);
    expect(canvas).toMatch(/faces: \(\) =>\s*dataFaceEntries\(\)/);
    expect(canvas).toMatch(/rewarms < WARM_MAX_REWARMS\) \|\| faces > 0/);
    // The render-path readout carries the face state (the still's sidecar).
    expect(canvas).toMatch(/dataFaces: dataFaceEntries\(\)/);
  });

  it('the plaza boards report their face (painted, panel mounted, every page texture)', () => {
    const board = read(join(process.cwd(), 'src', 'components', 'world', 'evoliga', 'route', 'plaza', 'board', 'Board.tsx'));
    expect(board).toMatch(/useDataFaceResidency\(faceId, \{ painted: textures !== null, object: textures === null \? null : panel, textures: faceTextures \}\)/);
    expect(board).toMatch(/<mesh ref=\{setPanel\}/);
  });

  it('every painted-texture hook holds residency until its CURRENT inputs have painted', () => {
    for (const world of ['sakura', 'mountain', 'clouds']) {
      const hook = read(join(process.cwd(), 'src', 'components', 'world', 'themes', world, 'content', 'use-painted-texture.ts'));
      expect(hook.match(/useResidencyHold\('paint:/g)).toHaveLength(2);
      expect(hook).toMatch(/painted\?\.run !== run/);
    }
    for (const file of ['CenterDesk', 'ChallengeGate', 'DeskHolo']) {
      const source = read(join(process.cwd(), 'src', 'components', 'world', 'evoliga', 'route', 'plaza', `${file}.tsx`));
      expect(source).toMatch(/useResidencyHold\('paint:plaza-/);
    }
  });

  it('the arm reaches the populations off the urgent reveal commit; the theme windows no longer latch (E2)', () => {
    const residency = read(join(ROUTE, 'residency-store.ts'));
    // The ceiling reads the arm; it no longer subscribes to the handoff context.
    expect(residency).not.toMatch(/WorldHandoffContext/);
    expect(residency).toMatch(/const routeSceneLive = getRevealArmedAt\(\) !== null;/);
    expect(residency).toMatch(/startTransition\(\(\) => setArmed\(next\)\)/);
    for (const [world, name] of [['sakura', 'Sakura'], ['mountain', 'Mountain'], ['clouds', 'Clouds']] as const) {
      const hook = read(join(process.cwd(), 'src', 'components', 'world', 'themes', world, 'furniture', `use${name}StationWindow.ts`));
      // ROLLOUT-PLAN §3.2 E2: no post-reveal visibility latch — shown from the ceremony on.
      expect(hook).not.toMatch(/useRevealArmedTransition\(/);
      expect(hook).not.toMatch(/stepShownLatch|themeGroupShown/);
      expect(hook).toMatch(/return \{ mounted: true, shown: true, dormant \};/);
      expect(hook).not.toMatch(/useWorldHandoff/);
    }
    // The arm notifies the progress store (the transition hook's channel).
    const progress = read(join(ROUTE, 'scene-progress.ts'));
    const armed = progress.slice(progress.indexOf('export function noteRevealArmed'), progress.indexOf('export function getRevealArmedAt'));
    expect(armed).toMatch(/notify\(\);/);
  });

  it('the quality readout names the rung and buffer DPR (the 390 @ dpr 2 question)', () => {
    const canvas = canvasSource();
    expect(canvas).toMatch(/rungDpr: resolveDpr\(QUALITY_LADDER\[qualityRef\.current\]\)/);
    expect(canvas).toMatch(/bufferDpr:/);
  });
});
