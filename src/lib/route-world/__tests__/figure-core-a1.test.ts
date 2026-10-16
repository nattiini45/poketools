import { describe, expect, it } from 'vitest';
import { createFidgetFrame, createFidgetPlan, fidgetAt, idleFidgetSchedule } from '../clip-phase';
import { phaseCollisionShare, phaseCollisions, rowClipKey } from '../evidence-probe';
import {
  createBehaviorStepOut,
  figureLifeBudget,
  initBehaviorState,
  LOOK_ARC_RAD,
  loiterGlanceYaw,
  resolveBehavior,
  selectClip,
  slotSeed,
  stepBehavior,
  stepBehaviorInto,
  WAKE_INTERVAL_S,
  advanceWalkerPath,
  createWalkerPathState,
  NO_WALKER_FIDGET,
  WALKER_FIDGET_GAP_S,
  WALKER_PAUSE_S,
  WALKER_VERTEX_HOP_M,
  wrapAngle,
  type BehaviorInput,
  type BehaviorSpec,
} from '../figure-behavior';
import { advanceFigureMixer, MIXER_MAX_STEP_S } from '../residency';

/**
 * POKEMON-CORE A1 (D35 3A): the pure pieces the figure director stands on —
 * the allocation-free fidget plan, the mutating behaviour step, the C9 mixer
 * clamp, the C10 floating changes, the loiter glance and the W2 same-clipKey
 * filter.
 */

describe('fidget plan (allocation-free idleFidgetSchedule)', () => {
  const cases: [number, string[], Record<string, number> | undefined][] = [
    [1, ['idle', 'idle2', 'walk'], { idle2: 2.4 }],
    [77, ['idle', 'idle2', 'wave', 'run'], { idle2: 9, wave: 1 }],
    [3, ['idle'], undefined],
    [4, ['idle2', 'walk'], { idle2: 1.2 }],
    [5, ['walk', 'run'], undefined],
    [6, [], undefined],
  ];
  it('equals idleFidgetSchedule at every sampled second', () => {
    for (const [seed, clips, durations] of cases) {
      const plan = createFidgetPlan(seed, clips, durations);
      const out = createFidgetFrame();
      for (let t = 0; t < 400; t += 0.37) {
        const want = idleFidgetSchedule(seed, clips, t, durations);
        const got = fidgetAt(plan, t, out);
        expect(got).toBe(out);
        expect({ ...got }).toEqual(want);
      }
    }
  });
});

describe('selectClip never loops locomotion in place', () => {
  it('a stopped walk/run-only rig freezes and breathes (rule 6)', () => {
    for (const clips of [['walk'], ['run'], ['walk', 'run']]) {
      const pick = selectClip({ clips, role: 'stationary', locomotion: false, requested: 'idle' });
      expect(pick).toEqual({ clip: null, rule: 6, freezeClip: clips[0] });
      const asked = selectClip({ clips, role: 'stationary', locomotion: false, requested: 'walk' });
      expect(asked.clip).toBeNull();
    }
    expect(selectClip({ clips: ['walk', 'wave'], role: 'stationary', locomotion: false, requested: 'idle' })).toEqual({ clip: 'wave', rule: 5 });
  });
});

describe('stepBehaviorInto (mutating, reused output)', () => {
  const specs: BehaviorSpec[] = [
    { role: 'stationary', anchor: { x: 0, z: 0, yaw: 0.3 }, clips: ['idle', 'idle2'], clipDurations: { idle2: 2 } },
    { role: 'loiter', anchor: { x: 2, z: 1, yaw: 1 }, clips: ['idle', 'idle2'] },
    {
      role: 'patrol',
      anchor: { x: 0, z: 0, yaw: 0 },
      clips: ['idle', 'walk', 'idle2'],
      path: [
        [0, 0],
        [4, 0],
        [4, 3],
      ],
      speedMps: 0.9,
      locomotionTimeScale: 1.2,
    },
    { role: 'waterline', anchor: { x: 0, z: 0, yaw: 0 }, clips: ['idle', 'walk'], edge: [3, 0], after: 'retreat', speedMps: 0.7 },
    { role: 'floating', anchor: { x: 2, z: -8, yaw: 0 }, clips: ['idle'], radiusM: 2.5, surfaceY: 0.06, bobM: 0.05, driftMps: 0.35 },
    { role: 'airborne', anchor: { x: 0, z: 0, yaw: 0 }, clips: ['idle'], radiusM: 1.5, hoverY: 4, bobM: 0.2, driftMps: 0.4 },
  ];

  it('produces stepBehavior’s state, pose, clip and events, step for step', () => {
    for (const raw of specs) {
      const spec = resolveBehavior(raw).spec;
      const input: BehaviorInput = { spec, lookAt: raw.role === 'loiter' ? { x: 6, z: 9 } : null };
      let pure = initBehaviorState(spec, slotSeed(`slot-${raw.role}`, 1, 2));
      const mutable = initBehaviorState(spec, slotSeed(`slot-${raw.role}`, 1, 2));
      const out = createBehaviorStepOut();
      for (let i = 0; i < 1800; i += 1) {
        const dt = i % 97 === 0 ? 0.3 : 1 / 30;
        const r = stepBehavior(pure, input, dt);
        pure = r.state;
        stepBehaviorInto(mutable, input, dt, out);
        expect(mutable).toEqual(pure);
        expect(out.pose).toEqual(r.pose);
        expect(out.clip).toBe(r.clip.clip);
        expect(out.rule).toBe(r.clip.rule);
        expect(out.timeScale).toBe(r.timeScale);
        expect(out.events).toEqual(r.events);
      }
    }
  });
});

describe('C10 floating and C9 clamps', () => {
  it('wakes at most once per 1.2 s per floater', () => {
    expect(WAKE_INTERVAL_S).toBe(1.2);
    const spec = resolveBehavior({ role: 'floating', anchor: { x: 0, z: 0, yaw: 0 }, clips: ['idle'], radiusM: 3, surfaceY: 0, bobM: 0.05, driftMps: 0.4 }).spec;
    let state = initBehaviorState(spec, 5);
    const wakes: number[] = [];
    for (let i = 0; i < 60 * 30; i += 1) {
      const r = stepBehavior(state, { spec }, 1 / 30);
      state = r.state;
      for (const e of r.events) if (e.kind === 'wake') wakes.push(e.t);
    }
    for (let i = 1; i < wakes.length; i += 1) expect(wakes[i] - wakes[i - 1]).toBeGreaterThanOrEqual(1.2 - 1e-9);
  });

  it("a 'field' floater drops its synthetic bob only while the water handle is live", () => {
    const base = { role: 'floating' as const, anchor: { x: 0, z: 0, yaw: 0 }, clips: ['idle'], radiusM: 1, surfaceY: 0.5, bobM: 0.2, driftMps: 0 };
    const field = resolveBehavior({ ...base, buoyancy: 'field' }).spec;
    const ys = (water: boolean) => {
      let state = initBehaviorState(field, 3);
      const out: number[] = [];
      for (let i = 0; i < 300; i += 1) {
        const r = stepBehavior(state, { spec: field, water, life: 'reduced' }, 1 / 30);
        state = r.state;
        out.push(r.pose.y);
      }
      return out;
    };
    expect(new Set(ys(true).map((y) => y.toFixed(9)))).toEqual(new Set(['0.500000000']));
    expect(Math.max(...ys(false)) - Math.min(...ys(false))).toBeGreaterThan(0.1);
  });

  it('the mixer step is clamped to [0, 0.1] s', () => {
    expect(MIXER_MAX_STEP_S).toBe(0.1);
    const seen: number[] = [];
    const mixer = { update: (dt: number) => seen.push(dt) };
    advanceFigureMixer(mixer, 0.5, false);
    advanceFigureMixer(mixer, -1, false);
    advanceFigureMixer(mixer, Number.NaN, false);
    advanceFigureMixer(mixer, 0.02, false);
    expect(seen).toEqual([0.1, 0, 0, 0.02]);
  });

  it('life budgets are shared frozen objects (the director loop allocates none)', () => {
    expect(figureLifeBudget('full')).toBe(figureLifeBudget('full'));
    expect(Object.isFrozen(figureLifeBudget('static'))).toBe(true);
  });

  it('slot seeds key on the slot id, not a species', () => {
    expect(slotSeed('sakura-wild-3')).toBe(slotSeed('sakura-wild-3', 0, 0));
    expect(slotSeed('sakura-wild-3')).not.toBe(slotSeed('sakura-wild-4'));
  });
});

describe('loiter glance at the active board', () => {
  it('turns toward the target, clamped to the arc', () => {
    const anchor = { x: 0, z: 0, yaw: 0 };
    expect(loiterGlanceYaw(anchor, { x: 0, z: 10 }, LOOK_ARC_RAD)).toBeCloseTo(0, 9);
    expect(loiterGlanceYaw(anchor, { x: 1, z: 10 }, LOOK_ARC_RAD)).toBeCloseTo(Math.atan2(1, 10), 9);
    expect(loiterGlanceYaw(anchor, { x: 10, z: 0 }, LOOK_ARC_RAD)).toBeCloseTo(LOOK_ARC_RAD, 9);
    expect(loiterGlanceYaw(anchor, { x: -10, z: -1 }, LOOK_ARC_RAD)).toBeCloseTo(-LOOK_ARC_RAD, 9);
  });

  it('a loiterer with a board aims some holds at it and never leaves its arc', () => {
    const spec = resolveBehavior({ role: 'loiter', anchor: { x: 0, z: 0, yaw: 0.2 }, clips: ['idle'] }).spec;
    const board = { x: 3, z: 8 };
    const glance = loiterGlanceYaw(spec.anchor, board, LOOK_ARC_RAD);
    let state = initBehaviorState(spec, 17);
    let aimed = 0;
    for (let i = 0; i < 30 * 120; i += 1) {
      const r = stepBehavior(state, { spec, lookAt: board }, 1 / 30);
      state = r.state;
      expect(Math.abs(wrapAngle(r.pose.yaw - 0.2))).toBeLessThanOrEqual(LOOK_ARC_RAD + 1e-9);
      if (Math.abs(wrapAngle(state.goalYaw - glance)) < 1e-9) aimed += 1;
    }
    expect(aimed).toBeGreaterThan(0);
  });
});

describe('W2 same-clipKey filter (critique item 1, R7)', () => {
  const rows = [
    { id: 'a', clip: 'idle', phase01: 0.1, visible: true, model: 'models/regular/54.glb' },
    { id: 'b', clip: 'idle', phase01: 0.11, visible: true, model: 'models/regular/54.glb' },
    { id: 'c', clip: 'idle', phase01: 0.12, visible: true, model: 'models/regular/79.glb' },
    { id: 'd', clip: 'idle', phase01: 0.13, visible: true, clipKey: 'models/regular/79.glb|idle' },
  ];

  it('marks same-clipKey pairs and ignores cross-model pairs under the filter', () => {
    const all = phaseCollisions(rows);
    expect(all).toHaveLength(6);
    const key = (x: { a: string; b: string }) => [x.a, x.b].sort().join('');
    expect(Object.fromEntries(all.map((hit) => [key(hit), hit.sameClipKey]))).toEqual({
      ab: true,
      ac: false,
      ad: false,
      bc: false,
      bd: false,
      cd: true,
    });
    const same = phaseCollisions(rows, { sameClipKeyOnly: true });
    expect(same.map(key).sort()).toEqual(['ab', 'cd']);
    expect(phaseCollisionShare([rows], { sameClipKeyOnly: true }).every((pair) => pair.sameClipKey === true)).toBe(true);
  });

  it('derives a clipKey from model + clip, else from the row', () => {
    expect(rowClipKey({ clip: 'idle', model: 'm.glb' })).toBe('m.glb|idle');
    expect(rowClipKey({ clip: 'idle', model: null, clipKey: 'x|idle' })).toBe('x|idle');
    expect(rowClipKey({ clip: 'idle', model: null })).toBeNull();
    // Unknown models never count as same-clipKey.
    const [hit] = phaseCollisions([
      { id: 'a', clip: 'idle', phase01: 0.1, visible: true },
      { id: 'b', clip: 'idle', phase01: 0.1, visible: true },
    ]);
    expect(hit.sameClipKey).toBeNull();
  });
});

/* ── the plaza Walker's path step (A1 step 7, fix round) ─────────────────── */

describe('advanceWalkerPath (plaza Walker)', () => {
  /** A closed loop of `segments` straight segments of `segmentM` each. */
  const loop = (segmentM: number, segments: number) => {
    const length = segmentM * segments;
    return (s: number) => {
      const d = ((s % length) + length) % length;
      const into = d % segmentM;
      return into === 0 ? 0 : segmentM - into;
    };
  };
  const seeded = (seed: number) => {
    let x = seed >>> 0;
    return () => {
      x = (x * 1664525 + 1013904223) >>> 0;
      return x / 4294967296;
    };
  };
  const IDLE2 = { clip: 'idle2', passS: 2.4 };

  function run(opts: { segmentM: number; seconds: number; dt?: number; granted?: (t: number) => boolean; fidget?: { clip: string | null; passS: number } }) {
    const st = createWalkerPathState(0.3);
    const random = seeded(7);
    const dt = opts.dt ?? 1 / 40;
    const starts: number[] = [];
    const clips: string[] = [];
    let clip = 'walk';
    let walkingWhileFidget = 0;
    let pauseStartS = -1;
    let leftMidPass = 0;
    const toVertexAt = loop(opts.segmentM, 4);
    for (let t = 0; t < opts.seconds; t += dt) {
      const before = st.s;
      const passLeft = st.fidgetLeft;
      const clipBefore = clip;
      const next = advanceWalkerPath(st, dt, opts.granted ? opts.granted(t) : true, 1.1, toVertexAt, random, opts.fidget ?? IDLE2);
      if (next !== null) {
        if (next === 'idle2') starts.push(t);
        // Leaving while more than this step's worth of the pass remained.
        if (next === 'walk' && passLeft > dt + 1e-9) leftMidPass += 1;
        clip = next;
        clips.push(next);
        if (next !== 'walk' && pauseStartS < 0) pauseStartS = t;
        if (next === 'walk') pauseStartS = -1;
      }
      // A step that STARTED inside a pass never moves the walker (arriving at a vertex may open one).
      if (clipBefore === 'idle2' && st.s !== before) walkingWhileFidget += 1;
    }
    return { st, starts, clips, walkingWhileFidget, leftMidPass };
  }

  it('plays idle2 at least every WALKER_FIDGET_GAP_S on a long segment (it stops in place), never walking during a pass', () => {
    // 60 m segments at 1.1 m/s: ~55 s between vertices, so only the gap rule can fire.
    const { starts, walkingWhileFidget, leftMidPass } = run({ segmentM: 60, seconds: 120 });
    expect(starts.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < starts.length; i += 1) expect(starts[i] - starts[i - 1]).toBeLessThanOrEqual(WALKER_FIDGET_GAP_S + WALKER_PAUSE_S[1] + 0.05);
    expect(starts[0]).toBeLessThanOrEqual(WALKER_FIDGET_GAP_S + 0.05);
    expect(walkingWhileFidget).toBe(0);
    expect(leftMidPass).toBe(0);
  });

  it('keeps the every-other-vertex pass on short segments, and any 30 s window holds a pass', () => {
    const { starts, clips } = run({ segmentM: 4, seconds: 180 });
    expect(clips.filter((c) => c === 'idle').length).toBeGreaterThan(0);
    for (let t = 0; t + 30 <= 180; t += 1) expect(starts.some((s) => s >= t && s < t + 30)).toBe(true);
  });

  it('hops off a vertex only (a mid-segment stop sets off in place)', () => {
    const st = createWalkerPathState(5);
    const random = seeded(1);
    const toVertexAt = loop(60, 4);
    st.sinceFidget = WALKER_FIDGET_GAP_S; // overdue: the next walking step stops in place
    expect(advanceWalkerPath(st, 0.025, true, 1.1, toVertexAt, random, IDLE2)).toBe('idle2');
    expect(st.atVertex).toBe(false);
    const at = st.s;
    let next: string | null = null;
    for (let k = 0; k < 400 && next !== 'walk'; k += 1) next = advanceWalkerPath(st, 0.025, true, 1.1, toVertexAt, random, IDLE2);
    expect(next).toBe('walk');
    expect(st.s).toBe(at);
    // At a vertex the step off is WALKER_VERTEX_HOP_M.
    const v = createWalkerPathState(59.99);
    advanceWalkerPath(v, 0.025, true, 1.1, toVertexAt, random, NO_WALKER_FIDGET);
    expect(v.atVertex).toBe(true);
    const vs = v.s;
    for (let k = 0; k < 400 && v.pause > 0; k += 1) advanceWalkerPath(v, 0.025, true, 1.1, toVertexAt, random, NO_WALKER_FIDGET);
    expect(v.s).toBeCloseTo(vs + WALKER_VERTEX_HOP_M, 9);
  });

  it('a walker held for a mover slot still fidgets in place, and never moves', () => {
    const { st, starts } = run({ segmentM: 4, seconds: 90, granted: (t) => t < 1 });
    expect(starts.length).toBeGreaterThanOrEqual(3);
    expect(st.pause).toBeGreaterThan(0);
  });

  it('with fidgets off (NO_WALKER_FIDGET) plays and counts no pass', () => {
    const { starts, st } = run({ segmentM: 60, seconds: 120, fidget: NO_WALKER_FIDGET });
    expect(starts).toEqual([]);
    expect(st.sinceFidget).toBe(0);
  });

  /* ── R16: the gap is WALKER_FIDGET_GAP_S = 20 AWAKE seconds (a design value) ── */

  it('R16: the gap is 20 awake seconds, and the gap between passes never exceeds it by more than one step', () => {
    expect(WALKER_FIDGET_GAP_S).toBe(20);
    for (const segmentM of [4, 60]) {
      for (const dt of [1 / 30, 1 / 60]) {
        const { starts } = run({ segmentM, seconds: 240, dt });
        expect(starts.length).toBeGreaterThanOrEqual(11);
        expect(starts[0]).toBeLessThanOrEqual(WALKER_FIDGET_GAP_S + dt + 1e-9);
        for (let i = 1; i < starts.length; i += 1) expect(starts[i] - starts[i - 1]).toBeLessThanOrEqual(WALKER_FIDGET_GAP_S + dt + 1e-9);
        // So every 30 awake seconds hold a pass (the R16 capture bar's unit).
        for (let t = 0; t + 30 <= 240; t += 0.5) expect(starts.some((s) => s >= t && s < t + 30)).toBe(true);
      }
    }
  });

  it('R16 awake-time law: frames with no awake time (hidden, dormant: dt 0) accrue nothing toward the gap', () => {
    const st = createWalkerPathState(5);
    const random = seeded(3);
    const toVertexAt = loop(60, 4);
    // 19.9 awake seconds of walking on a long segment: no pass yet.
    for (let k = 0; k < 199; k += 1) expect(advanceWalkerPath(st, 0.1, true, 1.1, toVertexAt, random, IDLE2)).toBeNull();
    const s = st.s;
    const since = st.sinceFidget;
    // 10 000 frames (minutes of wall time) the director hands dt 0: nothing moves, nothing fires.
    for (let k = 0; k < 10000; k += 1) expect(advanceWalkerPath(st, 0, true, 1.1, toVertexAt, random, IDLE2)).toBeNull();
    expect(st.s).toBe(s);
    expect(st.sinceFidget).toBe(since);
    // The pass fires within the next awake 0.1 s + one step.
    let fired: string | null = null;
    for (let k = 0; k < 3 && fired === null; k += 1) fired = advanceWalkerPath(st, 0.1, true, 1.1, toVertexAt, random, IDLE2);
    expect(fired).toBe('idle2');
  });

  it('R16 awake-time law: 30 fps and 60 fps put every pass at the same awake second (to frame quantisation)', () => {
    const a = run({ segmentM: 60, seconds: 180, dt: 1 / 30 });
    const b = run({ segmentM: 60, seconds: 180, dt: 1 / 60 });
    expect(a.starts.length).toBe(b.starts.length);
    expect(a.starts.length).toBeGreaterThanOrEqual(8);
    // Each timed event (a pass start, a pause end) lands on a frame boundary, so the
    // two rates may part by at most one 30 fps frame per event so far — never by wall time.
    for (let i = 0; i < a.starts.length; i += 1) expect(Math.abs(a.starts[i] - b.starts[i])).toBeLessThanOrEqual(2 * (i + 1) * (1 / 30) + 1e-9);
    // The first pass is on the gap itself: one frame apart at most.
    expect(Math.abs(a.starts[0] - b.starts[0])).toBeLessThanOrEqual(1 / 30 + 1e-9);
  });

  it('is deterministic: the same seed and steps give the same state (the capture pin replays it)', () => {
    const a = run({ segmentM: 7, seconds: 75, dt: 0.1 });
    const b = run({ segmentM: 7, seconds: 75, dt: 0.1 });
    expect(a.st).toEqual(b.st);
    expect(a.clips).toEqual(b.clips);
  });
});
