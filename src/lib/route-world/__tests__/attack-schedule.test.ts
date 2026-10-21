import { describe, expect, it } from 'vitest';
import {
  attackIntervalS,
  createAttackSchedule,
  DEFAULT_ATTACK_SCHEDULE,
  stepAttackSchedule,
  type AttackFire,
  type AttackScheduleConfig,
  type AttackScheduleState,
  type AttackStepInput,
} from '../attack-schedule';
import {
  ATTACK_TYPES,
  ATTACK_VFX_KINDS,
  attackDurationS,
  attackForType,
  glowPulseForType,
  normalizeAttackType,
} from '../attack-moves';

/**
 * Fidelity W5 — attacks are seeded, low-frequency, staggered (never in sync,
 * never a metronome), quiet while the camera crosses / a panel is open / the
 * loader is up, and keyed by manifest type with a real wind-up.
 */

const CONFIG: AttackScheduleConfig = { seed: 20260926, ...DEFAULT_ATTACK_SCHEDULE };

const GROUPS = [
  { id: 'sakura:pulse', memberIds: ['vaporeon', 'lombre', 'marill'] },
  { id: 'sakura:schedule', memberIds: ['psyduck', 'poliwag'] },
  { id: 'sakura:roster', memberIds: ['wingull'] },
  { id: 'sakura:aces', memberIds: ['azumarill', 'slowpoke'] },
];

const QUIET = { cameraCrossing: false, focusOpen: false, loaderUp: false };

function input(overrides: Partial<AttackStepInput> = {}): AttackStepInput {
  return {
    deltaS: 0.1,
    visibleGroupIds: GROUPS.map((group) => group.id),
    suppression: QUIET,
    level: 'full',
    reducedMotion: false,
    ...overrides,
  };
}

function run(
  seconds: number,
  make: (t: number) => AttackStepInput = () => input(),
  start: AttackScheduleState = createAttackSchedule(GROUPS, CONFIG),
): { fires: AttackFire[]; state: AttackScheduleState } {
  let state = start;
  const fires: AttackFire[] = [];
  const steps = Math.round(seconds / 0.1);
  for (let i = 0; i < steps; i += 1) {
    const step = stepAttackSchedule(state, make(i * 0.1), CONFIG);
    state = step.state;
    if (step.fire) fires.push(step.fire);
  }
  return { fires, state };
}

describe('attack schedule — cadence', () => {
  it('is deterministic per seed', () => {
    expect(run(900).fires).toEqual(run(900).fires);
  });

  it('draws intervals in [45, 90] s that vary (no metronome)', () => {
    const intervals = Array.from({ length: 30 }, (_, i) => attackIntervalS(CONFIG, 'sakura:pulse', i + 1));
    for (const interval of intervals) {
      expect(interval).toBeGreaterThanOrEqual(45);
      expect(interval).toBeLessThanOrEqual(90);
    }
    const distinct = new Set(intervals.map((v) => v.toFixed(1)));
    expect(distinct.size).toBeGreaterThan(20);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const sd = Math.sqrt(intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length);
    expect(sd).toBeGreaterThan(5);
  });

  it('a lone visible group fires roughly once per 45–90 s with varied gaps', () => {
    const { fires } = run(1800, () => input({ visibleGroupIds: ['sakura:pulse'] }));
    const times = fires.map((fire) => fire.atS);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(gaps.length).toBeGreaterThan(15);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(45 - 0.11);
      expect(gap).toBeLessThanOrEqual(90 + CONFIG.minSeparationS + CONFIG.separationJitterS + 0.2);
    }
    expect(new Set(gaps.map((gap) => gap.toFixed(0))).size).toBeGreaterThan(8);
  });

  it('staggers groups: never two fires in one step, always the minimum separation apart', () => {
    const { fires } = run(3600);
    expect(fires.length).toBeGreaterThan(40);
    for (let i = 1; i < fires.length; i += 1) {
      expect(fires[i].atS - fires[i - 1].atS).toBeGreaterThanOrEqual(CONFIG.minSeparationS - 1e-9);
    }
    // Every group gets its turn.
    for (const group of GROUPS) expect(fires.some((fire) => fire.groupId === group.id)).toBe(true);
  });

  it('picks members from the group, and varies them', () => {
    const { fires } = run(3600, () => input({ visibleGroupIds: ['sakura:pulse'] }));
    const members = new Set(fires.map((fire) => fire.memberId));
    for (const member of members) expect(GROUPS[0].memberIds).toContain(member);
    expect(members.size).toBeGreaterThan(1);
  });
});

describe('attack schedule — suppression and visibility', () => {
  it('never fires while the camera crosses, a focus panel is open, or the loader is up', () => {
    for (const flag of ['cameraCrossing', 'focusOpen', 'loaderUp'] as const) {
      const { fires, state } = run(600, () => input({ suppression: { ...QUIET, [flag]: true } }));
      expect(fires).toEqual([]);
      expect(state.clockS).toBe(0);
    }
  });

  it('freezes the clock while suppressed and holds a resume grace afterwards', () => {
    // Run until just before the first fire, suppress for a long time, resume.
    const first = run(600).fires[0];
    const lead = run(first.atS - 1);
    expect(lead.fires).toEqual([]);
    const held = run(300, () => input({ suppression: { ...QUIET, focusOpen: true } }), lead.state);
    expect(held.fires).toEqual([]);
    expect(held.state.clockS).toBeCloseTo(lead.state.clockS, 9);
    const resumed = run(60, () => input(), held.state);
    expect(resumed.fires.length).toBeGreaterThan(0);
    // The first fire after resume waits out the grace period (clock-relative).
    expect(resumed.fires[0].atS - held.state.clockS).toBeGreaterThanOrEqual(CONFIG.resumeGraceS - 1e-9);
  });

  it('off-screen groups do not age or fire', () => {
    const { fires, state } = run(900, () => input({ visibleGroupIds: ['sakura:roster'] }));
    expect(fires.every((fire) => fire.groupId === 'sakura:roster')).toBe(true);
    const hidden = state.groups.find((group) => group.id === 'sakura:pulse');
    expect(hidden?.elapsedS).toBe(0);
  });

  it('clamps delta: one huge resume delta cannot burst', () => {
    let state = createAttackSchedule(GROUPS, CONFIG);
    const step = stepAttackSchedule(state, input({ deltaS: 3600 }), CONFIG);
    state = step.state;
    expect(state.clockS).toBeCloseTo(CONFIG.maxDeltaS, 9);
    expect(step.fire).toBeNull();
  });

  it('schedules nothing at the `off` rung and pulses at `glow` / reduced motion', () => {
    expect(run(900, () => input({ level: 'off' })).fires).toEqual([]);
    expect(run(900, () => input({ level: 'glow' })).fires.every((fire) => fire.variant === 'glow-pulse')).toBe(true);
    const reduced = run(900, () => input({ reducedMotion: true })).fires;
    expect(reduced.length).toBeGreaterThan(0);
    expect(reduced.every((fire) => fire.variant === 'glow-pulse')).toBe(true);
    expect(run(900, () => input({ level: 'reduced' })).fires.every((fire) => fire.variant === 'vfx-reduced')).toBe(true);
  });
});

describe('attack moves — type-keyed VFX vocabulary', () => {
  it('every type has a descriptor with a real wind-up and bounded volume', () => {
    for (const type of ATTACK_TYPES) {
      const descriptor = attackForType(type);
      expect(descriptor.type).toBe(type);
      expect(ATTACK_VFX_KINDS).toContain(descriptor.kind);
      expect(descriptor.windUpS).toBeGreaterThanOrEqual(0.4);
      expect(descriptor.travelS).toBeGreaterThan(0);
      expect(descriptor.settleS).toBeGreaterThan(0);
      expect(descriptor.radiusM).toBeGreaterThan(0);
      expect(descriptor.radiusM).toBeLessThanOrEqual(1.5);
      expect(descriptor.colour).toMatch(/^#[0-9a-f]{6}$/);
      expect(attackDurationS(descriptor)).toBeLessThan(3);
    }
  });

  it('normalises manifest spelling and falls back to normal', () => {
    expect(normalizeAttackType('Water')).toBe('water');
    expect(normalizeAttackType(' FIRE ')).toBe('fire');
    expect(normalizeAttackType(undefined)).toBe('normal');
    expect(normalizeAttackType(null)).toBe('normal');
    expect(normalizeAttackType('Stellar')).toBe('normal');
    expect(attackForType('Water').kind).toBe('spout');
    expect(attackForType('Grass').kind).toBe('leaf');
    expect(attackForType('Flying').kind).toBe('gust');
  });

  it('the reduced-motion variant is a short in-place glow pulse in the type colour', () => {
    const pulse = glowPulseForType('Electric');
    expect(pulse.kind).toBe('glow-pulse');
    expect(pulse.colour).toBe(attackForType('electric').colour);
    expect(attackDurationS(pulse)).toBeLessThanOrEqual(1.5);
  });
});
