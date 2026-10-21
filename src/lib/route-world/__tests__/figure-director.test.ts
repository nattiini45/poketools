import v8 from 'node:v8';
import vm from 'node:vm';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { circularDistance, clipKeyFor } from '../clip-phase';
import { createBehaviorStepOut, initBehaviorState, resolveBehavior, selectClip, stepBehaviorInto, type BehaviorSpec } from '../figure-behavior';
import {
  BREATH_AMPLITUDE,
  createFigureDirector,
  FACE_NDC_FAR,
  focusSubjectOf,
  guardedFaceDistanceNdc,
  LOOK_BEAT_RAD,
  LOOK_BEAT_S,
  onFigureSetChanged,
  runDirectorFrame,
  seatTime,
  sphereFaceDistanceNdc,
  SHORT_IDLE_TIME_SCALE,
  type ActorRegistration,
  type DirectorFrameInput,
  type FigureRegistration,
  type Object3DLike,
} from '../figure-director';
import type { FigureLifeLevel } from '../quality';

/* ── fakes ───────────────────────────────────────────────────────────────── */

interface FakeAction {
  name: string;
  duration: number;
  time: number;
  timeScale: number;
  weight: number;
  running: boolean;
  getClip(): { name: string; duration: number };
  getEffectiveWeight(): number;
  isRunning(): boolean;
}

interface FakeFigure {
  reg: FigureRegistration;
  root: Object3DLike;
  actions: Map<string, FakeAction>;
  dormant: { value: boolean };
  counters: { plays: number; updates: number };
  current(): FakeAction | null;
}

function fakeRoot(): Object3DLike {
  return { visible: true, scale: { x: 1, y: 1, z: 1 }, matrixWorld: { elements: new Array(16).fill(0) } };
}

function fakeFigure(
  id: string,
  model: string,
  clips: Record<string, number>,
  options: { directorOwnsClip?: boolean; subjectId?: string | null; clip?: string; role?: string } = {},
): FakeFigure {
  const actions = new Map<string, FakeAction>();
  for (const [name, duration] of Object.entries(clips)) {
    actions.set(name, {
      name,
      duration,
      time: 0,
      timeScale: 1,
      weight: 0,
      running: false,
      getClip: () => ({ name, duration }),
      getEffectiveWeight() {
        return this.weight;
      },
      isRunning() {
        return this.running;
      },
    });
  }
  let current: FakeAction | null = null;
  const counters = { plays: 0, updates: 0 };
  const dormant = { value: false };
  const root = fakeRoot();
  const names = Object.keys(clips);
  const pick = selectClip({ clips: names, role: 'stationary', locomotion: false, requested: options.clip ?? 'idle' });
  const reg: FigureRegistration = {
    id,
    model,
    object: { current: root },
    role: options.role ?? 'wild',
    subjectId: options.subjectId ?? null,
    lowMotion: pick.clip === null,
    mixer: {
      update(dt: number) {
        counters.updates += 1;
        if (current && current.running) {
          current.time = (current.time + dt * current.timeScale) % current.duration;
        }
      },
    },
    clips: names,
    durations: clips,
    isDormant: () => dormant.value,
    directorOwnsClip: options.directorOwnsClip ?? true,
    baseClip: pick.clip,
    baseTimeScale: 1,
    breathe: true,
    play: (clip, timeS, _fadeS, timeScale) => {
      counters.plays += 1;
      for (const action of actions.values()) {
        action.running = false;
        action.weight = 0;
      }
      if (clip === null) {
        current = null;
        return;
      }
      const action = actions.get(clip);
      if (!action) return;
      action.time = timeS;
      action.timeScale = timeScale;
      action.weight = 1;
      action.running = true;
      current = action;
    },
    currentClip: () => current?.name ?? null,
    getAction: (clip?: string) => (clip === undefined ? current : (actions.get(clip) ?? null)),
  };
  return { reg, root, actions, dormant, counters, current: () => current };
}

function fakeSource() {
  const figures: FigureRegistration[] = [];
  const actors: ActorRegistration[] = [];
  let version = 0;
  return {
    figures: () => figures,
    actors: () => actors,
    version: () => version,
    addFigure(reg: FigureRegistration) {
      figures.push(reg);
      version += 1;
    },
    removeFigure(reg: FigureRegistration) {
      const i = figures.indexOf(reg);
      if (i >= 0) figures.splice(i, 1);
      version += 1;
    },
    addActor(reg: ActorRegistration) {
      actors.push(reg);
      version += 1;
    },
  };
}

function frame(overrides: Partial<DirectorFrameInput> = {}): DirectorFrameInput {
  return {
    delta: 1 / 30,
    generation: 1,
    hidden: false,
    loader: false,
    focusOpen: false,
    focusSubjectId: null,
    live: true,
    residencyComplete: true,
    settled: true,
    station: 0,
    life: 'full',
    reducedMotion: false,
    frustum: { intersectsSphere: () => true },
    cameraPosition: { x: 0, y: 0, z: 0 },
    activeBoard: null,
    // R34: the route source never returns null; available with no active face on screen is FACE_NDC_FAR.
    faceDistanceNdc: () => FACE_NDC_FAR,
    ...overrides,
  };
}

/** The base clip's phase implied by its action time on the shared clock. */
function impliedPhase(figure: FakeFigure, awakeS: number): number {
  const action = figure.current()!;
  const raw = action.time / action.duration - (awakeS * action.timeScale) / action.duration;
  return raw - Math.floor(raw);
}

/* ── C2: allocation and the shared clock ─────────────────────────────────── */

describe('figure-director: phase allocation (C2)', () => {
  const clips = { idle: 2.0 };

  it('is order-independent and spaces one clipKey at least 0.5/n apart', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const run = (order: string[]) => {
      const source = fakeSource();
      const figs = order.map((id) => fakeFigure(`figure-${id}`, 'models/regular/25.glb', clips));
      for (const f of figs) source.addFigure(f.reg);
      const director = createFigureDirector(source, { seed: 7 });
      director.step(frame({ delta: 0, live: false }));
      return new Map(figs.map((f) => [f.reg.id, director.row(f.reg.id)!.phase!]));
    };
    const forward = run(ids);
    const backward = run([...ids].reverse());
    expect([...forward.entries()].sort()).toEqual([...backward.entries()].sort());
    const phases = [...forward.values()];
    for (let i = 0; i < phases.length; i += 1) {
      for (let j = i + 1; j < phases.length; j += 1) {
        expect(circularDistance(phases[i], phases[j])).toBeGreaterThanOrEqual(0.5 / phases.length - 1e-9);
      }
    }
  });

  it('keeps the spacing through a dormancy flip, 10 s of dormancy and a fidget round trip', () => {
    const source = fakeSource();
    const figs = ['a', 'b', 'c'].map((id) => fakeFigure(`figure-${id}`, 'models/regular/54.glb', { idle: 1.5, idle2: 2.5 }));
    for (const f of figs) source.addFigure(f.reg);
    const director = createFigureDirector(source, { seed: 11 });
    director.step(frame({ delta: 0 }));
    const allocated = figs.map((f) => director.row(f.reg.id)!.phase!);
    // b dormant for 10 s while its neighbours advance.
    figs[1].dormant.value = true;
    for (let i = 0; i < 300; i += 1) director.step(frame());
    figs[1].dormant.value = false;
    director.step(frame({ delta: 0 }));
    // Run long enough for every figure to fidget and return (dwell ≤ 20 s + pass).
    const seen = new Set<string>();
    for (let i = 0; i < 30 * 60; i += 1) {
      director.step(frame());
      figs.forEach((f) => {
        if (f.current()?.name === 'idle2') seen.add(f.reg.id);
      });
    }
    expect(seen.size).toBe(3);
    // Step until all three are back on idle, then read the phases off the shared clock.
    for (let i = 0; i < 30 * 30 && figs.some((f) => f.current()?.name !== 'idle'); i += 1) director.step(frame());
    for (const [k, f] of figs.entries()) {
      expect(f.current()!.name).toBe('idle');
      expect(circularDistance(impliedPhase(f, director.awakeS()), allocated[k])).toBeLessThan(1e-6);
    }
  });

  it('plays idles shorter than 0.7 s at timeScale 0.7', () => {
    const source = fakeSource();
    const short = fakeFigure('figure-short', 'models/regular/270.glb', { idle: 0.52 });
    const normal = fakeFigure('figure-normal', 'models/regular/1.glb', { idle: 1.667 });
    source.addFigure(short.reg);
    source.addFigure(normal.reg);
    const director = createFigureDirector(source, { seed: 1 });
    director.step(frame());
    expect(short.current()!.timeScale).toBe(SHORT_IDLE_TIME_SCALE);
    expect(normal.current()!.timeScale).toBe(1);
  });

  it('seatTime is (t·timeScale + phase·dur) mod dur', () => {
    expect(seatTime(0.25, 0, 1, 2)).toBeCloseTo(0.5, 9);
    expect(seatTime(0.25, 3, 1, 2)).toBeCloseTo(1.5, 9);
    expect(seatTime(0.5, 1, 0.7, 0.5)).toBeCloseTo(((0.7 / 0.5 + 0.5) % 1) * 0.5, 9);
  });
});

/* ── C3: live population ─────────────────────────────────────────────────── */

describe('figure-director: after live (C3)', () => {
  it('an unregistration re-phases nothing, never throws and releases its mover grant', () => {
    const source = fakeSource();
    const figs = ['a', 'b', 'c', 'd'].map((id) => fakeFigure(`figure-${id}`, 'm.glb', { idle: 2 }));
    for (const f of figs) source.addFigure(f.reg);
    const moverRoot = fakeRoot();
    source.addActor({ id: 'walker-x', kind: 'walker', object: { current: moverRoot }, mover: true, figureId: 'figure-d', step: () => {} });
    const director = createFigureDirector(source, { seed: 3 });
    director.step(frame({ live: false }));
    director.step(frame({ live: true }));
    const before = figs.map((f) => director.row(f.reg.id)!.phase);
    expect(director.moverGranted('walker-x')).toBe(true);
    source.removeFigure(figs[3].reg);
    expect(() => director.step(frame())).not.toThrow();
    expect(figs.slice(0, 3).map((f) => director.row(f.reg.id)!.phase)).toEqual(before.slice(0, 3));
    expect(director.row('figure-d')).toBeNull();
    expect(director.lateRegistrations()).toEqual([]);
  });

  it('records a registration after the reveal as a late registration (the D23 tripwire)', () => {
    const source = fakeSource();
    source.addFigure(fakeFigure('figure-a', 'm.glb', { idle: 2 }).reg);
    const director = createFigureDirector(source, { seed: 3 });
    director.step(frame({ live: false }));
    director.step(frame({ live: true }));
    expect(director.lateRegistrations()).toEqual([]);
    source.addFigure(fakeFigure('figure-late', 'm.glb', { idle: 2 }).reg);
    director.step(frame());
    expect(director.lateRegistrations()).toEqual(['figure-late']);
  });

  it('re-allocates on registry changes before the reveal, never after it', () => {
    const source = fakeSource();
    const a = fakeFigure('figure-a', 'm.glb', { idle: 2 });
    source.addFigure(a.reg);
    const director = createFigureDirector(source, { seed: 5 });
    director.step(frame({ live: false }));
    const alone = director.row('figure-a')!.phase;
    source.addFigure(fakeFigure('figure-b', 'm.glb', { idle: 2 }).reg);
    director.step(frame({ live: false }));
    const paired = director.row('figure-a')!.phase;
    expect(paired).not.toBe(alone);
    director.step(frame({ live: true }));
    source.addFigure(fakeFigure('figure-c', 'm.glb', { idle: 2 }).reg);
    director.step(frame());
    expect(director.row('figure-a')!.phase).toBe(paired);
  });
});

/* ── D40: frame-rate independence ────────────────────────────────────────── */

describe('figure-director: 30 vs 60 fps (D40)', () => {
  function run(fps: number) {
    const source = fakeSource();
    const figs = [
      fakeFigure('figure-a', 'a.glb', { idle: 1.9, idle2: 2.2 }),
      fakeFigure('figure-b', 'a.glb', { idle: 1.9, idle2: 2.2 }),
      fakeFigure('figure-c', 'c.glb', {}),
    ];
    for (const f of figs) source.addFigure(f.reg);
    // A straight-line patrol mover (no vertex inside 20 s): its root must agree exactly.
    const spec = resolveBehavior({
      role: 'patrol',
      anchor: { x: 0, z: 0, yaw: 0 },
      clips: ['idle', 'walk'],
      path: [
        [0, 0],
        [0, 500],
      ],
      speedMps: 0.8,
    } as BehaviorSpec).spec;
    const state = initBehaviorState(spec, 99);
    state.mode = 'move';
    state.leg = 0;
    state.dir = 1;
    state.u = 0;
    state.x = 0;
    state.z = 0;
    state.yaw = 0;
    const out = createBehaviorStepOut();
    const pose = { x: 0, z: 0, yaw: 0 };
    source.addActor({
      id: 'patrol-1',
      kind: 'probe',
      object: { current: fakeRoot() },
      mover: true,
      step: (ctx, f) => {
        stepBehaviorInto(state, { spec, moverSlot: f.moverSlot, life: ctx.life }, ctx.dt, out);
        pose.x = out.pose.x;
        pose.z = out.pose.z;
        pose.yaw = out.pose.yaw;
      },
    });
    const director = createFigureDirector(source, { seed: 21 });
    // 20 s of frames; at 10 s one hitch frame of 0.25 s wall, clamped to 0.1 s
    // by the director, stands in for the 0.1 s of regular frames it replaces.
    const n = 20 * fps;
    let k = 0;
    let spiked = false;
    while (k < n) {
      if (!spiked && k >= 10 * fps) {
        spiked = true;
        director.step(frame({ delta: 0.25 }));
        k += Math.round(0.1 * fps);
        continue;
      }
      director.step(frame({ delta: 1 / fps }));
      k += 1;
    }
    return { figs, pose, awake: director.awakeS() };
  }

  it('agrees within 1 mm / 0.5° after 20 s, including a 0.1 s clamp spike', () => {
    const a = run(30);
    const b = run(60);
    expect(a.awake).toBeCloseTo(b.awake, 6);
    expect(Math.hypot(a.pose.x - b.pose.x, a.pose.z - b.pose.z)).toBeLessThan(1e-3);
    expect(Math.abs(a.pose.yaw - b.pose.yaw)).toBeLessThan((0.5 * Math.PI) / 180);
    for (let k = 0; k < 2; k += 1) {
      const fa = a.figs[k].current()!;
      const fb = b.figs[k].current()!;
      expect(fa.name).toBe(fb.name);
      expect(Math.abs(fa.time - fb.time)).toBeLessThan(1e-3);
    }
    // The clip-less figure's breath.
    expect(Math.abs(a.figs[2].root.scale.y - b.figs[2].root.scale.y)).toBeLessThan(1e-4);
  });
});

/* ── steady state: no allocation per step (heap delta) ─────────────────── */

/**
 * A real allocation check (verify-A1): the new-space bytes a loop adds,
 * measured between two reads with a full GC before and no GC inside the
 * window (a `gc` PerformanceObserver entry inside it voids the attempt).
 * `--expose-gc` is switched on at runtime (`v8.setFlagsFromString`).
 */
function exposedGc(): () => void {
  v8.setFlagsFromString('--expose-gc');
  return vm.runInNewContext('gc') as () => void;
}

function newSpaceUsed(): number {
  const space = v8.getHeapSpaceStatistics().find((entry) => entry.space_name === 'new_space');
  if (!space) throw new Error('no new_space in v8.getHeapSpaceStatistics()');
  return space.space_used_size;
}

async function bytesPerStep(run: (n: number) => void, n: number): Promise<number> {
  const gc = exposedGc();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const gcs: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) gcs.push(entry.startTime);
    });
    observer.observe({ entryTypes: ['gc'] });
    gc();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const t0 = performance.now();
    const before = newSpaceUsed();
    run(n);
    const after = newSpaceUsed();
    const t1 = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 20));
    observer.disconnect();
    if (!gcs.some((at) => at >= t0 && at <= t1)) return (after - before) / n;
  }
  throw new Error('a GC landed inside every measurement window');
}

describe('figure-director: steady state', () => {
  it('reuses its context and never flips a clip between fidgets', () => {
    const source = fakeSource();
    const f = fakeFigure('figure-a', 'a.glb', { idle: 2 });
    source.addFigure(f.reg);
    const director = createFigureDirector(source, { seed: 1 });
    director.step(frame());
    const ctx = director.context();
    const plays = f.counters.plays;
    for (let i = 0; i < 2000; i += 1) director.step(frame());
    expect(director.context()).toBe(ctx);
    expect(f.counters.plays).toBe(plays);
    expect(f.counters.updates).toBeGreaterThanOrEqual(2000);
  });

  it('the heap-delta instrument sees one small object per step', async () => {
    const sink: { v: number }[] = [{ v: 0 }];
    const perStep = await bytesPerStep((n) => {
      for (let i = 0; i < n; i += 1) sink[0] = { v: i };
    }, 4000);
    expect(perStep).toBeGreaterThanOrEqual(12);
  });

  /**
   * The plan's "0 allocations per steady-state step": no object, array,
   * closure or iterator per step. What optimized V8 code still boxes is a
   * handful of doubles written into `number | null` fields of the frozen
   * context (`sinceSettleS`, `forceClockS`): measured 33–81 B per step,
   * FLAT in the figure / actor count (1, 4, 10 or 40 figures alike). So the
   * bound is a small constant AND no per-figure term: one 16-byte object per
   * figure would add ≥ 576 B per step between 4 and 40 figures. The warm-up
   * is long so TurboFan owns the loop (baseline tiers box every double).
   */
  it('allocates no per-figure or per-actor object in a settled, live step (bus granting nothing)', async () => {
    function world(n: number) {
      const source = fakeSource();
      // R14: every figure has bounds and a placed root; the frustum below takes
      // x ≤ 2 + r only, so every figure past the first two is GATED each step (the
      // gate's sphere maths, the shadow sweep and the ancestor walk included).
      const parent: Object3DLike = { ...fakeRoot(), parent: { ...fakeRoot(), parent: null } };
      for (let k = 0; k < n; k += 1) {
        const f = fakeFigure(`figure-${k}`, `m${k % 3}.glb`, { idle: 1.2 + (k % 5) * 0.3, walk: 1 });
        f.reg.bounds = { radius: 0.6, centerY: 0.5, castsShadow: k % 2 === 0 };
        const e = f.root.matrixWorld.elements as number[];
        e[0] = e[5] = e[10] = e[15] = 1;
        e[12] = k * 3;
        f.root.parent = parent;
        source.addFigure(f.reg);
      }
      source.addFigure(fakeFigure('figure-still', 'still.glb', {}).reg); // clip-less: breathes
      const hidden = fakeFigure('figure-hidden', 'h.glb', { idle: 1.1 }); // R18 (c): a hidden root never samples
      hidden.root.visible = false;
      source.addFigure(hidden.reg);
      source.addFigure(fakeFigure('ambient-w', 'w.glb', { idle: 1.4, walk: 0.9 }, { directorOwnsClip: false }).reg);
      const walkerRoot = fakeRoot();
      for (let k = 0; k < 3; k += 1) {
        source.addActor({
          id: `actor-${k}`,
          kind: k === 0 ? 'walker' : 'resident',
          mover: k === 0,
          object: { current: walkerRoot },
          step: (ctx, frameNow) => {
            walkerRoot.scale.x = frameNow.moverSlot ? 1 + ctx.dt : 1;
          },
        });
      }
      const director = createFigureDirector(source, { seed: 3 });
      // The frustum as packed planes (the production path): x ≤ 2 + r, and 5 planes nothing reaches.
      const planes = new Float64Array(24);
      planes.set([-1, 0, 0, 2]);
      for (let p = 4; p < 24; p += 4) planes.set([0, 1, 0, 1e6], p);
      const input = frame({ delta: 1 / 40, frustum: { planes, intersectsSphere: () => true }, shadowDir: { x: 0.6, y: -0.8, z: 0 } });
      return { director, input };
    }
    // The minimum over rounds: allocation can only ADD bytes, and under a
    // loaded parallel run TurboFan's background compile can land late (an
    // unoptimized loop boxes every double), so more warm-up rounds converge.
    const measure = async (n: number) => {
      const { director, input } = world(n);
      let best = Infinity;
      for (let round = 0; round < 10 && best > 64; round += 1) {
        for (let i = 0; i < 20000; i += 1) director.step(input); // let TurboFan own the loop first
        const perStep = await bytesPerStep((steps) => {
          for (let i = 0; i < steps; i += 1) director.step(input);
        }, 3000);
        best = Math.min(best, perStep);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return best;
    };
    const few = await measure(4);
    const many = await measure(40);
    expect(few).toBeLessThanOrEqual(160);
    expect(many).toBeLessThanOrEqual(160);
    // 36 more figures: well under one 16-byte object each per step.
    expect(many - few).toBeLessThan(200);
  }, 30_000); // ~3 s plain; v8 coverage instrumentation multiplies it
});

/* ── figureLife rungs and D12 static ─────────────────────────────────────── */

describe('figure-director: figureLife and reduced motion', () => {
  function withLife(life: FigureLifeLevel, reducedMotion = false) {
    const source = fakeSource();
    const fidgeter = fakeFigure('figure-f', 'f.glb', { idle: 1.5, idle2: 2 });
    const statue = fakeFigure('figure-s', 's.glb', {});
    source.addFigure(fidgeter.reg);
    source.addFigure(statue.reg);
    let grants = 0;
    const root = fakeRoot();
    source.addActor({
      id: 'mover',
      kind: 'probe',
      object: { current: root },
      mover: true,
      step: (_ctx, f) => {
        if (f.moverSlot) grants += 1;
      },
    });
    const director = createFigureDirector(source, { seed: 2, force: { surfacing: 0, flyover: null, play: null } });
    let fidgets = 0;
    let breathMax = 0;
    for (let i = 0; i < 30 * 45; i += 1) {
      director.step(frame({ life, reducedMotion }));
      if (fidgeter.current()?.name === 'idle2') fidgets += 1;
      breathMax = Math.max(breathMax, Math.abs(statue.root.scale.y - 1));
    }
    const ticket = director.bus.request('surfacing', 'surfacer', null, { forced: true });
    director.step(frame({ life, reducedMotion }));
    return { grants, fidgets, breathMax, beat: ticket.state, ctx: director.context() };
  }

  it('full: movers granted, fidgets and breath on', () => {
    const r = withLife('full');
    expect(r.grants).toBeGreaterThan(0);
    expect(r.fidgets).toBeGreaterThan(0);
    expect(r.breathMax).toBeGreaterThan(BREATH_AMPLITUDE * 0.5);
  });

  it('rung 3 (minimal) moves no path; rung 4 (static) has fidgets off', () => {
    const minimal = withLife('minimal');
    expect(minimal.grants).toBe(0);
    expect(minimal.ctx.budget.paths).toBe(false);
    expect(minimal.fidgets).toBeGreaterThan(0);
    const still = withLife('static');
    expect(still.grants).toBe(0);
    expect(still.fidgets).toBe(0);
  });

  it('reduced motion under a forced route tier runs static: no breath, no fidgets, no passes or hero beats', () => {
    const r = withLife('full', true);
    expect(r.ctx.motion).toBe('static');
    expect(r.ctx.life).toBe('static');
    expect(r.grants).toBe(0);
    expect(r.fidgets).toBe(0);
    expect(r.breathMax).toBe(0);
    expect(r.beat).toBe('pending');
  });
});

/* ── pinPhase ────────────────────────────────────────────────────────────── */

describe('figure-director: pinPhase (A1 step 6)', () => {
  function pinned(steps: number, t: number) {
    const source = fakeSource();
    const figs = [
      fakeFigure('figure-a', 'a.glb', { idle: 1.9, idle2: 2.2 }),
      fakeFigure('figure-b', 'a.glb', { idle: 1.9, idle2: 2.2 }),
      fakeFigure('figure-c', 'c.glb', { idle: 0.6 }),
      fakeFigure('figure-d', 'd.glb', {}),
    ];
    for (const f of figs) source.addFigure(f.reg);
    let actorT = -1;
    source.addActor({ id: 'resident-1', kind: 'resident', object: { current: fakeRoot() }, step: () => {}, pin: (at) => (actorT = at) });
    const director = createFigureDirector(source, { seed: 9 });
    for (let i = 0; i < steps; i += 1) director.step(frame({ delta: (i % 7) / 60 }));
    director.pinPhase(t);
    return {
      times: figs.map((f) => [f.current()?.name ?? null, f.current()?.time ?? null]),
      breath: figs[3].root.scale.y,
      actorT,
      awake: director.awakeS(),
    };
  }

  it('poses the pinned clocks exactly: the step right after a pin advances nothing, looks reset to 0', () => {
    const source = fakeSource();
    const a = fakeFigure('figure-a', 'a.glb', { idle: 1.9 });
    const walker = fakeFigure('ambient-w', 'w.glb', { idle: 1.4, walk: 0.9 }, { directorOwnsClip: false });
    let look = 0.4;
    a.reg.look = (yaw) => {
      look = yaw;
    };
    source.addFigure(a.reg);
    source.addFigure(walker.reg);
    let actorDt = -1;
    source.addActor({
      id: 'ambient-walker-w',
      kind: 'walker',
      mover: true,
      figureId: 'ambient-w',
      object: { current: fakeRoot() },
      step: (ctx) => {
        actorDt = ctx.dt;
      },
      pin: () => walker.reg.play?.('walk', 0, 0, 1.4),
    });
    const director = createFigureDirector(source, { seed: 2 });
    for (let i = 0; i < 50; i += 1) director.step(frame({ delta: 1 / 40 }));
    director.pinPhase(0);
    const pinned = [a.current()!.time, walker.current()!.name, walker.current()!.time, walker.current()!.timeScale];
    expect(look).toBe(0);
    // The pin's own synchronous advance: whatever delta the frameloop hands it (here 0.05 s).
    director.step(frame({ delta: 0.05 }));
    expect([a.current()!.time, walker.current()!.name, walker.current()!.time, walker.current()!.timeScale]).toEqual(pinned);
    expect(actorDt).toBe(0);
    expect(director.awakeS()).toBe(0);
    // The frame after that runs normally.
    director.step(frame({ delta: 0.05 }));
    expect(actorDt).toBeCloseTo(0.05, 9);
    expect(a.current()!.time).not.toBe(pinned[0]);
  });

  it('gives identical action.time for every figure across two runs, whatever came before', () => {
    const a = pinned(37, 0);
    const b = pinned(911, 0);
    expect(a).toEqual(b);
    expect(a.actorT).toBe(0);
    expect(pinned(5, 12.5)).toEqual(pinned(400, 12.5));
  });
});

/* ── bus wiring ──────────────────────────────────────────────────────────── */

describe('figure-director: the bus rides the director clock', () => {
  it('emits fidget events and the reveal', () => {
    const source = fakeSource();
    source.addFigure(fakeFigure('figure-a', 'a.glb', { idle: 1.5, idle2: 2 }).reg);
    const director = createFigureDirector(source, { seed: 4 });
    const kinds: string[] = [];
    director.bus.subscribe((event) => kinds.push(event.kind));
    director.step(frame({ live: false }));
    director.step(frame({ live: true }));
    for (let i = 0; i < 30 * 30; i += 1) director.step(frame());
    expect(kinds.filter((kind) => kind === 'reveal')).toHaveLength(1);
    expect(kinds).toContain('fidget');
  });

  it('forceClockS starts at the first settle after the reveal', () => {
    const source = fakeSource();
    const director = createFigureDirector(source, {});
    director.step(frame({ live: true, settled: false }));
    expect(director.context().forceClockS).toBeNull();
    director.step(frame({ live: true, settled: true, delta: 0.05 }));
    for (let i = 0; i < 10; i += 1) director.step(frame({ live: true, settled: true, delta: 0.1 }));
    expect(director.context().forceClockS).toBeCloseTo(1, 6);
    // Leaving the station resets the reading window clock, never the force clock.
    director.step(frame({ live: true, settled: false, delta: 0.1 }));
    expect(director.context().sinceSettleS).toBeNull();
    expect(director.context().forceClockS).toBeCloseTo(1.1, 6);
  });

  it('forceClockS arms at the reveal when the station settled before it (R41: the load station)', () => {
    const source = fakeSource();
    const director = createFigureDirector(source, {});
    for (let i = 0; i < 5; i += 1) director.step(frame({ live: false, settled: true, delta: 0.1 }));
    expect(director.context().forceClockS).toBeNull();
    director.step(frame({ live: true, settled: true, delta: 0.1 }));
    expect(director.context().forceClockS).toBeCloseTo(0, 6);
    for (let i = 0; i < 10; i += 1) director.step(frame({ live: true, settled: true, delta: 0.1 }));
    expect(director.context().forceClockS).toBeCloseTo(1, 6);
    // The reading-window clock still counts from the pre-reveal settle edge.
    expect(director.context().sinceSettleS).toBeCloseTo(1.5, 6);
  });
});

describe('clipKey', () => {
  it('is file|clip', () => {
    expect(clipKeyFor('models/regular/25.glb', 'idle')).toBe('models/regular/25.glb|idle');
  });
});

describe('figure-director: prop-controlled figures (the Walker)', () => {
  it('never flips their clip, but counts their fidget passes and times its mixers', () => {
    const source = fakeSource();
    const walker = fakeFigure('ambient-w', 'w.glb', { idle: 2, idle2: 3, walk: 1 }, { directorOwnsClip: false, clip: 'walk', role: 'walker' });
    source.addFigure(walker.reg);
    let now = 0;
    const director = createFigureDirector(source, { seed: 8, clock: () => (now += 0.01) });
    walker.reg.play!('walk', 0, 0, 1.3);
    director.step(frame()); // the allocation seats its phase once (a cut, same clip)
    expect(walker.current()!.name).toBe('walk');
    expect(walker.current()!.timeScale).toBe(1.3);
    const plays = walker.counters.plays;
    for (let i = 0; i < 29; i += 1) director.step(frame());
    walker.reg.play!('idle2', 0, 0, 1);
    for (let i = 0; i < 30; i += 1) director.step(frame());
    walker.reg.play!('idle', 0, 0, 1);
    for (let i = 0; i < 30; i += 1) director.step(frame());
    expect(walker.counters.plays).toBe(plays + 2);
    expect(director.row('ambient-w')!.fidgetsByClip).toEqual({ idle2: 1 });
    expect(director.mixerMs()).toBeCloseTo(0.01, 9);
  });
});

/* ── R18: prop-controlled roles, focus ids, hidden roots ─────────────────── */

describe('figure-director: R18 closures', () => {
  it('(a) focusSubjectOf maps team:<id> to the bare participant id and every other focus kind to null', () => {
    expect(focusSubjectOf('team:player-0001')).toBe('player-0001');
    expect(focusSubjectOf('team:')).toBeNull();
    expect(focusSubjectOf('board:pulse')).toBeNull();
    expect(focusSubjectOf('station:teams')).toBeNull();
    expect(focusSubjectOf('player-0001')).toBeNull();
    expect(focusSubjectOf(null)).toBeNull();
    expect(focusSubjectOf(undefined)).toBeNull();
  });

  it('(a) the step context carries the bare id it is handed (FigureDirector.tsx normalises at the boundary)', () => {
    const source = fakeSource();
    source.addFigure(fakeFigure('ace-player-0001', 'a.glb', { idle: 1 }, { subjectId: 'player-0001', role: 'ace' }).reg);
    const director = createFigureDirector(source, { seed: 2 });
    director.step(frame({ focusOpen: true, focusSubjectId: focusSubjectOf('team:player-0001') }));
    expect(director.context().focusSubjectId).toBe('player-0001');
    expect(director.row('ace-player-0001')!.subjectId).toBe(director.context().focusSubjectId);
  });

  it("(b) counts a prop-controlled figure's clip flips as fidgets only for role walker; residents and flyers get none", () => {
    const source = fakeSource();
    const figs = (['walker', 'resident', 'flyer'] as const).map((role) =>
      fakeFigure(`f-${role}`, `${role}.glb`, { idle: 2, idle2: 3, walk: 1 }, { directorOwnsClip: false, role }),
    );
    for (const f of figs) source.addFigure(f.reg);
    const director = createFigureDirector(source, { seed: 5 });
    director.step(frame());
    for (let pass = 0; pass < 3; pass += 1) {
      for (const f of figs) f.reg.play!('idle2', 0, 0, 1);
      for (let i = 0; i < 20; i += 1) director.step(frame());
      for (const f of figs) f.reg.play!('idle', 0, 0, 1);
      for (let i = 0; i < 20; i += 1) director.step(frame());
    }
    expect(director.row('f-walker')!.fidgets).toBe(3);
    expect(director.row('f-resident')!.fidgets).toBe(0);
    expect(director.row('f-flyer')!.fidgets).toBe(0);
    // And the director never flipped their clips itself (no director fidgets).
    for (const f of figs) expect(f.current()!.name).toBe('idle');
  });

  it('(c) a hidden root (or a hidden ancestor) gets no mixer update and no breath, prop-controlled figures included', () => {
    const source = fakeSource();
    const owned = fakeFigure('f-owned', 'o.glb', { idle: 1.3 });
    const prop = fakeFigure('f-prop', 'p.glb', { idle: 1.3 }, { directorOwnsClip: false, role: 'flyer' });
    const still = fakeFigure('f-still', 's.glb', {}); // clip-less: breathes
    const latchRoot: Object3DLike = { ...fakeRoot(), parent: null };
    for (const f of [owned, prop, still]) {
      f.root.parent = latchRoot;
      source.addFigure(f.reg);
    }
    const director = createFigureDirector(source, { seed: 4 });
    for (let i = 0; i < 10; i += 1) director.step(frame());
    expect(still.root.scale.y).not.toBe(1);
    const before = { owned: owned.counters.updates, prop: prop.counters.updates };
    const scale = still.root.scale.y;
    latchRoot.visible = false; // D's latch hides the actor root
    for (let i = 0; i < 60; i += 1) director.step(frame());
    expect(owned.counters.updates).toBe(before.owned);
    expect(prop.counters.updates).toBe(before.prop);
    expect(still.root.scale.y).toBe(scale);
    // The logic kept stepping: the row is live, the figure is not dormant.
    expect(director.row('f-owned')!.dormant).toBe(false);
    latchRoot.visible = true;
    owned.root.visible = false; // the root itself
    for (let i = 0; i < 10; i += 1) director.step(frame());
    expect(owned.counters.updates).toBe(before.owned);
    expect(prop.counters.updates).toBe(before.prop + 10);
    expect(still.root.scale.y).not.toBe(scale);
  });
});

/* ── R14: visibility-gated mixer sampling ────────────────────────────────── */

/**
 * A figure whose actions behave like `Figure.tsx` on a three mixer: `play`
 * cuts (every other action stopped) or crossfades (the previous action fades
 * 1 → 0 and the new one 0 → 1 over the fade, on the MIXER's clock); an
 * update advances every enabled action's time and the mixer clock; a
 * faded-out action is disabled (its time freezes) but stays in the mix at 0.
 */
interface FadeAction {
  name: string;
  dur: number;
  time: number;
  ts: number;
  active: boolean;
  enabled: boolean;
  from: number;
  to: number;
  fadeStart: number;
  fadeEnd: number;
}

function fadeFigure(id: string, clips: Record<string, number>, bounds = { radius: 0.5, centerY: 0.5, castsShadow: true }) {
  const actions = new Map<string, FadeAction>();
  for (const [name, dur] of Object.entries(clips)) {
    actions.set(name, { name, dur, time: 0, ts: 1, active: false, enabled: false, from: 1, to: 1, fadeStart: 0, fadeEnd: 0 });
  }
  const mixer = { t: 0, updates: [] as number[] };
  let current: FadeAction | null = null;
  const weightOf = (a: FadeAction) => {
    if (!a.active) return 0;
    if (mixer.t >= a.fadeEnd) return a.to;
    const k = (mixer.t - a.fadeStart) / (a.fadeEnd - a.fadeStart);
    return a.from + (a.to - a.from) * Math.min(Math.max(k, 0), 1);
  };
  const root = fakeRoot();
  const e = root.matrixWorld.elements as number[];
  e[0] = e[5] = e[10] = e[15] = 1;
  const names = Object.keys(clips);
  const pick = selectClip({ clips: names, role: 'stationary', locomotion: false, requested: 'idle' });
  const reg: FigureRegistration = {
    id,
    model: `${id}.glb`,
    object: { current: root },
    role: 'wild',
    lowMotion: pick.clip === null,
    mixer: {
      update(dt: number) {
        mixer.updates.push(dt);
        mixer.t += dt;
        for (const a of actions.values()) {
          if (!a.active || !a.enabled) continue;
          a.time = (a.time + dt * a.ts) % a.dur;
          if (mixer.t >= a.fadeEnd && a.to === 0) a.enabled = false;
        }
      },
    },
    clips: names,
    durations: clips,
    isDormant: () => false,
    directorOwnsClip: true,
    baseClip: pick.clip,
    baseTimeScale: 1,
    breathe: true,
    bounds,
    play: (clip, timeS, fadeS, timeScale) => {
      if (clip === null) {
        for (const a of actions.values()) a.active = false;
        current = null;
        return;
      }
      const action = actions.get(clip)!;
      const previous = current;
      const seat = (a: FadeAction) => {
        a.active = true;
        a.enabled = true;
        a.ts = timeScale;
        a.time = timeS;
      };
      if (fadeS <= 0 || !previous || previous === action) {
        for (const a of actions.values()) if (a !== action) a.active = false;
        seat(action);
        action.from = 1;
        action.to = 1;
        action.fadeStart = mixer.t;
        action.fadeEnd = mixer.t;
      } else {
        previous.from = weightOf(previous);
        previous.to = 0;
        seat(action);
        action.from = 0;
        action.to = 1;
        action.fadeStart = mixer.t;
        previous.fadeStart = mixer.t;
        action.fadeEnd = mixer.t + fadeS;
        previous.fadeEnd = mixer.t + fadeS;
      }
      current = action;
    },
    currentClip: () => current?.name ?? null,
    getAction: () => null,
  };
  /** The live mix: clip → { time, weight } for every action with weight > 0. */
  const mix = () => {
    const out: Record<string, { time: number; weight: number }> = {};
    for (const a of actions.values()) {
      const w = weightOf(a);
      if (w > 0) out[a.name] = { time: a.time, weight: w };
    }
    return out;
  };
  const fading = () => [...actions.values()].some((a) => a.active && mixer.t < a.fadeEnd);
  return { reg, root, mixer, mix, fading, current: () => current };
}

describe('figure-director: R14 visibility-gated sampling', () => {
  const CLIPS = { idle: 1.7, idle2: 2.3 };

  /**
   * Two directors, one figure each, same id and seed: A samples every frame,
   * B's figure leaves the frustum for [leaveS, enterS) awake seconds. From B's
   * re-entry on, B's current clip and its time match A's every frame (1e-6),
   * and the whole mix (clips, times, weights) matches whenever no crossfade
   * is running in either (B re-enters with a cut, A may be mid-fade).
   */
  function twin(leaveS: number, enterS: number, totalS: number, dt = 1 / 30) {
    const a = fadeFigure('figure-twin', CLIPS);
    const b = fadeFigure('figure-twin', CLIPS);
    const sa = fakeSource();
    const sb = fakeSource();
    sa.addFigure(a.reg);
    sb.addFigure(b.reg);
    const da = createFigureDirector(sa, { seed: 21 });
    const db = createFigureDirector(sb, { seed: 21 });
    const view = { in: true };
    const fa = frame({ delta: dt });
    const fb = frame({ delta: dt, frustum: { intersectsSphere: () => view.in } });
    let t = 0;
    let compared = 0;
    let comparedMix = 0;
    let gatedFrames = 0;
    let reentries = 0;
    let fidgetAtEntry: string | null = null;
    const fidgetStarts: number[] = [];
    let wasFidget = false;
    while (t < totalS) {
      const nowIn = !(t >= leaveS && t < enterS);
      const entering = nowIn && !view.in;
      if (entering) reentries += 1;
      view.in = nowIn;
      const updatesBefore = b.mixer.updates.length;
      da.step(fa);
      db.step(fb);
      const tStep = t;
      t += dt;
      const fidget = a.current()?.name === 'idle2';
      if (fidget && !wasFidget) fidgetStarts.push(tStep);
      wasFidget = fidget;
      if (!view.in) {
        gatedFrames += 1;
        expect(b.mixer.updates.length).toBe(updatesBefore); // no sampling while out of view
        continue;
      }
      if (entering) {
        fidgetAtEntry = a.current()!.name;
        expect(b.mixer.updates[b.mixer.updates.length - 1]).toBe(0); // the re-seat is followed by update(0)
      }
      if (tStep < enterS) continue;
      // From re-entry: the same clip at the same time, every frame.
      expect(b.current()!.name).toBe(a.current()!.name);
      const ma = a.mix();
      const mb = b.mix();
      expect(Math.abs(mb[b.current()!.name].time - ma[a.current()!.name].time)).toBeLessThan(1e-6);
      compared += 1;
      if (!a.fading() && !b.fading()) {
        expect(Object.keys(mb).sort()).toEqual(Object.keys(ma).sort());
        for (const k of Object.keys(ma)) {
          expect(Math.abs(mb[k].time - ma[k].time)).toBeLessThan(1e-6);
          expect(Math.abs(mb[k].weight - ma[k].weight)).toBeLessThan(1e-9);
        }
        comparedMix += 1;
      }
    }
    // The fidget logic stepped identically while B was gated (same counts).
    expect(db.row('figure-twin')!.fidgets).toBe(da.row('figure-twin')!.fidgets);
    return { a, b, compared, comparedMix, gatedFrames, reentries, fidgetStarts, fidgetAtEntry };
  }

  it('matches a continuously sampled twin after leaving and re-entering on the base clip', () => {
    const r = twin(1, 4.5, 8);
    expect(r.gatedFrames).toBeGreaterThan(90);
    expect(r.reentries).toBe(1);
    expect(r.fidgetAtEntry).toBe('idle');
    expect(r.comparedMix).toBeGreaterThan(50);
  });

  it("matches the twin when it re-enters MID-FIDGET, and through the fidget's return crossfade", () => {
    // Find when the twin's first fidget starts, then gate B across it and re-enter mid-pass.
    const probe = twin(1e9, 1e9, 40);
    expect(probe.fidgetStarts.length).toBeGreaterThan(0);
    const start = probe.fidgetStarts[0];
    const r = twin(start - 2, start + 0.9, start + 12);
    expect(r.reentries).toBe(1);
    expect(r.fidgetAtEntry).toBe('idle2');
    expect(r.compared).toBeGreaterThan(300);
    expect(r.comparedMix).toBeGreaterThan(250);
  });

  it('matches the twin when it re-enters DURING a crossfade (weights agree once the fade ends)', () => {
    const probe = twin(1e9, 1e9, 40);
    const start = probe.fidgetStarts[0];
    // Re-enter 0.1 s into the fidget's crossfade (0.35 s long).
    const r = twin(start - 3, start + 0.1, start + 8);
    expect(r.reentries).toBe(1);
    expect(r.fidgetAtEntry).toBe('idle2');
    expect(r.comparedMix).toBeGreaterThan(150);
  });

  it('samples every figure before the reveal (the warm poses them) and in the step after a pin', () => {
    const f = fadeFigure('figure-g', CLIPS);
    const source = fakeSource();
    source.addFigure(f.reg);
    const director = createFigureDirector(source, { seed: 9 });
    const out = { intersectsSphere: () => false };
    director.step(frame({ live: false, frustum: out }));
    director.step(frame({ live: false, frustum: out }));
    expect(f.mixer.updates.length).toBe(2);
    director.step(frame({ live: true, frustum: out }));
    expect(f.mixer.updates.length).toBe(2); // live and out of view: gated
    director.pinPhase(3);
    const pinned = f.mixer.updates.length;
    director.step(frame({ live: true, frustum: out }));
    expect(f.mixer.updates.length).toBe(pinned + 1);
    expect(f.mixer.updates[f.mixer.updates.length - 1]).toBe(0);
    director.step(frame({ live: true, frustum: out }));
    expect(f.mixer.updates.length).toBe(pinned + 1);
  });

  it("pads a caster's sphere by its shadow's reach down the key light", () => {
    // A frustum that is the half-space x > 10; the figure stands at x = 5, 1.8 m tall.
    const halfSpace = { intersectsSphere: (x: number, _y: number, _z: number, r: number) => x + r > 10 };
    // The same half-space as packed planes (the production path): x − 10 ≥ −r.
    const planes = new Float64Array(24);
    planes.set([1, 0, 0, -10]);
    for (let p = 4; p < 24; p += 4) planes.set([0, 1, 0, 1e6], p);
    const packed = { planes, intersectsSphere: () => true };
    const run = (frustum: DirectorFrameInput['frustum'], castsShadow: boolean, shadowDir: DirectorFrameInput['shadowDir']) => {
      const f = fadeFigure('figure-s', CLIPS, { radius: 0.9, centerY: 0.9, castsShadow });
      (f.root.matrixWorld.elements as number[])[12] = 5;
      const source = fakeSource();
      source.addFigure(f.reg);
      const director = createFigureDirector(source, { seed: 3 });
      director.step(frame({ frustum, shadowDir }));
      return f.mixer.updates.length;
    };
    // Low sun toward +x (elevation ~14°): the shadow reaches into view.
    const low = { x: 0.97, y: -0.243, z: 0 };
    for (const frustum of [halfSpace, packed]) {
      expect(run(frustum, false, null)).toBe(0);
      expect(run(frustum, true, null)).toBe(0);
      expect(run(frustum, false, low)).toBe(0);
      expect(run(frustum, true, low)).toBe(1);
      // A key straight down casts no reach sideways (its enclosing sphere stays short of x = 10).
      expect(run(frustum, true, { x: 0, y: -1, z: 0 })).toBe(0);
    }
  });
});

/* ── A2: quiet mode, roll call, R27 latch order, the face NDC helper ─────── */

describe('figure-director: quiet mode (A2 step 2, R17)', () => {
  function world() {
    const source = fakeSource();
    // The focused ace HAS idle2 (the branch no /route-preview fixture ace exercises, R17).
    const ace = fakeFigure('ace-p1', 'ace.glb', { idle: 1.6, idle2: 2.2 }, { subjectId: 'p1', role: 'ace' });
    // An ace WITHOUT idle2: breath plus the 6° look.
    const plain = fakeFigure('ace-p2', 'plain.glb', { idle: 1.4 }, { subjectId: 'p2', role: 'ace' });
    const looks: number[] = [];
    plain.reg.look = (yaw) => looks.push(yaw);
    source.addFigure(ace.reg);
    source.addFigure(plain.reg);
    const director = createFigureDirector(source, { seed: 12 });
    return { source, ace, plain, looks, director };
  }

  it('plays idle2 ONCE on the focused ace that has it, then returns to its base clip', () => {
    const { ace, director } = world();
    director.step(frame());
    const clips: string[] = [];
    for (let i = 0; i < 30 * 6; i += 1) {
      director.step(frame({ focusOpen: true, focusSubjectId: 'p1' }));
      const name = ace.current()!.name;
      if (clips[clips.length - 1] !== name) clips.push(name);
    }
    expect(clips).toEqual(['idle2', 'idle']);
    const beats = director.bus.snapshot().figureBeats!;
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({ source: 'quiet', subjectId: 'p1', figureId: 'ace-p1', mode: 'idle2' });
    // Still focused: no second beat. Closing and re-opening fires it again.
    for (let i = 0; i < 30; i += 1) director.step(frame());
    director.step(frame({ focusOpen: true, focusSubjectId: 'p1' }));
    expect(director.bus.snapshot().figureBeats).toHaveLength(2);
  });

  it('an ace without idle2 gets breath plus a 6° look through FigureRegistration.look, back to 0', () => {
    const { plain, looks, director } = world();
    director.step(frame());
    let swell = 0;
    for (let i = 0; i < 30 * 4; i += 1) {
      director.step(frame({ focusOpen: true, focusSubjectId: 'p2' }));
      swell = Math.max(swell, plain.root.scale.y - 1);
    }
    expect(Math.max(...looks.map(Math.abs))).toBeCloseTo((6 * Math.PI) / 180, 3);
    expect(looks[looks.length - 1]).toBe(0);
    expect(swell).toBeGreaterThan(0.01);
    expect(plain.root.scale.y).toBe(1);
    expect(plain.current()!.name).toBe('idle'); // the clip is never flipped
    expect(director.bus.snapshot().figureBeats![0]).toMatchObject({ subjectId: 'p2', mode: 'look' });
  });

  it("halves every other figure's fidget rate while a focus is open", () => {
    const count = (focusOpen: boolean) => {
      const source = fakeSource();
      const figs = Array.from({ length: 12 }, (_, k) => fakeFigure(`figure-${k}`, `m${k}.glb`, { idle: 1.5, idle2: 2 }));
      for (const f of figs) source.addFigure(f.reg);
      const director = createFigureDirector(source, { seed: 5 });
      for (let i = 0; i < 30 * 400; i += 1) director.step(frame({ delta: 1 / 30, focusOpen, focusSubjectId: focusOpen ? 'nobody' : null }));
      return figs.reduce((sum, f) => sum + director.row(f.reg.id)!.fidgets, 0);
    };
    const normal = count(false);
    const quiet = count(true);
    expect(normal).toBeGreaterThan(100);
    expect(quiet / normal).toBeGreaterThan(0.4);
    expect(quiet / normal).toBeLessThan(0.65);
  });

  it('waits for a dormant focused ace to wake, then beats once', () => {
    const { ace, director } = world();
    director.step(frame());
    ace.dormant.value = true;
    for (let i = 0; i < 30; i += 1) director.step(frame({ focusOpen: true, focusSubjectId: 'p1' }));
    expect(director.bus.snapshot().figureBeats).toEqual([]);
    ace.dormant.value = false;
    for (let i = 0; i < 30; i += 1) director.step(frame({ focusOpen: true, focusSubjectId: 'p1' }));
    expect(director.bus.snapshot().figureBeats).toHaveLength(1);
    expect(ace.current()!.name).toBe('idle2');
  });

  it('fires no beat under reduced motion (static) or on a rung without fidgets', () => {
    for (const overrides of [{ reducedMotion: true }, { life: 'static' as const }]) {
      const { ace, director } = world();
      for (let i = 0; i < 30 * 3; i += 1) director.step(frame({ focusOpen: true, focusSubjectId: 'p1', ...overrides }));
      expect(ace.current()!.name).toBe('idle');
      expect(director.bus.snapshot().figureBeats).toEqual([]);
    }
  });
});

describe('figure-director: quiet mode is ONE beat per subject, never restarting a running beat (A2 fix, K1)', () => {
  /** A look-only ace (no idle2) of `subjectId` at world (x, y, z); its look offsets are logged. */
  function lookAce(id: string, subjectId: string, x: number, y = 0, z = 0) {
    const fig = fakeFigure(id, `${id}.glb`, { idle: 1.5 }, { subjectId, role: 'ace' });
    const looks: number[] = [];
    fig.reg.look = (yaw) => looks.push(yaw);
    // fakeRoot's elements is a plain array; Object3DLike types it read-only.
    const e = fig.root.matrixWorld.elements as number[];
    e[12] = x;
    e[13] = y;
    e[14] = z;
    return { ...fig, looks };
  }

  function quietBeats(order: ReturnType<typeof lookAce>[], input: Partial<DirectorFrameInput>) {
    const source = fakeSource();
    for (const f of order) source.addFigure(f.reg);
    const director = createFigureDirector(source, { seed: 5 });
    director.step(frame());
    for (let i = 0; i < 30 * 4; i += 1) director.step(frame({ focusOpen: true, focusSubjectId: 'p1', ...input }));
    return director.bus.snapshot().figureBeats!.filter((b) => b.source === 'quiet');
  }

  it('beats only the figure nearest the focus centre, whatever the registry order', () => {
    const at = { focusCenter: { x: 12, y: 1, z: -3 } };
    for (const flip of [false, true]) {
      const near = lookAce('statue', 'p1', 12.9, 1, -3.4);
      const far = lookAce('grandstand', 'p1', -3.4, 0, -14.35);
      const beats = quietBeats(flip ? [far, near] : [near, far], at);
      expect(beats).toHaveLength(1);
      expect(beats[0]).toMatchObject({ subjectId: 'p1', figureId: 'statue', mode: 'look' });
      expect(far.looks.every((v) => v === 0)).toBe(true);
    }
  });

  it('without a focus centre, the figure nearest the camera; equal distance keeps registry order', () => {
    const cam = lookAce('cam-near', 'p1', 1, 0, 0);
    const other = lookAce('cam-far', 'p1', 9, 0, 0);
    expect(quietBeats([other, cam], { cameraPosition: { x: 0, y: 0, z: 0 } })[0].figureId).toBe('cam-near');
    const a = lookAce('tie-a', 'p1', 2, 0, 0);
    const b = lookAce('tie-b', 'p1', -2, 0, 0);
    expect(quietBeats([a, b], { focusCenter: { x: 0, y: 0, z: 0 } }).map((x) => x.figureId)).toEqual(['tie-a']);
    const c = lookAce('tie-a', 'p1', 2, 0, 0);
    const d = lookAce('tie-b', 'p1', -2, 0, 0);
    expect(quietBeats([d, c], { focusCenter: { x: 0, y: 0, z: 0 } }).map((x) => x.figureId)).toEqual(['tie-b']);
  });

  it('a hidden or unable figure is passed over for a shown one that can beat (the guard startBeat uses)', () => {
    const hidden = lookAce('hidden', 'p1', 0.5, 0, 0);
    hidden.root.visible = false;
    const shown = lookAce('shown', 'p1', 8, 0, 0);
    expect(quietBeats([hidden, shown], { focusCenter: { x: 0, y: 0, z: 0 } }).map((x) => x.figureId)).toEqual(['shown']);
    const dormant = lookAce('dormant', 'p1', 0.5, 0, 0);
    dormant.dormant.value = true;
    const awake = lookAce('awake', 'p1', 8, 0, 0);
    expect(quietBeats([dormant, awake], { focusCenter: { x: 0, y: 0, z: 0 } }).map((x) => x.figureId)).toEqual(['awake']);
  });

  it('a roll call still beats EVERY figure of the subject (K3 hits per figure)', () => {
    const source = fakeSource();
    const a = lookAce('statue', 'p1', 1, 0, 0);
    const b = lookAce('grandstand', 'p1', 9, 0, 0);
    source.addFigure(a.reg);
    source.addFigure(b.reg);
    const director = createFigureDirector(source, { seed: 3 });
    for (let i = 0; i < 30 * 7; i += 1) director.step(frame());
    director.bus.emit({ kind: 'rollCall', participants: ['p1'], columnOffsetsS: [0.1], t: director.bus.now() });
    for (let i = 0; i < 30 * 4; i += 1) director.step(frame());
    expect(director.bus.snapshot().figureBeats!.map((x) => `${x.source}:${x.figureId}`)).toEqual(['rollCall:statue', 'rollCall:grandstand']);
  });

  /** The largest per-frame change of a look log, and the analytic bound: the curve's max slope times one frame. */
  const maxStep = (looks: number[]) => looks.slice(1).reduce((m, v, i) => Math.max(m, Math.abs(v - looks[i])), 0);
  const slopeBound = (dt: number) => ((LOOK_BEAT_RAD * Math.PI) / LOOK_BEAT_S) * dt * 1.01;

  it('a focus opened mid roll-call look waits for that look to finish, then plays ONE fresh look: no snap', () => {
    const source = fakeSource();
    const statue = lookAce('statue', 'p1', 1, 0, 0);
    source.addFigure(statue.reg);
    const director = createFigureDirector(source, { seed: 3 });
    for (let i = 0; i < 30 * 7; i += 1) director.step(frame());
    director.bus.emit({ kind: 'rollCall', participants: ['p1'], columnOffsetsS: [0], t: director.bus.now() });
    let rollAt: number | null = null;
    // Step until the roll-call beat fired, then 1.6 s more (the K1 trace's 1.66 s gap < LOOK_BEAT_S).
    for (let i = 0; i < 30 * 4 && rollAt === null; i += 1) {
      director.step(frame());
      rollAt = director.bus.snapshot().figureBeats?.[0]?.atS ?? null;
    }
    expect(rollAt).not.toBeNull();
    for (let i = 0; i < 48; i += 1) director.step(frame());
    const before = statue.looks.length;
    expect(Math.abs(statue.looks[before - 1])).toBeGreaterThan(LOOK_BEAT_RAD * 0.5); // mid-look
    for (let i = 0; i < 30 * 6; i += 1) director.step(frame({ focusOpen: true, focusSubjectId: 'p1' }));
    const beats = director.bus.snapshot().figureBeats!;
    expect(beats.map((b) => b.source)).toEqual(['rollCall', 'quiet']);
    // The quiet beat started only after the roll-call look ran its full length.
    expect(beats[1].atS - rollAt!).toBeGreaterThanOrEqual(LOOK_BEAT_S - 1e-6);
    // Never more than one frame's slope between consecutive offsets (the old restart jumped ~4°).
    expect(maxStep(statue.looks)).toBeLessThanOrEqual(slopeBound(1 / 30));
    // Both looks played in full: two peaks at 6°, back to 0 at the end.
    const peaks = statue.looks.filter((v, i, a) => i > 0 && i < a.length - 1 && Math.abs(v) >= Math.abs(a[i - 1]) && Math.abs(v) > Math.abs(a[i + 1]));
    expect(peaks).toHaveLength(2);
    for (const v of peaks) expect(Math.abs(v)).toBeCloseTo(LOOK_BEAT_RAD, 2);
    expect(statue.looks[statue.looks.length - 1]).toBe(0);
  });

  it('a roll-call hit on a figure already mid-look takes the look over (recorded, not restarted)', () => {
    const source = fakeSource();
    const statue = lookAce('statue', 'p1', 1, 0, 0);
    source.addFigure(statue.reg);
    const director = createFigureDirector(source, { seed: 3 });
    for (let i = 0; i < 30 * 7; i += 1) director.step(frame());
    director.bus.emit({ kind: 'rollCall', participants: ['p1', 'p1'], columnOffsetsS: [0, 1.2], t: director.bus.now() });
    for (let i = 0; i < 30 * 5; i += 1) director.step(frame());
    const snap = director.bus.snapshot();
    expect(snap.figureBeats!.map((b) => `${b.source}:${b.figureId}`)).toEqual(['rollCall:statue', 'rollCall:statue']);
    // The take-over record says how far into the running look it landed (the look began at atS - intoS).
    const [fresh, taken] = snap.figureBeats!;
    expect(fresh.intoS).toBeUndefined();
    expect(taken.intoS).toBeGreaterThan(1.1);
    expect(taken.intoS).toBeLessThan(1.3);
    expect(taken.atS - taken.intoS!).toBeCloseTo(fresh.atS, 1);
    expect(snap.rollCall.running).toBe(false);
    expect(maxStep(statue.looks)).toBeLessThanOrEqual(slopeBound(1 / 30));
    expect(statue.looks.filter((v) => Math.abs(v) > LOOK_BEAT_RAD * 0.99)).not.toHaveLength(0);
    expect(statue.looks[statue.looks.length - 1]).toBe(0);
  });
});

describe('figure-director: roll call (A2 step 3, D16)', () => {
  it("maps the ledger's ordered participants to subjectIds and fires each beat at its column offset", () => {
    const source = fakeSource();
    const p1 = fakeFigure('ace-p1', 'a.glb', { idle: 1.6, idle2: 1.2 }, { subjectId: 'p1', role: 'ace' });
    const p2 = fakeFigure('ace-p2', 'b.glb', { idle: 1.4 }, { subjectId: 'p2', role: 'ace' });
    p2.reg.look = () => {};
    const bystander = fakeFigure('figure-x', 'c.glb', { idle: 1.1, idle2: 1.5 });
    for (const f of [p1, p2, bystander]) source.addFigure(f.reg);
    const director = createFigureDirector(source, { seed: 3 });
    // R35: settled for 7 s first, so the 6 s reading window is CLOSED when the call starts:
    // only the roll-call block can hold the hero back (the assertion below can fail).
    for (let i = 0; i < 30 * 7; i += 1) director.step(frame({ settled: true }));
    expect(director.bus.snapshot().readingWindow.open).toBe(false);
    // The ledger publishes its call: p3 has no figure.
    director.bus.emit({ kind: 'rollCall', participants: ['p2', 'p3', 'p1'], columnOffsetsS: [0.18, 0.32, 0.46], t: director.bus.now() });
    const hero = director.bus.request('flyover', 'flyer', { x: 0, y: 0, z: -5, r: 1 });
    const seen: string[] = [];
    const heroDuringCall = new Set<string>();
    let running = 0;
    for (let i = 0; i < 30 * 4; i += 1) {
      director.step(frame({ settled: true }));
      const snap = director.bus.snapshot();
      if (snap.rollCall.running) {
        running += 1;
        heroDuringCall.add(`${hero.state}:${hero.deniedReason}`);
      }
      if (p1.current()!.name === 'idle2' && !seen.includes('p1')) seen.push('p1');
    }
    expect(running).toBeGreaterThan(30);
    expect([...heroDuringCall]).toEqual(['pending:roll-call']);
    const snap = director.bus.snapshot();
    expect(snap.rollCall.running).toBe(false);
    expect(snap.rollCall.hits).toEqual({ p2: 1, p1: 1 });
    expect(Object.keys(snap.rollCall.hits)).toEqual(['p2', 'p1']);
    expect(snap.figureBeats!.map((b) => `${b.subjectId}:${b.mode}`)).toEqual(['p2:look', 'p1:idle2']);
    // Column order holds on the awake clock: p1's beat fired 0.28 s after p2's.
    expect(snap.figureBeats![1].atS - snap.figureBeats![0].atS).toBeCloseTo(0.28, 1);
    expect(seen).toEqual(['p1']);
    expect(bystander.current()!.name).toBe('idle');
    // The call's grant is logged as data-bound (no face distance).
    expect(snap.grants[0]).toMatchObject({ kind: 'rollCall', actorId: 'roll-call', faceNdc: null });
  });

  it('leaving the station cancels the rest of the call and releases the beat', () => {
    const source = fakeSource();
    const figs = ['p1', 'p2', 'p3'].map((id) => fakeFigure(`ace-${id}`, `${id}.glb`, { idle: 1.5, idle2: 2 }, { subjectId: id, role: 'ace' }));
    for (const f of figs) source.addFigure(f.reg);
    const director = createFigureDirector(source, { seed: 4 });
    director.step(frame()); // the generation starts (a new generation drops any call)
    director.bus.emit({ kind: 'rollCall', participants: ['p1', 'p2', 'p3'], columnOffsetsS: [0, 1, 2], t: 0 });
    for (let i = 0; i < 15; i += 1) director.step(frame({ settled: true }));
    expect(director.bus.snapshot().rollCall.running).toBe(true);
    director.step(frame({ settled: false }));
    expect(director.bus.snapshot().rollCall.running).toBe(false);
    for (let i = 0; i < 90; i += 1) director.step(frame({ settled: false }));
    expect(director.bus.snapshot().rollCall.hits).toEqual({ p1: 1 });
  });

  it('under reduced motion the call is never granted and nothing beats', () => {
    const source = fakeSource();
    const f = fakeFigure('ace-p1', 'a.glb', { idle: 1.5, idle2: 2 }, { subjectId: 'p1', role: 'ace' });
    source.addFigure(f.reg);
    const director = createFigureDirector(source, { seed: 4 });
    director.step(frame({ reducedMotion: true }));
    director.bus.emit({ kind: 'rollCall', participants: ['p1'], columnOffsetsS: [0], t: 0 });
    for (let i = 0; i < 60; i += 1) director.step(frame({ reducedMotion: true }));
    const snap = director.bus.snapshot();
    expect(snap.rollCall.hits).toEqual({});
    expect(snap.pending[0]).toMatchObject({ kind: 'rollCall', deniedReason: 'reduced-motion' });
  });
});

describe('figure-director: R27 latch before step', () => {
  function latched() {
    const source = fakeSource();
    const f = fakeFigure('flyer-fig', 'fly.glb', { idle: 1.2 });
    const latchRoot: Object3DLike = { ...fakeRoot(), parent: null };
    f.root.parent = latchRoot;
    source.addFigure(f.reg);
    const director = createFigureDirector(source, { seed: 6 });
    for (let i = 0; i < 5; i += 1) director.step(frame());
    latchRoot.visible = false; // the latch hid the actor (between passes)
    for (let i = 0; i < 5; i += 1) director.step(frame());
    return { f, latchRoot, director };
  }

  it('a latch-shown, hidden-root-gated figure is sampled in the SAME frame', () => {
    const { f, latchRoot, director } = latched();
    const before = f.counters.updates;
    runDirectorFrame(director, frame(), () => {
      latchRoot.visible = true; // the latch shows it this frame
    });
    expect(f.counters.updates).toBe(before + 1);
    expect(director.row('flyer-fig')!.gated).toBe(false);
  });

  it('(control) stepping before the latch would leave it one frame on its stale pose', () => {
    const { f, latchRoot, director } = latched();
    const before = f.counters.updates;
    director.step(frame());
    latchRoot.visible = true;
    expect(f.counters.updates).toBe(before);
  });
});

describe('sphereFaceDistanceNdc (the grant precondition input)', () => {
  // A view-projection with NDC = (x / z, y / z): clip x = x, clip y = y, w = z.
  const vp = new Float64Array(16);
  vp[0] = 1;
  vp[5] = 1;
  vp[11] = 1;
  const rects = new Float64Array([-0.2, 0.2, -0.2, 0.2, 0.8, 0.9, 0.8, 0.9]);

  it('measures the gap between the projected sphere and the nearest padded rect', () => {
    // Centre at NDC (0.5, 0), radius 0.2 / 2 = 0.1 NDC: gap 0.5 - 0.1 - 0.2 = 0.2.
    expect(sphereFaceDistanceNdc(vp, 1, 1, { x: 1, y: 0, z: 2, r: 0.2 }, rects, 1)).toBeCloseTo(0.2, 9);
    // Overlapping: 0.
    expect(sphereFaceDistanceNdc(vp, 1, 1, { x: 0.1, y: 0, z: 2, r: 0.1 }, rects, 1)).toBe(0);
    // The nearer of two rects wins (NDC (0.7, 0.7), no radius: the second rect is 0.1 * sqrt 2 away).
    expect(sphereFaceDistanceNdc(vp, 1, 1, { x: 1.4, y: 1.4, z: 2, r: 0 }, rects, 2)).toBeCloseTo(0.1 * Math.SQRT2, 9);
  });

  it('null without a face, 0 for a sphere reaching the eye plane, at most FACE_NDC_FAR', () => {
    expect(sphereFaceDistanceNdc(vp, 1, 1, { x: 1, y: 0, z: 2, r: 0.2 }, rects, 0)).toBeNull();
    expect(sphereFaceDistanceNdc(vp, 1, 1, { x: 0, y: 0, z: 0.3, r: 0.5 }, rects, 1)).toBe(0);
    expect(sphereFaceDistanceNdc(vp, 1, 1, { x: 0, y: 0, z: -4, r: 0.5 }, rects, 1)).toBe(0);
    expect(sphereFaceDistanceNdc(vp, 1, 1, { x: 100, y: 0, z: 2, r: 0 }, rects, 1)).toBe(FACE_NDC_FAR);
  });
});

/* ── R34 / R35: the part 2 fix pass ──────────────────────────────────────── */

describe('figure-director: R34 fail-closed face source', () => {
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const NONE = new Float64Array(0);

  it('guardedFaceDistanceNdc never returns null: 0 when unavailable, FACE_NDC_FAR with no face on screen', () => {
    const sphere = { x: 1, y: 0, z: 2, r: 0.2 };
    for (const reason of ['no-surfaces', 'no-camera', 'no-viewport', 'no-station'] as const) {
      expect(guardedFaceDistanceNdc(reason, IDENTITY, 1, 1, sphere, NONE, 0)).toBe(0);
    }
    expect(guardedFaceDistanceNdc(null, IDENTITY, 1, 1, sphere, NONE, 0)).toBe(FACE_NDC_FAR);
  });

  it("a missing face source denies the director's hero grants (ndc), with no grant logged", () => {
    const source = fakeSource();
    source.addFigure(fakeFigure('figure-a', 'a.glb', { idle: 1.5 }).reg);
    const director = createFigureDirector(source, { seed: 9 });
    const missing = (sphere: { x: number; y: number; z: number; r: number }) =>
      guardedFaceDistanceNdc('no-surfaces', IDENTITY, 1, 1, sphere, NONE, 0);
    for (let i = 0; i < 30 * 7; i += 1) director.step(frame({ faceDistanceNdc: missing }));
    const hero = director.bus.request('flyover', 'flyer', { x: 0, y: 0, z: -5, r: 1 });
    for (let i = 0; i < 30 * 3; i += 1) director.step(frame({ faceDistanceNdc: missing }));
    expect(hero.state).toBe('pending');
    expect(hero.deniedReason).toBe('ndc');
    expect(director.bus.snapshot().grants).toEqual([]);
    // The faces arrive: the same request is granted.
    director.step(frame());
    expect(hero.state).toBe('granted');
  });
});

describe('figure-director: R35 quiet mode and beat minors', () => {
  it("quiet mode leaves the focused participant's own figures at their full fidget rate", () => {
    const count = (focusOpen: boolean) => {
      const source = fakeSource();
      const figs = Array.from({ length: 12 }, (_, k) => fakeFigure(`figure-${k}`, `m${k}.glb`, { idle: 1.5, idle2: 2 }, { subjectId: 'p1' }));
      for (const f of figs) source.addFigure(f.reg);
      const director = createFigureDirector(source, { seed: 5 });
      for (let i = 0; i < 30 * 400; i += 1) director.step(frame({ delta: 1 / 30, focusOpen, focusSubjectId: focusOpen ? 'p1' : null }));
      return figs.reduce((sum, f) => sum + director.row(f.reg.id)!.fidgets, 0);
    };
    const normal = count(false);
    const focused = count(true);
    expect(normal).toBeGreaterThan(100);
    expect(focused / normal).toBeGreaterThan(0.85);
  });

  /** One focused figure with idle and idle2 (pass 2 s): the frame its first fidget after 5 s starts, from an unfocused twin. */
  function firstFidgetFrame(): number {
    const source = fakeSource();
    const f = fakeFigure('ace-p1', 'a.glb', { idle: 1.5, idle2: 2 }, { subjectId: 'p1', role: 'ace' });
    source.addFigure(f.reg);
    const director = createFigureDirector(source, { seed: 21 });
    let seen = 0;
    for (let i = 0; i < 30 * 60; i += 1) {
      director.step(frame());
      const fidgets = director.row('ace-p1')!.fidgets;
      if (fidgets > seen && i >= 30 * 5) return i;
      seen = fidgets;
    }
    throw new Error('no fidget in 60 s');
  }

  /** Step unfocused for `frames`, then focus p1 (an idle2 beat); the clip of every following frame, with its action time. */
  function beatAt(frames: number) {
    const source = fakeSource();
    const f = fakeFigure('ace-p1', 'a.glb', { idle: 1.5, idle2: 2 }, { subjectId: 'p1', role: 'ace' });
    source.addFigure(f.reg);
    const director = createFigureDirector(source, { seed: 21 });
    for (let i = 0; i < frames; i += 1) director.step(frame());
    const trace: { clip: string; time: number }[] = [];
    for (let i = 0; i < 30 * 8; i += 1) {
      director.step(frame({ focusOpen: true, focusSubjectId: 'p1' }));
      trace.push({ clip: f.current()!.name, time: f.current()!.time });
    }
    expect(director.bus.snapshot().figureBeats).toHaveLength(1);
    // The beat: idle2 from the first focused frame, then back to idle.
    const end = trace.findIndex((entry) => entry.clip === 'idle');
    expect(trace[0].clip).toBe('idle2');
    expect(end).toBeGreaterThan(30);
    return { trace, end };
  }

  it('holds the fidget clock while a beat runs: a fidget due during the beat starts from its beginning, after it', () => {
    // The beat starts 0.5 s before the fidget was due; without the hold the
    // schedule would be 1.5 s into that fidget at the beat's end.
    const { trace, end } = beatAt(firstFidgetFrame() - 15);
    const next = trace.findIndex((entry, i) => i > end && entry.clip === 'idle2');
    expect(next).toBeGreaterThan(end + 10);
    expect(trace[next].time).toBeLessThan(0.1);
  });

  it('a beat that starts inside a fidget pass ends with no fidget in progress', () => {
    // The beat starts 0.5 s into a fidget: the held clock skips the rest of that pass at the beat's end.
    const { trace, end } = beatAt(firstFidgetFrame() + 15);
    const after = trace.slice(end, end + 30 * 3);
    expect(after.every((entry) => entry.clip === 'idle')).toBe(true);
  });

  it('ends a running beat when motion becomes static or reduced (D12)', () => {
    for (const overrides of [{ reducedMotion: true }, { life: 'static' as const }]) {
      const source = fakeSource();
      const ace = fakeFigure('ace-p1', 'ace.glb', { idle: 1.6, idle2: 2.2 }, { subjectId: 'p1', role: 'ace' });
      const plain = fakeFigure('ace-p2', 'plain.glb', { idle: 1.4 }, { subjectId: 'p2', role: 'ace' });
      const looks: number[] = [];
      plain.reg.look = (yaw) => looks.push(yaw);
      source.addFigure(ace.reg);
      source.addFigure(plain.reg);
      const director = createFigureDirector(source, { seed: 12 });
      director.step(frame());
      for (let i = 0; i < 15; i += 1) director.step(frame({ focusOpen: true, focusSubjectId: 'p1' }));
      expect(ace.current()!.name).toBe('idle2');
      for (let i = 0; i < 30; i += 1) director.step(frame({ focusOpen: true, focusSubjectId: 'p2' }));
      expect(ace.current()!.name).toBe('idle2');
      expect(Math.abs(looks[looks.length - 1])).toBeGreaterThan(0.01);
      expect(plain.root.scale.y).toBeGreaterThan(1);
      // Motion goes static mid-beat: both beats end in that frame.
      director.step(frame({ focusOpen: true, focusSubjectId: 'p2', ...overrides }));
      expect(ace.current()!.name).toBe('idle');
      expect(looks[looks.length - 1]).toBe(0);
      expect(plain.root.scale.y).toBe(1);
      const n = looks.length;
      for (let i = 0; i < 30; i += 1) director.step(frame({ focusOpen: true, focusSubjectId: 'p2', ...overrides }));
      expect(looks.length).toBe(n);
    }
  });
});

/* ── D42: onFigureSetChanged (the N3 tagger's trigger) ───────────────────── */

describe('figure-director: onFigureSetChanged (D42, frozen cross-seat interface)', () => {
  it('fires once at the end of the step that saw figures register, however many registered', () => {
    const source = fakeSource();
    const director = createFigureDirector(source, { seed: 4 });
    const calls: number[] = [];
    const stop = onFigureSetChanged(() => calls.push(director.awakeS()));
    try {
      director.step(frame({ live: false }));
      expect(calls).toHaveLength(0); // nothing registered: no change
      for (const id of ['a', 'b', 'c']) source.addFigure(fakeFigure(`figure-${id}`, 'm.glb', { idle: 2 }).reg);
      expect(calls).toHaveLength(0); // registration alone notifies nothing: the step does
      director.step(frame({ live: false }));
      expect(calls).toHaveLength(1);
      // The step finished (its clock advanced) before the notification: the listener sees the stepped frame.
      expect(calls[0]).toBeCloseTo(2 / 30, 12);
      // Steady state: no change, no notification.
      for (let i = 0; i < 20; i += 1) director.step(frame());
      expect(calls).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it('fires on an unregistration and on a replacement (same count), never for an unchanged set', () => {
    const source = fakeSource();
    const a = fakeFigure('figure-a', 'm.glb', { idle: 2 });
    const b = fakeFigure('figure-b', 'm.glb', { idle: 2 });
    source.addFigure(a.reg);
    source.addFigure(b.reg);
    const director = createFigureDirector(source, { seed: 4 });
    let calls = 0;
    const stop = onFigureSetChanged(() => (calls += 1));
    try {
      director.step(frame({ live: false }));
      expect(calls).toBe(1);
      source.removeFigure(b.reg);
      director.step(frame({ live: false }));
      expect(calls).toBe(2);
      // Remove one and add another in the same frame: one notification.
      source.removeFigure(a.reg);
      source.addFigure(fakeFigure('figure-c', 'm.glb', { idle: 2 }).reg);
      director.step(frame({ live: false }));
      expect(calls).toBe(3);
      // An actor-only change leaves the figure set as it was.
      source.addActor({ id: 'resident-x', kind: 'resident', object: { current: fakeRoot() }, step: () => {} });
      director.step(frame({ live: false }));
      expect(calls).toBe(3);
      // A new scene generation re-reads the registry but the set is unchanged.
      director.step(frame({ live: false, generation: 2 }));
      expect(calls).toBe(3);
    } finally {
      stop();
    }
  });

  it('a change a pinPhase sync picks up is notified at the next step, once', () => {
    const source = fakeSource();
    const director = createFigureDirector(source, { seed: 4 });
    let calls = 0;
    const stop = onFigureSetChanged(() => (calls += 1));
    try {
      director.step(frame());
      source.addFigure(fakeFigure('figure-a', 'm.glb', { idle: 2 }).reg);
      director.pinPhase(0);
      expect(calls).toBe(0);
      director.step(frame());
      expect(calls).toBe(1);
      director.step(frame());
      expect(calls).toBe(1);
    } finally {
      stop();
    }
  });

  it('unsubscribes; the same callback can hold two subscriptions; a throwing listener never stops the others', () => {
    const source = fakeSource();
    const director = createFigureDirector(source, { seed: 4 });
    let calls = 0;
    const cb = () => (calls += 1);
    const first = onFigureSetChanged(cb);
    const second = onFigureSetChanged(cb);
    const thrower = onFigureSetChanged(() => {
      throw new Error('listener');
    });
    const error = console.error;
    console.error = () => {};
    try {
      source.addFigure(fakeFigure('figure-a', 'm.glb', { idle: 2 }).reg);
      expect(() => director.step(frame())).not.toThrow();
      expect(calls).toBe(2);
      first();
      first(); // idempotent
      source.addFigure(fakeFigure('figure-b', 'm.glb', { idle: 2 }).reg);
      director.step(frame());
      expect(calls).toBe(3);
      second();
      source.addFigure(fakeFigure('figure-c', 'm.glb', { idle: 2 }).reg);
      director.step(frame());
      expect(calls).toBe(3);
    } finally {
      console.error = error;
      first();
      second();
      thrower();
    }
  });
});

/* ── D42 N5: the dormant-from-mount pose ─────────────────────────────────── */

describe('figure-director: a figure dormant from mount is posed at allocation (D42 N5)', () => {
  /** Records every mixer update's dt (the fake mixer advances the playing action by it). */
  function recorded(f: FakeFigure): number[] {
    const dts: number[] = [];
    const inner = f.reg.mixer!;
    f.reg.mixer = {
      update(dt: number) {
        dts.push(dt);
        inner.update(dt);
      },
    };
    return dts;
  }

  it('samples the dormant figure once, by exactly 0, at its allocated phase on the clock; awake figures are unchanged', () => {
    const source = fakeSource();
    const sleeper = fakeFigure('figure-s', 'm.glb', { idle: 1.7 });
    const awake = fakeFigure('figure-w', 'm.glb', { idle: 1.7 });
    sleeper.dormant.value = true;
    source.addFigure(sleeper.reg);
    source.addFigure(awake.reg);
    const sleeperDts = recorded(sleeper);
    const awakeDts = recorded(awake);
    const director = createFigureDirector(source, { seed: 21 });
    // Residency not complete: nothing allocated, nobody seated or sampled by the allocation.
    director.step(frame({ live: false, residencyComplete: false }));
    expect(sleeperDts).toEqual([]);
    expect(awakeDts).toEqual([1 / 30]);
    // Residency completes: allocation seats both; the dormant one is sampled by exactly 0, once.
    director.step(frame({ live: false, delta: 1 / 30 }));
    expect(sleeperDts).toEqual([0]);
    expect(awakeDts).toEqual([1 / 30, 1 / 30]);
    const row = director.row('figure-s')!;
    const action = sleeper.current()!;
    expect(action.name).toBe('idle');
    // Its allocated pose at the clock: seatTime(phase, awake), exactly as pinPhase would seat it.
    expect(action.time).toBe(seatTime(row.phase!, director.awakeS(), action.timeScale, 1.7));
    // Both figures are on their allocated phases of the one clipKey.
    expect(circularDistance(impliedPhase(sleeper, director.awakeS()), row.phase!)).toBeLessThan(1e-9);
    expect(circularDistance(impliedPhase(awake, director.awakeS()), director.row('figure-w')!.phase!)).toBeLessThan(1e-9);
    // Dormant from then on: no further sampling (the dormancy contract is unchanged).
    for (let i = 0; i < 30; i += 1) director.step(frame());
    expect(sleeperDts).toEqual([0]);
    // The wake re-seats on the shared clock as before.
    sleeper.dormant.value = false;
    director.step(frame());
    expect(sleeperDts).toEqual([0, 1 / 30]);
    expect(circularDistance(impliedPhase(sleeper, director.awakeS()), row.phase!)).toBeLessThan(1e-9);
  });

  it('a clip-less dormant figure holds its freeze seat sampled by 0; a figure with no mixer is skipped', () => {
    const source = fakeSource();
    const still = fakeFigure('figure-still', 'still.glb', {});
    still.dormant.value = true;
    const noMixer = fakeFigure('figure-nm', 'nm.glb', { idle: 2 });
    noMixer.dormant.value = true;
    noMixer.reg.mixer = null;
    source.addFigure(still.reg);
    source.addFigure(noMixer.reg);
    const dts = recorded(still);
    const director = createFigureDirector(source, { seed: 2 });
    expect(() => director.step(frame({ live: false }))).not.toThrow();
    expect(dts).toEqual([0]);
    expect(noMixer.counters.plays).toBe(1);
  });

  it('pinned captures are identical whether the allocation came from residency or from the pin', () => {
    const run = (allocateFirst: boolean) => {
      const source = fakeSource();
      const figs = ['a', 'b', 'c'].map((id) => fakeFigure(`figure-${id}`, 'm.glb', { idle: 1.3, idle2: 2.1 }));
      figs[1].dormant.value = true;
      for (const f of figs) source.addFigure(f.reg);
      const director = createFigureDirector(source, { seed: 8 });
      director.step(frame({ live: false, residencyComplete: allocateFirst }));
      for (let i = 0; i < 17; i += 1) director.step(frame({ live: false, residencyComplete: allocateFirst, delta: (i % 5) / 60 }));
      director.pinPhase(3.25);
      return figs.map((f) => [f.current()?.name ?? null, f.current()?.time ?? null]);
    };
    expect(run(true)).toEqual(run(false));
  });
});
