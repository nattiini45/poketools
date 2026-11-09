import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/format-engine', () => ({ getKitPhases: vi.fn(), getSeasonKitHead: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonParticipants: vi.fn() }));

import { getKitPhases, getSeasonKitHead } from '@/lib/supabase/queries/format-engine';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import {
  assertFormatPhaseDeletable,
  assertFormatPhaseRosterOpen,
  assertFormatPhaseStatusUnchanged,
  assertFormatPhaseUnchanged,
  assertSeasonPhasesFree,
  assertSeasonRosterMembers,
  isFormatManagedPhase,
} from '../phase-guards';
import { rosterOverrideOf } from '../roster-override';

const SEASON = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OWNED = '11111111-1111-4111-8111-111111111111';
const HAND_MADE = '33333333-3333-4333-8333-333333333333';

const stored = { id: OWNED, bracket_type: 'single_elim', best_of_default: 3, bo_overrides: { Final: 5, Semi: 3 }, is_doubles: false, stage_order: 2 };

async function code(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'other';
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getKitPhases).mockResolvedValue([{ id: OWNED, format_stage_key: 'playoffs', stage_order: 2, stage_spec: null }]);
  vi.mocked(getSeasonKitHead).mockResolvedValue({ engine: 'kit', seed: 's', revision: 1, clockShiftSeconds: 0 });
});

describe('assertSeasonPhasesFree', () => {
  it('refuses a new or reordered phase while a format is attached, and passes a league without one', async () => {
    expect(await code(assertSeasonPhasesFree(SEASON))).toBe('format_phase_owned');
    vi.mocked(getSeasonKitHead).mockResolvedValue(null);
    expect(await code(assertSeasonPhasesFree(SEASON))).toBeNull();
  });
});

describe('assertFormatPhaseDeletable', () => {
  it('refuses the phase of a format stage, passes a hand-made phase and a phase of no league', async () => {
    expect(await code(assertFormatPhaseDeletable(SEASON, OWNED))).toBe('format_phase_owned');
    expect(await code(assertFormatPhaseDeletable(SEASON, HAND_MADE))).toBeNull();
    expect(await code(assertFormatPhaseDeletable(null, OWNED))).toBeNull();
    expect(getKitPhases).toHaveBeenCalledTimes(2);
  });
});

describe('assertFormatPhaseUnchanged', () => {
  it('refuses a changed structural field of a format phase', async () => {
    for (const body of [{ bracket_type: 'double_elim' }, { best_of_default: 5 }, { bo_overrides: { Final: 7 } }, { is_doubles: true }, { stage_order: 1 }, { third_place_enabled: true }]) {
      expect(await code(assertFormatPhaseUnchanged(SEASON, stored, body)), JSON.stringify(body)).toBe('format_phase_owned');
    }
  });

  it('passes the stored values sent back (a form), other fields and a key-reordered override map', async () => {
    expect(await code(assertFormatPhaseUnchanged(SEASON, stored, { bracket_type: 'single_elim', best_of_default: 3, stage_order: 2 }))).toBeNull();
    expect(await code(assertFormatPhaseUnchanged(SEASON, stored, { bo_overrides: { Semi: 3, Final: 5 } }))).toBeNull();
    expect(await code(assertFormatPhaseUnchanged(SEASON, stored, {}))).toBeNull();
  });

  it('lets a changed field of a phase the format does not own, or of no league, through', async () => {
    expect(await code(assertFormatPhaseUnchanged(SEASON, { ...stored, id: HAND_MADE }, { bracket_type: 'double_elim' }))).toBeNull();
    expect(await code(assertFormatPhaseUnchanged(null, stored, { bracket_type: 'double_elim' }))).toBeNull();
  });
});

describe('assertFormatPhaseStatusUnchanged', () => {
  it('refuses a status change of a format phase only', async () => {
    expect(await code(assertFormatPhaseStatusUnchanged(SEASON, { id: OWNED, status: 'upcoming' }, 'active'))).toBe('format_phase_owned');
    expect(await code(assertFormatPhaseStatusUnchanged(SEASON, { id: OWNED, status: 'active' }, 'active'))).toBeNull();
    expect(await code(assertFormatPhaseStatusUnchanged(SEASON, { id: OWNED, status: 'active' }, undefined))).toBeNull();
    expect(await code(assertFormatPhaseStatusUnchanged(SEASON, { id: HAND_MADE, status: 'upcoming' }, 'active'))).toBeNull();
  });
});

describe('assertFormatPhaseRosterOpen', () => {
  it('refuses a roster change of a started format phase, never reading the phases of an upcoming one', async () => {
    expect(await code(assertFormatPhaseRosterOpen(SEASON, { id: OWNED, status: 'active' }))).toBe('format_phase_owned');
    expect(await code(assertFormatPhaseRosterOpen(SEASON, { id: OWNED, status: 'completed' }))).toBe('format_phase_owned');
    // A force does not open a completed phase.
    expect(await code(assertFormatPhaseRosterOpen(SEASON, { id: OWNED, status: 'completed' }, { force: true, reason: 'A valid reason' }))).toBe('format_phase_owned');
    vi.mocked(getKitPhases).mockClear();
    expect(await code(assertFormatPhaseRosterOpen(SEASON, { id: OWNED, status: 'upcoming' }))).toBeNull();
    expect(getKitPhases).not.toHaveBeenCalled();
    expect(await code(assertFormatPhaseRosterOpen(SEASON, { id: HAND_MADE, status: 'active' }))).toBeNull();
  });

  it('lets a started format phase through with force and a reason, and hands the trimmed reason back for the audit', async () => {
    const request = rosterOverrideOf({ force: true, reason: '  Added by mistake  ' });
    expect(await assertFormatPhaseRosterOpen(SEASON, { id: OWNED, status: 'active' }, request)).toEqual({ reason: 'Added by mistake' });
  });

  it('answers 400 PHASE_ROSTER_REASON_REQUIRED for force without a usable reason', async () => {
    for (const reason of [undefined, '', '   ', 'x'.repeat(501), 42, null]) {
      const request = rosterOverrideOf({ force: true, reason });
      expect(await code(assertFormatPhaseRosterOpen(SEASON, { id: OWNED, status: 'active' }, request)), String(reason)).toBe('PHASE_ROSTER_REASON_REQUIRED');
    }
  });

  it('still refuses 409 when force is anything but the boolean true, and forces nothing where nothing is locked', async () => {
    for (const force of ['true', 1, 'yes', null, undefined]) {
      expect(await code(assertFormatPhaseRosterOpen(SEASON, { id: OWNED, status: 'active' }, rosterOverrideOf({ force, reason: 'r' })))).toBe('format_phase_owned');
    }
    // An upcoming phase and a phase the format does not own need no override: nothing is overridden, so nothing is audited.
    expect(await assertFormatPhaseRosterOpen(SEASON, { id: OWNED, status: 'upcoming' }, rosterOverrideOf({ force: true, reason: 'r' }))).toBeNull();
    expect(await assertFormatPhaseRosterOpen(SEASON, { id: HAND_MADE, status: 'active' }, rosterOverrideOf({ force: true, reason: 'r' }))).toBeNull();
  });
});

describe('rosterOverrideOf', () => {
  it('reads force and reason from an object body only', () => {
    expect(rosterOverrideOf({ force: true, reason: 'r' })).toEqual({ force: true, reason: 'r' });
    expect(rosterOverrideOf({ reason: 'r' })).toEqual({ force: false, reason: 'r' });
    for (const body of [null, undefined, 'force', 7, [true]]) expect(rosterOverrideOf(body)).toEqual({ force: false });
  });
});

describe('isFormatManagedPhase', () => {
  it('is true for a phase the format created only', async () => {
    expect(await isFormatManagedPhase(SEASON, OWNED)).toBe(true);
    expect(await isFormatManagedPhase(SEASON, HAND_MADE)).toBe(false);
  });
});

describe('assertSeasonRosterMembers', () => {
  it('answers 400 PHASE_ROSTER_REQUIRED for a player outside the roster', async () => {
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }] as never);
    expect(await code(assertSeasonRosterMembers(SEASON, ['p1', 'p2']))).toBeNull();
    expect(await code(assertSeasonRosterMembers(SEASON, ['p1', 'p3']))).toBe('PHASE_ROSTER_REQUIRED');
  });
});
