import { describe, expect, it } from 'vitest';
import {
  createDirectionLatch,
  createInputIntent,
  NEAREST_STATION_BAND,
  seedBandLatch,
  seedStationLatch,
  stepBandLatch,
  stepDirectionLatch,
  stepDwellLatch,
  resolveInputIntent,
  stepInputIntent,
  type InputIntentOptions,
  stepMonotonePhase,
  stepStationLatch,
  type DirectionLatchOptions,
  type DirectionLatchState,
} from '../direction-latch';

/** Deterministic pseudo-noise in [-1, 1] — no Math.random in tests. */
function noise(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

describe('stepStationLatch (hysteretic nearest station)', () => {
  const COUNT = 5;

  it('seeds as a clamped round', () => {
    expect(seedStationLatch(0.49, COUNT)).toBe(0);
    expect(seedStationLatch(0.993, COUNT)).toBe(1);
    expect(seedStationLatch(3.996, COUNT)).toBe(4);
    expect(seedStationLatch(-2, COUNT)).toBe(0);
    expect(seedStationLatch(9, COUNT)).toBe(4);
    expect(seedStationLatch(Number.NaN, COUNT)).toBe(0);
  });

  it('noise within the band around every midpoint never toggles', () => {
    for (let n = 0; n < COUNT - 1; n += 1) {
      for (const start of [n, n + 1]) {
        let state = start;
        for (let i = 0; i < 2000; i += 1) {
          const position = n + 0.5 + noise(i + n * 7919) * NEAREST_STATION_BAND * 0.999;
          state = stepStationLatch(state, position, COUNT);
          expect(state).toBe(start);
        }
      }
    }
  });

  it('a monotone ramp crosses each boundary exactly once, past the band', () => {
    let state = 0;
    const changes: { at: number; to: number }[] = [];
    for (let i = 0; i <= 4000; i += 1) {
      const position = (i / 4000) * (COUNT - 1);
      const next = stepStationLatch(state, position, COUNT);
      if (next !== state) changes.push({ at: position, to: next });
      state = next;
    }
    expect(changes.map((c) => c.to)).toEqual([1, 2, 3, 4]);
    changes.forEach((c, k) => {
      expect(c.at).toBeGreaterThan(k + 0.5 + NEAREST_STATION_BAND);
      expect(c.at).toBeLessThan(k + 0.5 + NEAREST_STATION_BAND + 0.01);
    });

    const down: number[] = [];
    for (let i = 4000; i >= 0; i -= 1) {
      const position = (i / 4000) * (COUNT - 1);
      const next = stepStationLatch(state, position, COUNT);
      if (next !== state) down.push(next);
      state = next;
    }
    expect(down).toEqual([3, 2, 1, 0]);
  });

  it('a noisy ramp still crosses each boundary once (no retrigger)', () => {
    let state = 0;
    let changes = 0;
    for (let i = 0; i <= 8000; i += 1) {
      const position = (i / 8000) * (COUNT - 1) + noise(i) * 0.12;
      const next = stepStationLatch(state, position, COUNT);
      if (next !== state) changes += 1;
      expect(next).toBeGreaterThanOrEqual(state);
      state = next;
    }
    expect(changes).toBe(COUNT - 1);
  });

  it('jumps straight to the target station on a multi-station move', () => {
    expect(stepStationLatch(0, 3.0, COUNT)).toBe(3);
    expect(stepStationLatch(4, 0.2, COUNT)).toBe(0);
    expect(stepStationLatch(0, 0.993, COUNT)).toBe(1);
    expect(stepStationLatch(4, 2.3, COUNT)).toBe(2);
    expect(stepStationLatch(4, 2.4, COUNT)).toBe(3);
  });

  it('clamps to the route and ignores non-finite input', () => {
    expect(stepStationLatch(4, 12, COUNT)).toBe(4);
    expect(stepStationLatch(0, -3, COUNT)).toBe(0);
    expect(stepStationLatch(2, Number.NaN, COUNT)).toBe(2);
    expect(stepStationLatch(2, 1, 0)).toBe(0);
  });

  it('agrees with the generic band latch on n + 0.5 thresholds', () => {
    const thresholds = [0.5, 1.5, 2.5, 3.5];
    let a = 0;
    let b = seedBandLatch(0, thresholds);
    for (let i = 0; i < 6000; i += 1) {
      const position = 2 + Math.sin(i / 90) * 2.2 + noise(i) * 0.1;
      a = stepStationLatch(a, position, 5, 0.15);
      b = stepBandLatch(b, position, { thresholds, band: 0.15 });
      expect(a).toBe(b);
    }
  });
});

describe('stepBandLatch (enter/exit thresholds)', () => {
  const thresholds = [10, 20];

  it('seeds by plain lookup', () => {
    expect(seedBandLatch(5, thresholds)).toBe(0);
    expect(seedBandLatch(10, thresholds)).toBe(1);
    expect(seedBandLatch(25, thresholds)).toBe(2);
  });

  it('needs band past the boundary to enter and to exit', () => {
    const opts = { thresholds, band: 2 };
    expect(stepBandLatch(0, 11.9, opts)).toBe(0);
    expect(stepBandLatch(0, 12.1, opts)).toBe(1);
    expect(stepBandLatch(1, 8.1, opts)).toBe(1);
    expect(stepBandLatch(1, 7.9, opts)).toBe(0);
    expect(stepBandLatch(0, 30, opts)).toBe(2);
  });
});

describe('stepDirectionLatch (deadband + dwell in seconds)', () => {
  const opts: DirectionLatchOptions = { deadband: 0.02, minDwell: 0.25 };

  function run(
    samples: readonly { t: number; v: number }[],
    options: DirectionLatchOptions = opts,
  ): DirectionLatchState[] {
    let state = createDirectionLatch(samples[0].v, samples[0].t);
    return samples.map(({ t, v }) => (state = stepDirectionLatch(state, v, t, options)));
  }

  it('stays at rest while motion is inside the deadband', () => {
    const samples = Array.from({ length: 200 }, (_, i) => ({ t: i / 60, v: i === 0 ? 1 : 1 + noise(i) * 0.019 }));
    expect(run(samples).every((s) => s.direction === 0)).toBe(true);
  });

  it('latches forward and ignores backward noise smaller than the deadband', () => {
    const samples = Array.from({ length: 600 }, (_, i) => ({
      t: i / 60,
      v: i * 0.01 + noise(i) * 0.009,
    }));
    const states = run(samples);
    const firstMove = states.findIndex((s) => s.direction !== 0);
    expect(firstMove).toBeGreaterThan(0);
    expect(states.slice(firstMove).every((s) => s.direction === 1)).toBe(true);
  });

  it('reverses once when the input really reverses', () => {
    const samples: { t: number; v: number }[] = [];
    for (let i = 0; i < 120; i += 1) samples.push({ t: i / 60, v: i * 0.01 });
    for (let i = 0; i < 120; i += 1) samples.push({ t: (120 + i) / 60, v: 1.19 - i * 0.01 });
    const dirs = run(samples).map((s) => s.direction);
    const flips = dirs.filter((d, i) => i > 0 && d !== dirs[i - 1] && dirs[i - 1] !== 0);
    expect(flips).toEqual([-1]);
    expect(dirs[dirs.length - 1]).toBe(-1);
  });

  it('holds the direction for minDwell seconds even through a genuine retreat', () => {
    let state = createDirectionLatch(0, 0);
    state = stepDirectionLatch(state, 0.05, 0.0, opts); // latches +1 at t=0
    expect(state.direction).toBe(1);
    state = stepDirectionLatch(state, -0.2, 0.1, opts); // retreat before dwell
    expect(state.direction).toBe(1);
    state = stepDirectionLatch(state, -0.2, 0.26, opts); // dwell elapsed
    expect(state.direction).toBe(-1);
  });

  it('noise around a turning point cannot flip-flop (at most one reversal per dwell)', () => {
    let state = createDirectionLatch(0, 0);
    const dirs: number[] = [];
    // Jitter ±0.05 around 0.5 at 60 Hz for 2 s — bigger than the deadband.
    for (let i = 0; i < 120; i += 1) {
      state = stepDirectionLatch(state, 0.5 + noise(i) * 0.05, i / 60, opts);
      dirs.push(state.direction);
    }
    let flips = 0;
    for (let i = 1; i < dirs.length; i += 1) if (dirs[i] !== dirs[i - 1] && dirs[i - 1] !== 0) flips += 1;
    // 2 s / 0.25 s dwell = at most 8 reversals; frame-rate noise alone would
    // produce dozens.
    expect(flips).toBeLessThanOrEqual(8);
  });

  it('dwell is measured in supplied seconds, not in samples', () => {
    // Same motion at 30 Hz and 240 Hz: the reversal lands at the same time.
    const reversalTime = (hz: number) => {
      let state = createDirectionLatch(0, 0);
      for (let i = 0; i <= hz * 2; i += 1) {
        const t = i / hz;
        const v = t < 0.1 ? t : 0.1 - (t - 0.1);
        const next = stepDirectionLatch(state, v, t, opts);
        if (state.direction === 1 && next.direction === -1) return t;
        state = next;
      }
      return Number.NaN;
    };
    const slow = reversalTime(30);
    const fast = reversalTime(240);
    expect(slow).toBeGreaterThanOrEqual(0.25);
    expect(Math.abs(slow - fast)).toBeLessThan(1 / 30 + 1e-9);
  });

  it('returns to rest after idleAfter seconds without forward movement', () => {
    const options = { ...opts, idleAfter: 0.5 };
    let state = createDirectionLatch(0, 0);
    state = stepDirectionLatch(state, 0.1, 0.1, options);
    expect(state.direction).toBe(1);
    state = stepDirectionLatch(state, 0.1, 0.4, options);
    expect(state.direction).toBe(1);
    state = stepDirectionLatch(state, 0.1, 0.61, options);
    expect(state.direction).toBe(0);
  });

  it('returns the same object when nothing changed', () => {
    const state = createDirectionLatch(1, 0);
    expect(stepDirectionLatch(state, 1.001, 0.1, opts)).toBe(state);
    expect(stepDirectionLatch(state, Number.NaN, 0.1, opts)).toBe(state);
  });
});

describe('stepDwellLatch', () => {
  it('accepts a change only after the dwell', () => {
    let state = { value: 'idle', since: 0 };
    state = stepDwellLatch(state, 'walk', 0.5, 1);
    expect(state.value).toBe('idle');
    state = stepDwellLatch(state, 'walk', 1.0, 1);
    expect(state).toEqual({ value: 'walk', since: 1.0 });
    state = stepDwellLatch(state, 'idle', 1.5, 1);
    expect(state.value).toBe('walk');
  });
});

describe('stepMonotonePhase', () => {
  const order = ['loading', 'opening', 'beam', 'presented'] as const;

  it('only advances within a token', () => {
    expect(stepMonotonePhase(order, 'opening', 'loading', 1, 1)).toBe('opening');
    expect(stepMonotonePhase(order, 'opening', 'beam', 1, 1)).toBe('beam');
    expect(stepMonotonePhase(order, 'presented', 'opening', 1, 1)).toBe('presented');
  });

  it('resets on a new token', () => {
    expect(stepMonotonePhase(order, 'presented', 'loading', 2, 1)).toBe('loading');
  });
});

describe('input-intent override (stale latch, wave-2 r2)', () => {
  const OPTS: InputIntentOptions = { minRun: 2, eps: 0.02, staleAfter: 0.6 };

  it('does not act on a single step, however far smooth moves', () => {
    const intent = stepInputIntent(createInputIntent(), 1, 0.19, 13.947);
    expect(resolveInputIntent(intent, -1, 0.3, 14.0, OPTS).flip).toBeNull();
  });

  it('flips a reversed latch after 2 same-sign steps once smooth moved eps with them', () => {
    let intent = stepInputIntent(createInputIntent(), 1, 0.1929, 13.947);
    intent = stepInputIntent(intent, 1, 0.2594, 14.047);
    expect(resolveInputIntent(intent, -1, 0.2813, 14.064, OPTS).flip).toBe(1);
  });

  it('flips at the scroll-end clamp without any scroll sample (exact already clamped)', () => {
    let intent = stepInputIntent(createInputIntent(), 1, 3.673, 20.569);
    intent = stepInputIntent(intent, 1, 3.713, 20.619);
    intent = stepInputIntent(intent, 1, 3.744, 20.669);
    expect(resolveInputIntent(intent, -1, 3.82, 20.72, OPTS).flip).toBe(1);
  });

  it('measures travel from the least-advanced smooth, not the run start', () => {
    let intent = stepInputIntent(createInputIntent(), 1, 0.5, 1.0);
    // smooth still coasting backward as the run starts…
    intent = resolveInputIntent(intent, -1, 0.48, 1.02, OPTS).state;
    intent = stepInputIntent(intent, 1, 0.47, 1.1);
    intent = resolveInputIntent(intent, -1, 0.47, 1.11, OPTS).state;
    expect(resolveInputIntent(intent, -1, 0.485, 1.12, OPTS).flip).toBeNull();
    expect(resolveInputIntent(intent, -1, 0.491, 1.13, OPTS).flip).toBe(1);
  });

  it('never builds a run under an alternating dither', () => {
    let intent = createInputIntent();
    for (let i = 0; i < 20; i += 1) {
      const sign = i % 2 === 0 ? 1 : -1;
      intent = stepInputIntent(intent, sign, 0.5 + sign * 0.05, i * 0.09);
      expect(intent.run).toBe(1);
      expect(resolveInputIntent(intent, sign === 1 ? -1 : 1, 0.5 + sign * 0.1, i * 0.09 + 0.05, OPTS).flip).toBeNull();
    }
  });

  it('leaves rest (0) and an agreeing direction alone, and ignores stale input', () => {
    let intent = stepInputIntent(createInputIntent(), 1, 1.0, 2.0);
    intent = stepInputIntent(intent, 1, 1.0, 2.1);
    expect(resolveInputIntent(intent, 0, 1.2, 2.2, OPTS).flip).toBeNull();
    expect(resolveInputIntent(intent, 1, 1.2, 2.2, OPTS).flip).toBeNull();
    expect(resolveInputIntent(intent, -1, 1.2, 2.8, OPTS).flip).toBeNull();
  });

  it('returns the same state object when nothing changed', () => {
    const intent = stepInputIntent(stepInputIntent(createInputIntent(), -1, 2.0, 1), -1, 1.9, 1.1);
    expect(resolveInputIntent(intent, -1, 1.95, 1.2, OPTS).state).toBe(intent);
  });
});
