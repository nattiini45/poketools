import { describe, expect, it } from 'vitest';
import {
  figureLifeBudget,
  GROUND_TURN_RATE,
  initBehaviorState,
  LOOK_ARC_RAD,
  MAX_STEP_S,
  PLAY_EVERY_S,
  resolveBehavior,
  selectClip,
  slotSeed,
  stepBehavior,
  turnToward,
  wrapAngle,
  type BehaviorEvent,
  type BehaviorInput,
  type BehaviorSpec,
  type BehaviorState,
  type ClipPick,
  type StepResult,
} from '../figure-behavior';
import type { FigureLifeLevel } from '../quality';

/**
 * Spec §5.1 behavior contract. Every test here encodes a law the W2/W3 bars
 * (or one of the four defects of the abandoned worktree contract, D10) hinge
 * on: no treadmill on a degenerate path, the authored yaw survives, seeds are
 * per slot, idle2 is reachable, and time is accumulated delta, never frames.
 */

const FULL = ['idle', 'idle2', 'walk', 'run'];
const IDLE_ONLY = ['idle'];

function run(
  spec: BehaviorSpec,
  seconds: number,
  opts: { dt?: number; seed?: number; life?: FigureLifeLevel; moverSlot?: boolean } = {},
): { frames: StepResult[]; events: BehaviorEvent[]; resolved: BehaviorSpec } {
  const resolved = resolveBehavior(spec).spec;
  const dt = opts.dt ?? 1 / 30;
  let state = initBehaviorState(resolved, opts.seed ?? 1);
  const input: BehaviorInput = { spec: resolved, life: opts.life, moverSlot: opts.moverSlot };
  const frames: StepResult[] = [];
  const events: BehaviorEvent[] = [];
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i += 1) {
    const r = stepBehavior(state, input, dt);
    frames.push(r);
    events.push(...r.events);
    state = r.state;
  }
  return { frames, events, resolved };
}

const clipOf = (pick: ClipPick) => pick.clip;

function patrol(overrides: Partial<Extract<BehaviorSpec, { role: 'patrol' }>> = {}): BehaviorSpec {
  return {
    role: 'patrol',
    anchor: { x: 0, z: 0, yaw: 0.4 },
    clips: FULL,
    path: [
      [0, 0],
      [4, 0],
      [4, 3],
    ],
    speedMps: 0.9,
    locomotionTimeScale: 1.1,
    ...overrides,
  };
}

describe('resolveBehavior', () => {
  it('never lets a degenerate path patrol (the worktree treadmill)', () => {
    const single = resolveBehavior(patrol({ path: [[2, 2]] }));
    expect(single.spec.role).toBe('loiter');
    expect(single.downgraded).toEqual({ from: 'patrol', reason: 'degenerate-path' });

    const repeated = resolveBehavior(patrol({ path: [[2, 2], [2, 2], [2.0000001, 2]] }));
    expect(repeated.spec.role).toBe('loiter');

    const tiny = resolveBehavior(patrol({ path: [[0, 0], [0.2, 0.1]] }));
    expect(tiny.spec.role).toBe('loiter');
  });

  it('downgrades path roles on models with no usable locomotion clip', () => {
    expect(resolveBehavior(patrol({ clips: IDLE_ONLY })).downgraded?.reason).toBe('no-locomotion-clip');
    // Run-only rigs patrol only when the profile asks for the faster gait.
    expect(resolveBehavior(patrol({ clips: ['run'] })).spec.role).toBe('loiter');
    expect(resolveBehavior(patrol({ clips: ['run'], gait: 'run' })).spec.role).toBe('patrol');
    const waterline = resolveBehavior({
      role: 'waterline',
      anchor: { x: 0, z: 0, yaw: 0 },
      clips: IDLE_ONLY,
      edge: [0, 3],
      after: 'retreat',
      speedMps: 0.6,
    });
    expect(waterline.spec.role).toBe('loiter');
  });

  it('keeps the authored anchor and yaw on a downgrade', () => {
    const r = resolveBehavior(patrol({ path: [[9, 9]], anchor: { x: 1, z: 2, yaw: 2.2 } }));
    expect(r.spec.anchor).toEqual({ x: 1, z: 2, yaw: 2.2 });
  });

  it('passes healthy specs through', () => {
    expect(resolveBehavior(patrol()).downgraded).toBeNull();
  });
});

describe('selectClip (spec §5.1 order)', () => {
  const cases: [string, Parameters<typeof selectClip>[0], ClipPick['clip'], ClipPick['rule']][] = [
    ['1: requested locomotion while moving', { clips: FULL, role: 'patrol', locomotion: true, requested: 'run' }, 'run', 1],
    ['1: requested fidget while stopped', { clips: FULL, role: 'loiter', locomotion: false, requested: 'idle2' }, 'idle2', 1],
    ['1 skipped: locomotion request while stopped', { clips: FULL, role: 'patrol', locomotion: false, requested: 'walk' }, 'idle', 4],
    ['1 skipped: request not in file', { clips: IDLE_ONLY, role: 'loiter', locomotion: false, requested: 'idle2' }, 'idle', 4],
    ['2: walk for a moving patrol', { clips: FULL, role: 'patrol', locomotion: true }, 'walk', 2],
    ['2: walk for a moving waterline', { clips: FULL, role: 'waterline', locomotion: true }, 'walk', 2],
    ['3: run only on request', { clips: ['idle', 'run'], role: 'patrol', locomotion: true, wantsRun: true }, 'run', 3],
    ['3 beaten by 2 when walk exists', { clips: FULL, role: 'patrol', locomotion: true, wantsRun: true }, 'walk', 2],
    ['4: idle when stopped', { clips: FULL, role: 'patrol', locomotion: false }, 'idle', 4],
    ['4: idle for floating (no fabricated gait)', { clips: FULL, role: 'floating', locomotion: false }, 'idle', 4],
    ['5: first available non-locomotion clip', { clips: ['walk', 'idle2'], role: 'loiter', locomotion: false }, 'idle2', 5],
    ['5: first available while moving', { clips: ['idle2'], role: 'patrol', locomotion: true }, 'idle2', 5],
  ];
  it.each(cases)('%s', (_name, request, clip, rule) => {
    const pick = selectClip(request);
    expect(pick.clip).toBe(clip);
    expect(pick.rule).toBe(rule);
  });

  it('6: documented low-motion fallback, never a locomotion clip in place', () => {
    expect(selectClip({ clips: [], role: 'loiter', locomotion: false })).toEqual({ clip: null, rule: 6, freezeClip: null });
    // Grovyle-shaped (run, walk; no idle) and Wigglytuff-shaped (run only).
    expect(selectClip({ clips: ['run', 'walk'], role: 'loiter', locomotion: false })).toEqual({ clip: null, rule: 6, freezeClip: 'run' });
    expect(selectClip({ clips: ['run'], role: 'stationary', locomotion: false }).clip).toBeNull();
  });
});

describe('patrol', () => {
  it('moves along the path, turning at no more than the grounded rate', () => {
    const { frames } = run(patrol(), 60);
    const spec = resolveBehavior(patrol()).spec as Extract<BehaviorSpec, { role: 'patrol' }>;
    let travelled = 0;
    for (let i = 1; i < frames.length; i += 1) {
      const a = frames[i - 1].pose;
      const b = frames[i].pose;
      travelled += Math.hypot(b.x - a.x, b.z - a.z);
      expect(Math.abs(wrapAngle(b.yaw - a.yaw))).toBeLessThanOrEqual(GROUND_TURN_RATE / 30 + 1e-9);
      // Always on one of the two segments.
      const onFirst = Math.abs(b.z) < 1e-6 && b.x >= -1e-6 && b.x <= 4 + 1e-6;
      const onSecond = Math.abs(b.x - 4) < 1e-6 && b.z >= -1e-6 && b.z <= 3 + 1e-6;
      expect(onFirst || onSecond).toBe(true);
    }
    expect(travelled).toBeGreaterThan(10);
    expect(spec.path.length).toBe(3);
  });

  it('plays walk (stride-matched) only while translating and idle while stopped', () => {
    const { frames } = run(patrol(), 60);
    for (let i = 1; i < frames.length; i += 1) {
      const a = frames[i - 1].pose;
      const b = frames[i].pose;
      const moved = Math.hypot(b.x - a.x, b.z - a.z) > 1e-9;
      if (moved) {
        expect(frames[i].clip.clip).toBe('walk');
        expect(frames[i].timeScale).toBe(1.1);
      } else {
        expect(frames[i].clip.clip === 'idle' || frames[i].clip.clip === 'idle2').toBe(true);
        expect(frames[i].timeScale).toBe(1);
      }
    }
  });

  it('pauses on seeded schedules that differ per slot seed', () => {
    const pauses = (seed: number) =>
      run(patrol(), 90, { seed })
        .frames.map((f) => (f.state.mode === 'pause' ? 1 : 0))
        .join('');
    const a = pauses(slotSeed('Marill', 11.9, -4.9));
    const b = pauses(slotSeed('Marill', 12.4, -4.9));
    expect(a.includes('1')).toBe(true);
    expect(a).not.toBe(b);
  });

  it('ping-pongs an open path instead of teleporting', () => {
    const { frames } = run(patrol({ path: [[0, 0], [3, 0]] }), 60);
    const xs = frames.map((f) => f.pose.x);
    for (let i = 1; i < xs.length; i += 1) expect(Math.abs(xs[i] - xs[i - 1])).toBeLessThan(0.1);
    expect(Math.max(...xs)).toBeGreaterThan(2.9);
    expect(Math.min(...xs)).toBeLessThan(0.1);
  });

  it('holds still when the rung or the director removes path movement', () => {
    for (const opts of [{ life: 'minimal' as const }, { life: 'static' as const }, { moverSlot: false }]) {
      const { frames } = run(patrol(), 30, opts);
      const first = frames[0].pose;
      for (const f of frames) {
        expect(Math.hypot(f.pose.x - first.x, f.pose.z - first.z)).toBeLessThan(1e-9);
        expect(f.clip.clip === 'walk' || f.clip.clip === 'run').toBe(false);
      }
    }
  });
});

describe('degenerate path regression (worktree defect 1 + 2)', () => {
  it('stands at the authored anchor with the authored yaw instead of walking in place', () => {
    const spec = patrol({ path: [[11.9, -4.9]], anchor: { x: 11.9, z: -4.9, yaw: -0.92 } });
    const { frames } = run(spec, 60);
    for (const f of frames) {
      expect(f.pose.x).toBe(11.9);
      expect(f.pose.z).toBe(-4.9);
      expect(Math.abs(wrapAngle(f.pose.yaw - -0.92))).toBeLessThanOrEqual(LOOK_ARC_RAD + 1e-9);
      expect(f.clip.clip).not.toBe('walk');
      expect(f.clip.clip).not.toBe('run');
    }
  });
});

describe('loiter', () => {
  const loiter: BehaviorSpec = { role: 'loiter', anchor: { x: 1, z: 1, yaw: 2.0 }, clips: FULL };

  it('keeps the authored yaw within bounded look arcs, and actually looks around', () => {
    const { frames } = run(loiter, 120);
    let maxOff = 0;
    for (const f of frames) {
      const off = Math.abs(wrapAngle(f.pose.yaw - 2.0));
      maxOff = Math.max(maxOff, off);
      expect(off).toBeLessThanOrEqual(LOOK_ARC_RAD + 1e-9);
      expect(f.pose.x).toBe(1);
    }
    expect(maxOff).toBeGreaterThan(0.05);
  });

  it('has no look arcs at the static rung', () => {
    const { frames } = run(loiter, 60, { life: 'static' });
    frames.forEach((f) => expect(f.pose.yaw).toBeCloseTo(2.0, 9));
  });
});

describe('idle2 is reachable (worktree defect 4)', () => {
  it('stationary and loiter figures play seeded idle2 fidgets between idles', () => {
    for (const role of ['stationary', 'loiter'] as const) {
      const clips = run({ role, anchor: { x: 0, z: 0, yaw: 0 }, clips: FULL }, 120).frames.map((f) => clipOf(f.clip));
      expect(clips).toContain('idle2');
      expect(clips).toContain('idle');
      expect(clips).not.toContain('walk');
    }
  });

  it('fidgets stop at the static rung', () => {
    const clips = run({ role: 'stationary', anchor: { x: 0, z: 0, yaw: 0 }, clips: FULL }, 120, { life: 'static' }).frames.map((f) =>
      clipOf(f.clip),
    );
    expect(new Set(clips)).toEqual(new Set(['idle']));
  });

  it('two slots of one species fidget on different schedules (worktree defect 3)', () => {
    const spec: BehaviorSpec = { role: 'stationary', anchor: { x: 0, z: 0, yaw: 0 }, clips: FULL };
    const a = run(spec, 120, { seed: slotSeed('Marill', 1, 2) }).frames.map((f) => clipOf(f.clip)).join();
    const b = run(spec, 120, { seed: slotSeed('Marill', 3, 2) }).frames.map((f) => clipOf(f.clip)).join();
    expect(a).not.toBe(b);
  });
});

describe('waterline', () => {
  const base = {
    role: 'waterline' as const,
    anchor: { x: 0, z: 0, yaw: 0 },
    clips: FULL,
    edge: [0, 3] as const,
    speedMps: 0.8,
    locomotionTimeScale: 1,
  };

  it('emits exactly ONE contact per arrival at the edge, at the edge', () => {
    const { frames, events } = run({ ...base, after: 'retreat' }, 180);
    const contacts = events.filter((e) => e.kind === 'contact');
    let arrivals = 0;
    for (let i = 1; i < frames.length; i += 1) {
      const atEdge = (f: StepResult) => Math.hypot(f.pose.x - 0, f.pose.z - 3) < 1e-9;
      if (atEdge(frames[i]) && !atEdge(frames[i - 1])) arrivals += 1;
    }
    expect(arrivals).toBeGreaterThanOrEqual(2);
    expect(contacts.length).toBe(arrivals);
    contacts.forEach((c) => {
      expect(c.x).toBe(0);
      expect(c.z).toBe(3);
    });
  });

  it('remains at the edge after one contact when the profile says so', () => {
    const { frames, events } = run({ ...base, after: 'remain' }, 120);
    expect(events.filter((e) => e.kind === 'contact')).toHaveLength(1);
    const last = frames[frames.length - 1].pose;
    expect(last.z).toBe(3);
  });
});

describe('floating', () => {
  const floating: BehaviorSpec = {
    role: 'floating',
    anchor: { x: 2, z: -8, yaw: 0 },
    clips: IDLE_ONLY,
    radiusM: 2.5,
    surfaceY: 0.06,
    bobM: 0.05,
    driftMps: 0.35,
    playLiftM: 0.6,
    diveDepthM: 0.8,
  };

  it('bobs and drifts inside its region, never claiming ground contact', () => {
    const { frames } = run(floating, 180);
    for (const f of frames) {
      expect(Math.hypot(f.pose.x - 2, f.pose.z + 8)).toBeLessThanOrEqual(2.5 + 1e-9);
      expect(f.pose.y).toBeGreaterThanOrEqual(0.06 - 0.05 - 0.8 - 1e-9);
      expect(f.pose.y).toBeLessThanOrEqual(0.06 + 0.05 + 0.6 + 1e-9);
      expect(f.pose.grounded).toBe(false);
      expect(f.clip.clip).toBe('idle');
    }
    const ys = frames.map((f) => f.pose.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.05);
  });

  it('emits an entry contact, wakes while drifting, and seeded play events', () => {
    const { events } = run(floating, 240);
    expect(events[0]).toMatchObject({ kind: 'contact', cause: 'enter' });
    expect(events.filter((e) => e.kind === 'wake').length).toBeGreaterThan(10);
    const plays = events.filter((e): e is Extract<BehaviorEvent, { kind: 'play' }> => e.kind === 'play');
    expect(plays.length).toBeGreaterThanOrEqual(240 / PLAY_EVERY_S[1] - 1);
    for (let i = 1; i < plays.length; i += 1) {
      expect(plays[i].t - plays[i - 1].t).toBeGreaterThanOrEqual(PLAY_EVERY_S[0]);
    }
  });

  it('play schedules differ per slot and switch off below the full rung', () => {
    const times = (seed: number) =>
      run(floating, 200, { seed })
        .events.filter((e) => e.kind === 'play')
        .map((e) => e.t.toFixed(2))
        .join();
    expect(times(slotSeed('Psyduck', 1, -8))).not.toBe(times(slotSeed('Psyduck', 3, -8)));
    const reduced = run(floating, 200, { life: 'reduced' }).events;
    expect(reduced.some((e) => e.kind === 'play')).toBe(false);
  });
});

describe('airborne', () => {
  it('hovers inside its region with no ground claim and no events', () => {
    const { frames, events } = run(
      { role: 'airborne', anchor: { x: -11, z: -12, yaw: 0.6 }, clips: IDLE_ONLY, radiusM: 1.5, hoverY: 4, bobM: 0.2, driftMps: 0.4 },
      120,
    );
    expect(events).toHaveLength(0);
    for (const f of frames) {
      expect(f.pose.grounded).toBe(false);
      expect(f.pose.y).toBeGreaterThanOrEqual(3.8 - 1e-9);
      expect(f.pose.y).toBeLessThanOrEqual(4.2 + 1e-9);
      expect(Math.hypot(f.pose.x + 11, f.pose.z + 12)).toBeLessThanOrEqual(1.5 + 1e-9);
    }
  });
});

describe('time is accumulated clamped delta, never frames', () => {
  it('clamps a huge delta to MAX_STEP_S', () => {
    const spec = resolveBehavior(patrol()).spec;
    const s = initBehaviorState(spec, 3);
    const r = stepBehavior(s, { spec }, 5);
    expect(r.state.t).toBeCloseTo(MAX_STEP_S);
    expect(stepBehavior(s, { spec }, -1).state.t).toBe(0);
    expect(stepBehavior(s, { spec }, Number.NaN).state.t).toBe(0);
  });

  it('covers the same ground at 30 and 60 fps', () => {
    const dist = (dt: number) => {
      const { frames } = run(patrol({ path: [[0, 0], [40, 0]] }), 20, { dt, seed: 5 });
      return frames[frames.length - 1].state.t;
    };
    expect(dist(1 / 30)).toBeCloseTo(dist(1 / 60), 6);
    const x = (dt: number) => {
      const { frames } = run(patrol({ path: [[0, 0], [40, 0]] }), 20, { dt, seed: 5 });
      return frames[frames.length - 1].pose.x;
    };
    expect(Math.abs(x(1 / 30) - x(1 / 60))).toBeLessThan(0.15);
  });
});

describe('purity and serialization', () => {
  it('never mutates its input state', () => {
    const spec = resolveBehavior(patrol()).spec;
    const s = initBehaviorState(spec, 3);
    const snapshot = JSON.stringify(s);
    stepBehavior(s, { spec }, 0.05);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('round-trips through JSON and resumes identically', () => {
    for (const spec of [patrol(), { role: 'floating', anchor: { x: 0, z: 0, yaw: 0 }, clips: IDLE_ONLY, radiusM: 2, surfaceY: 0, bobM: 0.05, driftMps: 0.3 } as BehaviorSpec]) {
      const resolved = resolveBehavior(spec).spec;
      let s: BehaviorState = initBehaviorState(resolved, 9);
      for (let i = 0; i < 300; i += 1) s = stepBehavior(s, { spec: resolved }, 1 / 30).state;
      const copy = JSON.parse(JSON.stringify(s)) as BehaviorState;
      expect(copy).toEqual(s);
      expect(stepBehavior(copy, { spec: resolved }, 1 / 30)).toEqual(stepBehavior(s, { spec: resolved }, 1 / 30));
    }
  });
});

describe('helpers and budgets', () => {
  it('turns along the shortest arc without overshoot', () => {
    expect(turnToward(3.0, -3.0, 0.1)).toBeCloseTo(wrapAngle(3.1));
    expect(turnToward(0, 0.05, 0.1)).toBeCloseTo(0.05);
  });

  it('seeds per slot, not per species', () => {
    expect(slotSeed('Marill', 1, 2)).not.toBe(slotSeed('Marill', 1.5, 2));
    expect(slotSeed('Marill', 1, 2)).toBe(slotSeed('Marill', 1, 2));
  });

  it('degrades figure life monotonically across levels', () => {
    const levels: FigureLifeLevel[] = ['full', 'reduced', 'minimal', 'static'];
    for (let i = 1; i < levels.length; i += 1) {
      const a = figureLifeBudget(levels[i - 1]);
      const b = figureLifeBudget(levels[i]);
      expect(b.maxMovers).toBeLessThanOrEqual(a.maxMovers);
      if (b.paths) expect(a.paths).toBe(true);
      if (b.fidgets) expect(a.fidgets).toBe(true);
      if (b.playEvents) expect(a.playEvents).toBe(true);
    }
  });
});
