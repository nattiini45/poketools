import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { paintBoardPage } from '@/lib/route-world/board-paint-path';

/**
 * ENGINE-A3 fix round (verify-a3: plaza post-reveal long tasks). The plaza's
 * route frame repeated work three times per frame (the composer's RenderPass
 * plus N8AO's two transparency renders each re-walked the scene matrices,
 * re-rendered every shadow map and re-updated the skeletons; three even
 * updates a shadow-casting skeleton twice within ONE render), and the board
 * ticker read a GPU canvas back once a second. See secondary-renders.ts and
 * Board.tsx `createTickerStrip`.
 */

const ROUTE = join(__dirname, '..');

type FakeGl = { shadowMap: { autoUpdate: boolean; needsUpdate: boolean } };

/** A drawn frame's view of the renderer state, captured inside `render`. */
type Seen = { matrixAuto: boolean; shadowAuto: boolean; shadowNeeds: boolean };

let baseCalls = 0;
let originalUpdate: THREE.Skeleton['update'];
// Imported after the prototype stub below, so the guard wraps the counter.
let mod: typeof import('../secondary-renders');

beforeAll(async () => {
  originalUpdate = THREE.Skeleton.prototype.update;
  THREE.Skeleton.prototype.update = function countingUpdate() {
    baseCalls += 1;
  };
  mod = await import('../secondary-renders');
  mod.installSkeletonGuard();
  // Idempotent: a second install does not stack a second wrapper.
  mod.installSkeletonGuard();
});

afterAll(() => {
  THREE.Skeleton.prototype.update = originalUpdate;
});

afterEach(() => {
  baseCalls = 0;
});

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function rig() {
  const gl = { shadowMap: { autoUpdate: true, needsUpdate: false } } as FakeGl;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const skeletons = [new THREE.Skeleton([new THREE.Bone()]), new THREE.Skeleton([new THREE.Bone()])];
  const seen: Seen[] = [];
  /** A render that projects (updates every skeleton) then renders shadows (updates them again), like three. */
  const render = (s: THREE.Object3D) => {
    seen.push({ matrixAuto: s.matrixWorldAutoUpdate, shadowAuto: gl.shadowMap.autoUpdate, shadowNeeds: gl.shadowMap.needsUpdate });
    for (const sk of skeletons) sk.update();
    for (const sk of skeletons) sk.update();
  };
  const draw = (s: THREE.Object3D = scene, cam: THREE.Camera = camera, root: THREE.Object3D | null = scene, disabled = false) =>
    mod.drawFrameRender(gl as unknown as THREE.WebGLRenderer, render, s, cam, root, disabled);
  return { gl, scene, camera, skeletons, seen, draw };
}

describe('secondary world renders (ENGINE-A3 fix)', () => {
  it('the first render of a task is full and updates each skeleton once (not once for projection and again for shadows)', () => {
    const { seen, draw } = rig();
    draw();
    expect(seen).toEqual([{ matrixAuto: true, shadowAuto: true, shadowNeeds: false }]);
    expect(baseCalls).toBe(2);
  });

  it('a repeat render of the root scene in the same task keeps matrices, shadow maps and bones, then restores the state', () => {
    const { gl, scene, seen, draw } = rig();
    gl.shadowMap.needsUpdate = true;
    draw();
    draw();
    draw();
    expect(seen[1]).toEqual({ matrixAuto: false, shadowAuto: false, shadowNeeds: false });
    expect(seen[2]).toEqual({ matrixAuto: false, shadowAuto: false, shadowNeeds: false });
    expect(baseCalls).toBe(2);
    expect(scene.matrixWorldAutoUpdate).toBe(true);
    expect(gl.shadowMap.autoUpdate).toBe(true);
    expect(gl.shadowMap.needsUpdate).toBe(true);
  });

  it('the next task opens a new frame: full render and fresh bone matrices', async () => {
    const { seen, draw } = rig();
    draw();
    draw();
    await nextTask();
    draw();
    expect(seen[2]).toEqual({ matrixAuto: true, shadowAuto: true, shadowNeeds: false });
    expect(baseCalls).toBe(4);
  });

  it('other scenes, another camera, and the dev full switch always render in full', async () => {
    const { scene, camera, seen, draw } = rig();
    const quad = new THREE.Scene();
    draw(quad, camera);
    draw(quad, camera);
    expect(seen.every((s) => s.matrixAuto && s.shadowAuto)).toBe(true);
    await nextTask();
    seen.length = 0;
    draw();
    draw(scene, new THREE.PerspectiveCamera());
    expect(seen[1].shadowAuto).toBe(true);
    await nextTask();
    seen.length = 0;
    draw(scene, camera, scene, true);
    draw(scene, camera, scene, true);
    expect(seen.every((s) => s.matrixAuto && s.shadowAuto)).toBe(true);
    await nextTask();
    seen.length = 0;
    draw(scene, camera, null);
    draw(scene, camera, null);
    expect(seen.every((s) => s.matrixAuto && s.shadowAuto)).toBe(true);
  });

  it('a skeleton update outside a frame render is three\'s own, every time', () => {
    const { skeletons } = rig();
    skeletons[0].update();
    skeletons[0].update();
    expect(baseCalls).toBe(2);
  });

  it('the dev switch is off by default', () => {
    expect(mod.secondaryRendersDisabled()).toBe(false);
  });

  it('the route canvas installs the guard and routes every counted frame draw through it with the root scene', () => {
    const source = readFileSync(join(ROUTE, 'RouteWorldCanvas.tsx'), 'utf8');
    expect(source).toMatch(/^installSkeletonGuard\(\);$/m);
    expect(source).toMatch(/drawFrameRender\(gl, render, scene, camera, root, fullSecondaries\)/);
    expect(source).toMatch(/onCreated=\{\(\{ gl, scene \}\) =>/);
    expect(source).toMatch(/holdFirstRender\(gl, scene\)/);
  });
});

describe('plaza ticker strip (ENGINE-A3 fix)', () => {
  const board = readFileSync(join(ROUTE, '..', 'evoliga', 'route', 'plaza', 'board', 'Board.tsx'), 'utf8');
  const strip = board.slice(board.indexOf('function createTickerStrip'), board.indexOf('function useTickerStrip'));

  it('repaints one CPU-backed canvas (created willReadFrequently before any other context) and skips an unchanged line', () => {
    expect(strip).toMatch(/const canvas = document\.createElement\('canvas'\);\s*canvas\.getContext\('2d', \{ willReadFrequently: true \}\);/);
    expect(strip).toMatch(/paintBoardPage\(\{[\s\S]*?\bcanvas,/);
    expect(strip).toMatch(/if \(text === painted\) return;/);
  });

  describe('paintBoardPage canvas reuse', () => {
    const g = globalThis as { document?: unknown };
    const saved = g.document;
    const calls: string[] = [];
    function fakeCanvas() {
      const ctx = {
        save: () => calls.push('save'),
        restore: () => calls.push('restore'),
        scale: () => calls.push('scale'),
        setTransform: () => calls.push('setTransform'),
        clearRect: () => calls.push('clearRect'),
      };
      return { width: 0, height: 0, getContext: () => ctx };
    }
    const station = {
      id: 'pulse',
      beat: 'probe',
      camera: { position: [0, 3.4, -8], target: [0, 1.5, 0], fov: 45 },
      cameraMobile: { position: [0.4, 3.3, -6.4], target: [0, 1.5, 0], fov: 52 },
      world: { key: 1, fog: 0.006, practicals: 0, particles: 0 },
      assetGroup: 'critical',
    } as unknown as Parameters<typeof paintBoardPage>[0]['station'];

    beforeAll(() => {
      g.document = { createElement: () => fakeCanvas() };
    });
    afterAll(() => {
      g.document = saved;
    });

    it('allocates a new canvas by default, and reuses (clears, never resizes) a passed one of the right size', () => {
      const params = { current: { width: 1024, height: 56 }, station, boardWorldWidthM: 4, paint: () => calls.push('paint') };
      const fresh = paintBoardPage(params);
      const canvas = fakeCanvas() as unknown as HTMLCanvasElement;
      const first = paintBoardPage({ ...params, canvas });
      expect(first.canvas).toBe(canvas);
      expect(canvas.width).toBe(fresh.canvas.width);
      calls.length = 0;
      let resized = false;
      const w = canvas.width;
      Object.defineProperty(canvas, 'width', { get: () => w, set: () => { resized = true; }, configurable: true });
      const second = paintBoardPage({ ...params, canvas });
      expect(second.canvas).toBe(canvas);
      expect(resized).toBe(false);
      expect(calls.slice(0, 2)).toEqual(['setTransform', 'clearRect']);
      expect(calls).toContain('paint');
    });
  });
});
