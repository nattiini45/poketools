/**
 * Signature-attack schedule (fidelity W5 prep — pure, not mounted yet).
 *
 * Decides WHEN a visible figure group fires an attack and WHICH member does,
 * as a pure state step over accumulated, clamped frame delta:
 *
 * - low frequency: each group draws its next interval from a seeded
 *   U(45, 90) s, so the cadence is never a metronome;
 * - staggered: any two fires across ALL groups are at least `minSeparationS`
 *   apart plus a seeded per-group jitter, and at most one fire happens per
 *   step — two groups never go off in sync;
 * - suppressed while the camera is crossing between stations, a focus panel
 *   is open, or the loader is up: the schedule clock FREEZES (no pile-up that
 *   bursts on resume) and, once suppression lifts, a short resume grace keeps
 *   an attack from landing on the very frame the visitor arrives — the
 *   information surface gets the first beat, the spectacle the second;
 * - off-screen groups do not age: a group only counts time while it is in
 *   the visible set, so nothing fires unseen or queues up for the arrival;
 * - delta-time driven: the step clamps `deltaS`, so a parked
 *   `frameloop="demand"` canvas resuming with one huge delta cannot fire a
 *   burst.
 *
 * Presentation follows the ladder's `attackVfx` level (quality.ts is the only
 * quality authority): `off` schedules nothing, `glow` — or a reduced-motion
 * visitor on a forced route tier (D12) — gets the glow-pulse variant.
 */

import { hashString, seededRandom } from './ambient';
import type { AttackVfxLevel } from './quality';

export interface AttackGroupInput {
  /** Stable group id (a station's figure cluster, e.g. `sakura:schedule`). */
  id: string;
  /** Member figure ids, in a stable order. A group with none never fires. */
  memberIds: readonly string[];
}

export interface AttackScheduleConfig {
  seed: number;
  /** Lower bound of the per-group interval, seconds. */
  minIntervalS: number;
  /** Upper bound of the per-group interval, seconds. */
  maxIntervalS: number;
  /** Minimum gap between ANY two fires, seconds. */
  minSeparationS: number;
  /** Extra seeded gap on top of the separation, up to this many seconds. */
  separationJitterS: number;
  /** Quiet time after suppression lifts before anything may fire, seconds. */
  resumeGraceS: number;
  /** Per-step delta clamp, seconds. */
  maxDeltaS: number;
}

export const DEFAULT_ATTACK_SCHEDULE: Omit<AttackScheduleConfig, 'seed'> = {
  minIntervalS: 45,
  maxIntervalS: 90,
  minSeparationS: 8,
  separationJitterS: 4,
  resumeGraceS: 3,
  maxDeltaS: 0.25,
};

/** Why the world must stay quiet right now (all inputs, no detection here). */
export interface AttackSuppression {
  cameraCrossing: boolean;
  focusOpen: boolean;
  loaderUp: boolean;
}

export interface AttackStepInput {
  /** Frame delta, seconds (clamped by the step). */
  deltaS: number;
  /** Groups currently in frame. */
  visibleGroupIds: readonly string[];
  suppression: AttackSuppression;
  /** The rung's `attackVfx` level. */
  level: AttackVfxLevel;
  /** `prefers-reduced-motion` (only reachable with a forced route tier). */
  reducedMotion: boolean;
}

export type AttackVariant = 'vfx-full' | 'vfx-reduced' | 'glow-pulse';

export interface AttackFire {
  groupId: string;
  memberId: string;
  /** 0-based count of this group's fires. */
  fireIndex: number;
  /** Schedule-clock time of the fire, seconds. */
  atS: number;
  variant: AttackVariant;
}

interface GroupState {
  id: string;
  memberIds: readonly string[];
  fired: number;
  /** Visible, unsuppressed seconds since the last fire (or the start). */
  elapsedS: number;
  /** Seconds this group waits before its next fire. */
  intervalS: number;
}

export interface AttackScheduleState {
  /** Unsuppressed schedule time, seconds. */
  clockS: number;
  /** Clock time of the last fire across all groups, or null. */
  lastFireAtS: number | null;
  /** Unsuppressed seconds since suppression last lifted. */
  sinceResumeS: number;
  groups: readonly GroupState[];
}

function groupRandom(seed: number, id: string, fired: number, salt: number): number {
  return seededRandom((seed ^ hashString(id) ^ Math.imul(fired + 1, 0x9e3779b1) ^ salt) >>> 0)();
}

/** The seeded interval before a group's `fired`-th attack. */
export function attackIntervalS(config: AttackScheduleConfig, id: string, fired: number): number {
  const u = groupRandom(config.seed, id, fired, 0x51ed);
  const span = config.maxIntervalS - config.minIntervalS;
  const interval = config.minIntervalS + u * span;
  // The first attack of a group arrives earlier and at a staggered point, so
  // a visitor who lingers sees one inside a single interval, and groups that
  // come into view together do not share a phase.
  if (fired === 0) return interval * (0.35 + 0.65 * groupRandom(config.seed, id, 0, 0xf1a7));
  return interval;
}

function separationFor(config: AttackScheduleConfig, group: GroupState): number {
  return config.minSeparationS + config.separationJitterS * groupRandom(config.seed, group.id, group.fired, 0x5e9a);
}

export function createAttackSchedule(
  groups: readonly AttackGroupInput[],
  config: AttackScheduleConfig,
): AttackScheduleState {
  return {
    clockS: 0,
    lastFireAtS: null,
    sinceResumeS: config.resumeGraceS,
    groups: groups.map((group) => ({
      id: group.id,
      memberIds: [...group.memberIds],
      fired: 0,
      elapsedS: 0,
      intervalS: attackIntervalS(config, group.id, 0),
    })),
  };
}

function isSuppressed(suppression: AttackSuppression): boolean {
  return suppression.cameraCrossing || suppression.focusOpen || suppression.loaderUp;
}

function variantFor(level: AttackVfxLevel, reducedMotion: boolean): AttackVariant {
  if (reducedMotion || level === 'glow') return 'glow-pulse';
  return level === 'reduced' ? 'vfx-reduced' : 'vfx-full';
}

/**
 * Advance the schedule by one frame. Pure: returns the next state and at most
 * one fire. A suppressed step or an `off` level returns a frozen state.
 */
export function stepAttackSchedule(
  state: AttackScheduleState,
  input: AttackStepInput,
  config: AttackScheduleConfig,
): { state: AttackScheduleState; fire: AttackFire | null } {
  if (input.level === 'off') return { state, fire: null };
  if (isSuppressed(input.suppression)) {
    // Frozen clock; the resume grace restarts when suppression lifts.
    return state.sinceResumeS === 0 ? { state, fire: null } : { state: { ...state, sinceResumeS: 0 }, fire: null };
  }
  const dt = Math.min(Math.max(Number.isFinite(input.deltaS) ? input.deltaS : 0, 0), config.maxDeltaS);
  const clockS = state.clockS + dt;
  const sinceResumeS = state.sinceResumeS + dt;
  const visible = new Set(input.visibleGroupIds);
  const groups = state.groups.map((group) =>
    visible.has(group.id) ? { ...group, elapsedS: group.elapsedS + dt } : group,
  );

  let fire: AttackFire | null = null;
  if (sinceResumeS >= config.resumeGraceS) {
    // The most overdue visible group that has cleared the separation fires.
    let pick = -1;
    let bestOverdue = -Infinity;
    groups.forEach((group, index) => {
      if (!visible.has(group.id) || group.memberIds.length === 0) return;
      const overdue = group.elapsedS - group.intervalS;
      if (overdue < 0) return;
      if (state.lastFireAtS !== null && clockS - state.lastFireAtS < separationFor(config, group)) return;
      if (overdue > bestOverdue) {
        bestOverdue = overdue;
        pick = index;
      }
    });
    if (pick >= 0) {
      const group = groups[pick];
      const memberIndex = Math.floor(groupRandom(config.seed, group.id, group.fired, 0x3e3b) * group.memberIds.length);
      fire = {
        groupId: group.id,
        memberId: group.memberIds[Math.min(memberIndex, group.memberIds.length - 1)],
        fireIndex: group.fired,
        atS: clockS,
        variant: variantFor(input.level, input.reducedMotion),
      };
      groups[pick] = {
        ...group,
        fired: group.fired + 1,
        elapsedS: 0,
        intervalS: attackIntervalS(config, group.id, group.fired + 1),
      };
    }
  }

  return {
    state: { clockS, lastFireAtS: fire ? clockS : state.lastFireAtS, sinceResumeS, groups },
    fire,
  };
}
