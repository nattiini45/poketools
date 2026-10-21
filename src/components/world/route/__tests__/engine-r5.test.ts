import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  GOVERNOR,
  governorInLoadGrace,
  INITIAL_GOVERNOR_PRESSURE,
  QUALITY_LADDER,
  stepGovernorPressure,
  type GovernorPressure,
} from '@/lib/route-world/quality';
import { LOADER_MILESTONES, loaderWarmLine } from '@/lib/route-world/ball-loader-state';
import { createLoadWarm, createLoadWarmIO, describeDataFace, stepLoadWarm, type LoadWarmIO } from '../useStationWarmup';
import {
  beginSceneGeneration,
  currentSceneGeneration,
  getScenePhase,
  markScenePresented,
  resetSceneReadiness,
} from '../world-readiness';
import { sceneGenerationKey } from '../WorldStateProvider';
import { getRevealArmedAt, noteRevealArmed, resetSceneProgressForTests } from '../scene-progress';
import { canvasSource } from './route-sources';

/**
 * ENGINE r5 contracts (LOOK round 5):
 * - CAR r4 theme leg: a theme toggle at the floor rung (4) fell to Lite by
 *   `readiness-stall`. The static batcher had merged the plaza board's
 *   PLACEHOLDER panel (a standard material while the new palette's pages
 *   painted), React then reused that same THREE.Mesh for the real shader
 *   panel, and it stayed hidden (`visible = false`): the warm's face check
 *   never cleared. Data faces are never batch candidates now, and a batch
 *   whose original swapped its material or geometry is torn down.
 * - CAR r4 governor: a spike or one camera flight's dense slow frames no
 *   longer step the ladder; sustained pressure still does.
 * - CAR r4 progress: the load warm's step is named on the visible line with
 *   a real count while "n/6" holds one milestone for seconds.
 * - CAR r4 network: the hidden sections' lazy sprites are never requested
 *   while the world is the page (content-visibility).
 * - CAR r4 cadence: per-step GPU time is measured (timer queries) and the
 *   docked sweep is pre-rastered at the reveal's raster scale.
 */

const SRC = join(process.cwd(), 'src');
const ROUTE = join(SRC, 'components', 'world', 'route');
const read = (file: string) => readFileSync(file, 'utf8');

describe('theme toggle at the floor rung (ENGINE r5, CAR r4 theme leg)', () => {
  beforeEach(() => {
    resetSceneReadiness();
    resetSceneProgressForTests();
  });
  afterEach(() => {
    resetSceneReadiness();
    resetSceneProgressForTests();
  });

  it('begins exactly one generation per palette swap, and the new generation is in load grace', () => {
    const day = beginSceneGeneration(sceneGenerationKey('plaza', 'day'));
    expect(day).not.toBeNull();
    expect(markScenePresented()).toBe(true);
    noteRevealArmed(currentSceneGeneration(), performance.now());
    expect(getRevealArmedAt()).not.toBeNull();
    const before = currentSceneGeneration();
    // The palette observer begins the night generation; the (tier, theme,
    // palette) effect then re-asks for the same key in the same round trip.
    expect(beginSceneGeneration(sceneGenerationKey('plaza', 'night'))).toBe(before + 1);
    expect(beginSceneGeneration(sceneGenerationKey('plaza', 'night'))).toBeNull();
    expect(currentSceneGeneration()).toBe(before + 1);
    expect(getScenePhase()).toBe('loading');
    // The previous generation's arm does not end the new one's grace, so the
    // floor rung's slow-frame run cannot exhaust the ladder into Lite mid-load.
    expect(getRevealArmedAt()).toBeNull();
    expect(governorInLoadGrace(null)).toBe(true);
    expect(QUALITY_LADDER.length - 1).toBe(4);
  });

  it('a data face whose panel is hidden keeps the warm from settling (why the batcher must never hide one)', () => {
    const scene = new THREE.Scene();
    const cabinet = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    cabinet.add(panel);
    scene.add(cabinet);
    const face = { id: 'board:pulse', painted: true, object: panel as THREE.Object3D, textures: [] as THREE.Texture[] };
    const gl = {
      getContext: () => null,
      properties: { get: () => ({}) },
      compile: vi.fn(() => new Set()),
      initTexture: vi.fn(),
      info: { programs: [] },
      shadowMap: { enabled: false, autoUpdate: true, needsUpdate: false },
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      domElement: { width: 1440, height: 900 },
      clear: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    const io = createLoadWarmIO({
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
      faces: () => [face],
    });
    expect(io.facesSlice()).toBe(0);
    expect(describeDataFace(gl, face)).toEqual({ shown: true, hiddenAt: null, onGpu: 0 });
    // What the batcher did to the reused mesh after the theme toggle.
    panel.visible = false;
    expect(io.facesSlice()).toBe(1);
    expect(describeDataFace(gl, face)).toMatchObject({ shown: false, hiddenAt: 'Mesh' });
    panel.visible = true;
    cabinet.removeFromParent();
    expect(describeDataFace(gl, face)).toMatchObject({ shown: false, hiddenAt: 'no-scene' });
    io.dispose();
  });

  it('the static batcher never merges a data face and drops a batch whose original swapped its material', () => {
    const canvas = canvasSource();
    const candidate = canvas.match(/const candidate = \(object: THREE\.Object3D\)[\s\S]*?\n {4}\};/)?.[0] ?? '';
    expect(candidate).toMatch(/isDataFaceMaterial\(mesh\.material\)\) return false/);
    const revalidate = canvas.match(/const revalidate = \(\(\) => \{[\s\S]*?\n {4}\}\)\(\);/)?.[0] ?? '';
    expect(revalidate).toMatch(/original\.material !== source\.material/);
    expect(revalidate).toMatch(/original\.geometry !== source\.geometry/);
    expect(canvas).toMatch(/sources: sourcesOf\(mergedMembers\)/);
    expect(canvas).toMatch(/sources: sourcesOf\(members\)/);
    expect(canvas).toMatch(/export function isDataFaceMaterial/);
    // Both of the board's panel materials carry the tag.
    const board = read(join(SRC, 'components', 'world', 'evoliga', 'route', 'plaza', 'board', 'Board.tsx'));
    expect((board.match(/userData-dataFace/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('governor pressure (ENGINE r5, CAR r4: a chip jump stepped 0 -> 1)', () => {
  const run = (frames: number[], startMs = 0): { steps: number; state: GovernorPressure } => {
    let state = INITIAL_GOVERNOR_PRESSURE;
    let t = startMs;
    let steps = 0;
    for (const ms of frames) {
      t += ms;
      const next = stepGovernorPressure(state, ms, t);
      state = next.state;
      if (next.step) steps += 1;
    }
    return { steps, state };
  };

  it('isolated spikes never count', () => {
    const frames: number[] = [];
    for (let i = 0; i < 2000; i += 1) frames.push(i % 3 === 0 ? 90 : 16);
    expect(run(frames).steps).toBe(0);
  });

  it('a camera flight’s dense slow frames (2.5 s at 25 ms) do not step', () => {
    const frames = [...Array(100).fill(25), ...Array(600).fill(16)];
    expect(run(frames).steps).toBe(0);
  });

  it('sustained pressure still steps, once the run lasted slowRunMinMs', () => {
    const frames = Array(400).fill(30);
    const { steps } = run(frames);
    expect(steps).toBeGreaterThanOrEqual(1);
    // The first step lands no earlier than the wall-clock bound.
    let state = INITIAL_GOVERNOR_PRESSURE;
    let t = 0;
    let firstAt: number | null = null;
    for (const ms of frames) {
      t += ms;
      const next = stepGovernorPressure(state, ms, t);
      state = next.state;
      if (next.step && firstAt === null) firstAt = t;
    }
    expect(firstAt).not.toBeNull();
    expect(firstAt as number).toBeGreaterThanOrEqual(GOVERNOR.slowRunMinMs);
    expect((firstAt as number) / 30).toBeGreaterThanOrEqual(GOVERNOR.slowFrameRun);
  });

  it('the governor component uses the pure detector', () => {
    const governor = read(join(ROUTE, 'QualityGovernor.tsx'));
    // ENGINE-A4 (D38): the frame time reaches the detector with the frame cap's deliberate skips removed.
    expect(governor).toMatch(/stepGovernorPressure\(pressure\.current, uncappedFrameMs\(delta \* 1000\), performance\.now\(\)\)/);
    expect(governor).not.toMatch(/GOVERNOR\.slowFrameRun/);
  });
});

describe('warm sub-step line (ENGINE r5, CAR r4: 7.6-9.3 s on one milestone)', () => {
  it('is null before the warm and names each stage with a real count', () => {
    expect(loaderWarmLine('en', {}, 3)).toBeNull();
    expect(loaderWarmLine('en', { warmStage: 1, residency: 12 }, 3)).toBe(`Placing 12 · 3/${LOADER_MILESTONES}`);
    expect(loaderWarmLine('en', { warmStage: 1, programsReady: 48 }, 4)).toBe('Shaders 48 · 4/6');
    expect(loaderWarmLine('en', { warmStage: 2, casters: 413 }, 4)).toBe('Shadows 413 · 4/6');
    expect(loaderWarmLine('en', { warmStage: 4, uploads: 123 }, 4)).toBe('Textures 123 · 4/6');
    expect(loaderWarmLine('en', { warmStage: 5, buffers: 412 }, 4)).toBe('Geometry 412 · 4/6');
    expect(loaderWarmLine('en', { warmStage: 6, passes: 15 }, 4)).toBe('Effects 15 · 4/6');
    expect(loaderWarmLine('de', { warmStage: 7, poses: 10 }, 5)).toBe('Stationen 10 · 5/6');
    expect(loaderWarmLine('de', { warmStage: 9 }, 6)).toBe('Letztes Bild · 6/6');
    // Residency's completion flag never leaks into the count.
    expect(loaderWarmLine('en', { warmStage: 1, residency: 1_000_042 }, 3)).toBe('Placing 42 · 3/6');
  });

  it('keeps the live region on the milestone line (no count chatter for screen readers)', () => {
    const loader = read(join(ROUTE, 'BallLoader.tsx'));
    expect(loader).toMatch(/<span aria-hidden="true">\{warmLine\}<\/span>/);
    expect(loader).toMatch(/<span className="sr-only">\{statusLine\}<\/span>/);
    expect(loader).toMatch(/getLoadSignals\(\)/);
  });
});

describe('no sprite streams while the world is the page (ENGINE r5, CAR r4: 56 fetches)', () => {
  it('skips the hidden sections’ rendering, so their lazy images are never requested', () => {
    const css = read(join(SRC, 'app', 'globals.css'));
    // Station sections only: dialog subtrees (the docked panels) are skipped (PR #65 test pass, R4).
    const rule = css.match(/html\.world-route-live \[data-world-route\] section:not\(dialog \*\) > \* \{[\s\S]*?\}/)?.[0] ?? '';
    expect(rule).toMatch(/visibility: hidden;/);
    expect(rule).toMatch(/content-visibility: hidden;/);
  });
});

describe('ceremony cadence (ENGINE r5)', () => {
  it('times every step on the GPU when the context has timer queries', () => {
    const calls: string[] = [];
    const io: LoadWarmIO = {
      prepare: () => calls.push('prepare'),
      collect: () => 0,
      compileSlice: () => 1,
      linksPending: () => false,
      contentComplete: () => false,
      shadowSlice: () => 0,
      verifySlice: () => 0,
      textureSlice: () => 0,
      bufferSlice: () => 0,
      passSlice: () => 0,
      poseSlice: () => 0,
      requestFrame: () => {},
      frameDrawn: () => true,
      programCount: () => 0,
      gpuIdle: () => true,
      fenceGpu: () => calls.push('fence'),
      gpuTimerBegin: () => calls.push('begin'),
      gpuTimerEnd: () => calls.push('end'),
    };
    stepLoadWarm(createLoadWarm(), io);
    expect(calls).toEqual(['begin', 'prepare', 'end', 'fence']);
  });

  it('pre-rasters the docked sweep at the reveal’s raster scale (held, never under reduced motion)', () => {
    const css = read(join(ROUTE, 'BallLoader.module.css'));
    // R6: gated on the staggered pre-raster mark (`data-warm`, see engine-r6-ceremony.test.ts).
    // ENGINE-FIX: the held park runs beside the one-pulse pre-raster (`beamPrime`).
    expect(css).toMatch(/\.root\[data-ball-phase='loading'\]:not\(\[data-revealing\]\):not\(\[data-reduced\]\) \.sweep\[data-warm\] \{\s*animation:\s*sweepPark 100000s steps\(1, end\) infinite[,;]/);
    const park = css.match(/@keyframes sweepPark \{[\s\S]*?\n\}/)?.[0] ?? '';
    const reveal = css.match(/@keyframes beamSweep \{[\s\S]*?\n\}/)?.[0] ?? '';
    const scales = (block: string) => [...block.matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1]));
    expect(Math.max(...scales(park))).toBe(Math.max(...scales(reveal)));
    expect(Math.min(...scales(park))).toBe(Math.min(...scales(reveal)));
    expect(park).not.toMatch(/opacity/);
  });
});

describe('crest wall cut (ENGINE r5, CAR r4: a 60-70 ms task in the sweep)', () => {
  it('paints the next slide ahead in an idle period; the cut only copies pixels', () => {
    const led = read(join(SRC, 'components', 'world', 'evoliga', 'route', 'plaza', 'LedScreen.tsx'));
    const cut = led.match(/const timer = window\.setInterval\(\(\) => \{[\s\S]*?\}, CREST_HOLD_S \* 1000\);/)?.[0] ?? '';
    expect(cut).toMatch(/ahead !== null && ahead\.at === index \? ahead\.pixels : raster\(index\)/);
    expect(led).toMatch(/requestIdleCallback\(prepare/);
  });
});
