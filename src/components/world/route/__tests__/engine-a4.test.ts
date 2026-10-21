import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import * as warm from '../useStationWarmup';
import {
  createLinkCap,
  stepLinkCap,
  WARM_COMPILE_BUDGET_MS,
  WARM_FRAME_SLOW_MS,
  WARM_FRAME_SMOOTH_MS,
  WARM_LINK_CAP_RAMP_FRAMES,
  WARM_LINK_CAP_START,
} from '../useStationWarmup';
import {
  createDrivenClock,
  createFrameCapState,
  driveClock,
  type DrivenClock,
  estimateRefreshMs,
  evenDivisor,
  FRAME_CAP_HARD_MS,
  frameCapCredit,
  noteFrameCapCredit,
  noteFrameCapDriver,
  parseFrameCapMode,
  resetFrameCapForTests,
  restartDrivenClock,
  stepFrameCap,
  uncappedFrameMs,
  type FrameCapMode,
} from '../frame-cap';
import { paintQueueStats, queuePaint, resetPaintQueueForTests, pendingPaints, completedPaints } from '../paint-queue';
import { BATCH_BUILD_SLICE_MS } from '../RouteWorldCanvas';
import { meshBounds, scaledBounds } from '../figures/Figure';
import { HOVER_PRIMER_BEFORE_BEAM_MS, HOVER_PRIMER_MS, hoverPrimerDue, hoverPrimerStageMs } from '../HoverChromePrimer';
import { BEAM_PRERASTER, BEAM_RAY_COUNT, beamPrerasterEndMs, beamPrerasterSteps } from '@/lib/route-world/ball-loader-state';
import { canvasSource, warmSource } from './route-sources';

/**
 * ENGINE-A4 (rollout part A4): compile pacing back to the pre-A3 behaviour,
 * the ceremony's main-thread slices (paint queue, static batcher, figure
 * bounds), and the D38 frame-cap experiment.
 */

const ROUTE = join(__dirname, '..');
const read = (file: string) => readFileSync(join(ROUTE, file), 'utf8');

afterEach(() => {
  resetFrameCapForTests();
  resetPaintQueueForTests();
});

describe('compile pacing (ENGINE-A4: A3 pacing reverted after the quiet-machine A/B)', () => {
  it('restores the pre-A3 constants and has no dev pacing switch left', () => {
    expect(WARM_COMPILE_BUDGET_MS).toBe(12);
    expect(WARM_FRAME_SMOOTH_MS).toBe(30);
    expect('legacyWarmPacing' in warm).toBe(false);
    expect('frameBaseline' in warm).toBe(false);
    expect('WARM_FRAME_BUSY_MS' in warm).toBe(false);
    const source = warmSource();
    expect(source).not.toMatch(/routeWarmPacing/);
    expect(read('HoverChromePrimer.tsx')).not.toMatch(/legacyWarmPacing/);
  });

  it('ramps from the first frame, holds on a 30-49 ms frame and halves on a slow one', () => {
    let cap = createLinkCap();
    for (let i = 0; i < WARM_LINK_CAP_RAMP_FRAMES; i += 1) cap = stepLinkCap(cap, 16);
    expect(cap.cap).toBe(WARM_LINK_CAP_START + 1);
    const held = stepLinkCap({ cap: 8, smooth: 0 }, 40);
    expect(held.cap).toBe(8);
    expect(stepLinkCap({ cap: 8, smooth: 0 }, WARM_FRAME_SLOW_MS).cap).toBe(4);
  });
});

describe('D38 frame cap (ENGINE-A4)', () => {
  const vsyncs = (hz: number, count: number) => Array.from({ length: count }, (_, i) => (i * 1000) / hz);
  const run = (mode: FrameCapMode, hz: number, frames = 240) => {
    const state = createFrameCapState();
    const rendered: number[] = [];
    for (const t of vsyncs(hz, frames)) if (stepFrameCap(state, t, mode, true)) rendered.push(t);
    const intervals = rendered.slice(1).map((t, i) => Math.round((t - rendered[i]) * 10) / 10);
    return { state, rendered, intervals };
  };

  it('parses the switch (D40, ENGINE-A5: the default is even40; off and hard40 are opt-ins)', () => {
    expect(parseFrameCapMode('even40')).toBe('even40');
    expect(parseFrameCapMode('hard40')).toBe('hard40');
    expect(parseFrameCapMode('off')).toBe('off');
    expect(parseFrameCapMode(null)).toBe('even40');
    expect(parseFrameCapMode('60')).toBe('even40');
  });

  it('even40 snaps to an even divisor of the refresh: 60 -> 30, 120 -> 40, 144 -> 36, 240 -> 40', () => {
    expect(evenDivisor(1000 / 60)).toBe(2);
    expect(evenDivisor(1000 / 120)).toBe(3);
    expect(evenDivisor(1000 / 144)).toBe(4);
    expect(evenDivisor(1000 / 240)).toBe(6);
    expect(evenDivisor(1000 / 30)).toBe(1);
    for (const [hz, fps] of [[60, 30], [120, 40], [144, 36], [240, 40]] as const) {
      const { intervals } = run('even40', hz, hz * 4);
      const steady = intervals.slice(20);
      expect(new Set(steady.map((ms) => Math.round(ms))).size, `${hz} Hz even`).toBe(1);
      expect(Math.round(1000 / steady[0]), `${hz} Hz fps`).toBe(fps);
    }
  });

  it('hard40 delivers 40 fps on a 60 Hz display by alternating 2- and 1-vsync frames', () => {
    const { intervals, rendered } = run('hard40', 60, 600);
    const steady = intervals.slice(10);
    expect(new Set(steady.map((ms) => Math.round(ms)))).toEqual(new Set([17, 33]));
    const seconds = (rendered[rendered.length - 1] - rendered[10]) / 1000;
    expect(Math.round((rendered.length - 11) / seconds)).toBe(40);
    expect(FRAME_CAP_HARD_MS).toBe(25);
  });

  it('off and an open window render every rAF; outside the window nothing is skipped', () => {
    expect(run('off', 60).state.skipped).toBe(0);
    const state = createFrameCapState();
    for (const t of vsyncs(60, 60)) expect(stepFrameCap(state, t, 'even40', false)).toBe(true);
  });

  it('a stall resyncs hard40 instead of bursting to catch up', () => {
    const state = createFrameCapState();
    stepFrameCap(state, 0, 'hard40', true);
    stepFrameCap(state, 33.3, 'hard40', true);
    // 200 ms stall, then vsyncs again.
    expect(stepFrameCap(state, 233.3, 'hard40', true)).toBe(true);
    expect(stepFrameCap(state, 250, 'hard40', true)).toBe(false);
  });

  it('estimates the refresh from the fast end of the intervals and snaps to a display rate', () => {
    expect(estimateRefreshMs([])).toBeCloseTo(1000 / 60);
    const busy60 = [...Array(40).fill(16.7), ...Array(20).fill(33.4), 50, 70];
    expect(estimateRefreshMs(busy60)).toBeCloseTo(1000 / 60);
    expect(estimateRefreshMs(Array(60).fill(6.94))).toBeCloseTo(1000 / 144);
    expect(estimateRefreshMs(Array(60).fill(8.33))).toBeCloseTo(1000 / 120);
  });

  it('a capped frame is not a slow frame: the skipped interval is credited back', () => {
    const state = createFrameCapState();
    stepFrameCap(state, 0, 'even40', true);
    expect(stepFrameCap(state, 16.7, 'even40', true)).toBe(false);
    expect(stepFrameCap(state, 33.4, 'even40', true)).toBe(true);
    expect(state.creditMs).toBeCloseTo(16.7);
    noteFrameCapDriver(true, state);
    noteFrameCapCredit(state.creditMs);
    expect(uncappedFrameMs(33.4)).toBeCloseTo(16.7);
    // A genuinely slow frame (no skip before it) keeps its full length.
    expect(stepFrameCap(state, 83.4, 'even40', true)).toBe(true);
    noteFrameCapCredit(state.creditMs);
    expect(frameCapCredit()).toBe(0);
    expect(uncappedFrameMs(50)).toBe(50);
    // Without a driver there is never a credit.
    noteFrameCapDriver(false, null);
    expect(uncappedFrameMs(33.4)).toBeCloseTo(33.4);
  });

  it('the governor, the frame-stats ring and the warm subtract the credit; the canvas only drives frames when asked', () => {
    expect(read('QualityGovernor.tsx')).toMatch(/stepGovernorPressure\(pressure\.current, uncappedFrameMs\(delta \* 1000\)/);
    const canvas = canvasSource();
    expect(canvas).toMatch(/recordFrame\(uncappedFrameMs\(delta \* 1000\)\)/);
    expect(canvas).toMatch(/frameloop=\{parked \? 'demand' : frameCapDriven \? 'never' : 'always'\}/);
    expect(canvas).toMatch(/requestedFrameCapMode\(\) !== 'off'/);
    expect(warmSource()).toMatch(/uncappedFrameMs\(now - lastPrepareAt\)/);
  });
});

describe('ceremony main-thread slices (ENGINE-A4)', () => {
  it('a paint job may continue in its own next task, ahead of later jobs', async () => {
    const order: string[] = [];
    queuePaint(() => {
      order.push('a1');
      return () => {
        order.push('a2');
      };
    });
    queuePaint(() => order.push('b'));
    expect(pendingPaints()).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(order).toEqual(['a1', 'a2', 'b']);
    expect(completedPaints()).toBe(2);
    const stats = paintQueueStats();
    expect(stats.drains).toBe(3);
    expect(stats.maxMs).toBeGreaterThanOrEqual(0);
  });

  it('the plaza board glyph probe (a GPU readback) runs only on request', () => {
    const board = readFileSync(join(ROUTE, '..', 'evoliga', 'route', 'plaza', 'board', 'Board.tsx'), 'utf8');
    expect(board).toMatch(/if \(i === 0 && ledMeasureRequested\(\)\) measureBoardCanvas/);
    expect(board).toMatch(/params\.get\('routeLedMeasure'\) === '1'/);
  });

  it('the static batcher builds one family per step under a per-task budget', () => {
    expect(BATCH_BUILD_SLICE_MS).toBeLessThanOrEqual(16);
    const canvas = canvasSource();
    expect(canvas).toMatch(/buildWork\.push\(\(\) => mergeMeshFamily/);
    expect(canvas).toMatch(/buildWork\.push\(\(\) => mergeInstancedFamily/);
    expect(canvas).toMatch(/if \(performance\.now\(\) - started >= BATCH_BUILD_SLICE_MS\) break;/);
    expect(canvas).toMatch(/const stopTimers = \(\) => \{\s*cancelBuild\(\);/);
  });

  it('figure bounds after the height scale match a second skinned measure', () => {
    const make = (s0: number) => {
      const root = new THREE.Group();
      root.position.set(0.4, -0.2, 1.3);
      root.rotation.set(0.1, 0.7, -0.05);
      root.scale.setScalar(s0);
      const bone = new THREE.Bone();
      bone.position.set(0, 0.5, 0);
      const skinned = new THREE.SkinnedMesh(
        (() => {
          const g = new THREE.BoxGeometry(0.6, 1.2, 0.4);
          const count = g.attributes.position.count;
          g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
          g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(count).fill([1, 0, 0, 0]).flat(), 4));
          return g;
        })(),
        new THREE.MeshBasicMaterial(),
      );
      skinned.add(bone);
      skinned.bind(new THREE.Skeleton([bone]));
      bone.rotation.z = 0.4;
      skinned.position.set(0.2, 0.1, 0);
      const plain = new THREE.Mesh(new THREE.SphereGeometry(0.3), new THREE.MeshBasicMaterial());
      plain.position.set(-0.5, 0.9, 0.2);
      root.add(skinned, plain);
      return root;
    };
    for (const s0 of [1, 0.01]) {
      const a = make(s0);
      const raw = meshBounds(a);
      const fast = scaledBounds(a, raw, 2.7);
      const b = make(s0);
      meshBounds(b);
      b.scale.setScalar(2.7);
      const slow = meshBounds(b);
      for (const key of ['min', 'max'] as const) {
        expect(fast[key].x).toBeCloseTo(slow[key].x, 5);
        expect(fast[key].y).toBeCloseTo(slow[key].y, 5);
        expect(fast[key].z).toBeCloseTo(slow[key].z, 5);
      }
      expect(a.scale.x).toBe(2.7);
    }
  });
});

describe('ceremony raster primers (ENGINE-A4)', () => {
  it('the beam pre-raster keeps its 110 ms stagger and ends long before the fastest reveal', () => {
    expect(BEAM_PRERASTER.stepMs).toBe(110);
    expect(beamPrerasterEndMs()).toBe(BEAM_PRERASTER.startDelayMs + beamPrerasterSteps(BEAM_RAY_COUNT) * BEAM_PRERASTER.stepMs);
    expect(beamPrerasterEndMs()).toBeLessThan(3000);
    expect(read('BallLoader.tsx')).toMatch(/const RAY_COUNT = BEAM_RAY_COUNT;/);
  });

  it('the hover chrome primer rasters brackets and pill in two stages, done before the beam pre-raster starts', () => {
    expect(hoverPrimerDue('loading', 'presented', false)).toBe(true);
    expect(hoverPrimerDue('loading', 'presented', true)).toBe(false);
    // Presented 700 ms after the ball: two stages end by the beam's start minus the margin.
    const at = 700;
    expect(at + 2 * hoverPrimerStageMs(at)).toBeLessThanOrEqual(BEAM_PRERASTER.startDelayMs - HOVER_PRIMER_BEFORE_BEAM_MS);
    expect(hoverPrimerStageMs(0)).toBe(HOVER_PRIMER_MS / 2);
    expect(hoverPrimerStageMs(5000)).toBe(50);
    const primer = read('HoverChromePrimer.tsx');
    expect(primer).toMatch(/setStage\(1\)/);
    expect(primer).toMatch(/setStage\(2\)/);
    expect(primer).toMatch(/stage === 1 \?/);
  });
});

describe('D38 frame-cap driven clock (ENGINE-A4R, verify-a4 item 5)', () => {
  /**
   * A model of r3f 9's clock as the driver meets it: `frameloop="never"`
   * frames take their delta from `advance(seconds)` (seconds - elapsedTime),
   * `demand` frames tick the running clock, and every frameloop change zeroes
   * `elapsedTime` (r3f's `setFrameloop`).
   */
  function r3fModel() {
    const clock = { elapsedTime: 0 };
    const deltas: number[] = [];
    return {
      clock,
      deltas,
      setFrameloop: () => {
        clock.elapsedTime = 0;
      },
      advance: (seconds: number) => {
        deltas.push(seconds - clock.elapsedTime);
        clock.elapsedTime = seconds;
      },
      demandFrame: (dt: number) => {
        clock.elapsedTime += dt;
        deltas.push(dt);
      },
    };
  }
  const REFRESH_S = 1 / 60;
  /** One driven frame, as FrameCapDriver runs it. */
  function driven(r3f: ReturnType<typeof r3fModel>, clock: DrivenClock, rafMs: number): void {
    const { seconds, seat } = driveClock(clock, rafMs, r3f.clock.elapsedTime);
    if (seat !== null) r3f.clock.elapsedTime = seat;
    r3f.advance(seconds);
  }

  it('enable, advance, park under demand frames, unpark: the first delta is >= 0 and <= one refresh, and time never runs back', () => {
    const r3f = r3fModel();
    const clock = createDrivenClock();
    // Enable (frameloop -> never) and run ten frames at 60 Hz.
    r3f.setFrameloop();
    restartDrivenClock(clock);
    for (let i = 0; i < 10; i += 1) driven(r3f, clock, 1000 + i * 1000 * REFRESH_S);
    expect(r3f.deltas[0]).toBe(0);
    for (const d of r3f.deltas.slice(1)) expect(d).toBeCloseTo(REFRESH_S, 6);
    const beforePark = r3f.clock.elapsedTime;
    expect(beforePark).toBeCloseTo(9 * REFRESH_S, 6);
    // Disable (parked: frameloop -> demand); demand frames move r3f's clock.
    r3f.setFrameloop();
    r3f.demandFrame(0.25);
    r3f.demandFrame(0.25);
    expect(r3f.clock.elapsedTime).toBeCloseTo(0.5, 6);
    // Re-enable much later (frameloop -> never zeroes the clock again).
    r3f.setFrameloop();
    restartDrivenClock(clock);
    const mark = r3f.deltas.length;
    driven(r3f, clock, 60_000);
    driven(r3f, clock, 60_000 + 1000 * REFRESH_S);
    const first = r3f.deltas[mark];
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(REFRESH_S);
    expect(r3f.deltas[mark + 1]).toBeCloseTo(REFRESH_S, 6);
    // The driven time continues from where it stopped (the demand clock was behind it).
    expect(r3f.clock.elapsedTime).toBeCloseTo(beforePark + REFRESH_S, 6);
    expect(Math.min(...r3f.deltas)).toBeGreaterThanOrEqual(0);
  });

  it('a clock the demand frames moved AHEAD of the driven time is where the next run starts', () => {
    const r3f = r3fModel();
    const clock = createDrivenClock();
    restartDrivenClock(clock);
    driven(r3f, clock, 500);
    driven(r3f, clock, 500 + 1000 * REFRESH_S);
    // Parked without a clock reset this time: the demand clock runs on past the driven time.
    r3f.demandFrame(3);
    const parkedAt = r3f.clock.elapsedTime;
    restartDrivenClock(clock);
    const mark = r3f.deltas.length;
    driven(r3f, clock, 9000);
    expect(r3f.deltas[mark]).toBe(0);
    expect(r3f.clock.elapsedTime).toBeCloseTo(parkedAt, 6);
  });

  it('a rAF timestamp that steps back (a stalled or re-based clock) never hands r3f a negative delta', () => {
    const r3f = r3fModel();
    const clock = createDrivenClock();
    restartDrivenClock(clock);
    driven(r3f, clock, 2000);
    driven(r3f, clock, 2016);
    driven(r3f, clock, 2010);
    expect(Math.min(...r3f.deltas)).toBeGreaterThanOrEqual(0);
  });

  it('FrameCapDriver runs on the helper: a restart per enable, the seat on the first frame of a run', () => {
    const canvas = canvasSource();
    expect(canvas).toMatch(/restartDrivenClock\(clock\);/);
    expect(canvas).toMatch(/driveClock\(clock, ts, root\.clock\.elapsedTime\)/);
    expect(canvas).toMatch(/if \(seat !== null\) root\.clock\.elapsedTime = seat;/);
  });
});
