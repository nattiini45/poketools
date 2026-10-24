import { describe, expect, it } from 'vitest';
import { phaseGroupsCreateSchema } from '@/lib/validation/schemas';
import {
  PHASE_GROUP_COUNT_MAX,
  PHASE_GROUP_COUNT_MIN,
  PHASE_GROUP_COUNTS,
  phaseAnchorOptions,
  phaseNumbers,
  redrawNeedsConfirm,
  resolveInsertAt,
  type PhasePositionPhase,
} from '../phase-controls';

describe('PHASE_GROUP_COUNTS', () => {
  it('runs from 2 to 26 and matches the API schema, so the UI cannot drift', () => {
    expect(PHASE_GROUP_COUNTS[0]).toBe(2);
    expect(PHASE_GROUP_COUNTS[PHASE_GROUP_COUNTS.length - 1]).toBe(26);
    expect(PHASE_GROUP_COUNTS).toHaveLength(25);
    for (const n of [PHASE_GROUP_COUNT_MIN, PHASE_GROUP_COUNT_MAX]) {
      expect(phaseGroupsCreateSchema.safeParse({ group_count: n }).success).toBe(true);
    }
    expect(phaseGroupsCreateSchema.safeParse({ group_count: PHASE_GROUP_COUNT_MIN - 1 }).success).toBe(false);
    expect(phaseGroupsCreateSchema.safeParse({ group_count: PHASE_GROUP_COUNT_MAX + 1 }).success).toBe(false);
  });
});

describe('redrawNeedsConfirm', () => {
  it('asks only when there are groups to replace', () => {
    expect(redrawNeedsConfirm(0)).toBe(false);
    expect(redrawNeedsConfirm(1)).toBe(true);
    expect(redrawNeedsConfirm(8)).toBe(true);
  });
});

function phase(id: string, stage_order: number, status: PhasePositionPhase['status'] = 'upcoming'): PhasePositionPhase {
  return { id, name: `Phase ${id}`, stage_order, status };
}

const THREE = [phase('a', 1), phase('b', 2), phase('c', 3)];

describe('resolveInsertAt', () => {
  it('appends for the end of the league, and without a usable anchor', () => {
    expect(resolveInsertAt('end', 'b', THREE)).toBeUndefined();
    expect(resolveInsertAt('before', null, THREE)).toBeUndefined();
    expect(resolveInsertAt('before', 'missing', THREE)).toBeUndefined();
  });

  it('takes the anchor position for "before"', () => {
    expect(resolveInsertAt('before', 'a', THREE)).toBe(1);
    expect(resolveInsertAt('before', 'b', THREE)).toBe(2);
  });

  it('takes the next position for "after", and appends after the last phase', () => {
    expect(resolveInsertAt('after', 'a', THREE)).toBe(2);
    expect(resolveInsertAt('after', 'b', THREE)).toBe(3);
    expect(resolveInsertAt('after', 'c', THREE)).toBeUndefined();
  });

  it('follows stage orders with a gap', () => {
    const gap = [phase('a', 1), phase('c', 3)];
    expect(resolveInsertAt('after', 'a', gap)).toBe(2);
    expect(resolveInsertAt('before', 'c', gap)).toBe(3);
  });

  it('refuses a position in front of a started phase', () => {
    const started = [phase('a', 1, 'completed'), phase('b', 2, 'active'), phase('c', 3)];
    expect(resolveInsertAt('before', 'a', started)).toBeUndefined();
    expect(resolveInsertAt('before', 'b', started)).toBeUndefined();
    expect(resolveInsertAt('before', 'c', started)).toBe(3);
    expect(resolveInsertAt('after', 'b', started)).toBe(3);
  });
});

describe('phaseAnchorOptions', () => {
  it('lists the phases in stage order, whatever order they come in', () => {
    const ids = phaseAnchorOptions('before', [phase('c', 3), phase('a', 1), phase('b', 2)]).map((o) => o.phaseId);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('disables every position in front of a started phase and keeps the rest', () => {
    const started = [phase('a', 1, 'completed'), phase('b', 2, 'active'), phase('c', 3)];
    expect(phaseAnchorOptions('before', started).map((o) => o.disabled)).toEqual([true, true, false]);
    expect(phaseAnchorOptions('after', started).map((o) => [o.insertAt, o.disabled])).toEqual([
      [2, true],
      [3, false],
      [undefined, false],
    ]);
  });

  it('offers every position while no phase started', () => {
    expect(phaseAnchorOptions('before', THREE).every((o) => !o.disabled)).toBe(true);
  });
});

describe('phaseNumbers', () => {
  it('counts phases from 1 in stage order, even when the stored order starts at 0', () => {
    const numbers = phaseNumbers([
      { id: 'playoffs', stage_order: 1 },
      { id: 'groups', stage_order: 0 },
    ]);
    expect(numbers.get('groups')).toBe(1);
    expect(numbers.get('playoffs')).toBe(2);
  });

  it('does not show gaps left by a deleted phase', () => {
    const numbers = phaseNumbers([
      { id: 'a', stage_order: 1 },
      { id: 'c', stage_order: 3 },
      { id: 'd', stage_order: 4 },
    ]);
    expect([numbers.get('a'), numbers.get('c'), numbers.get('d')]).toEqual([1, 2, 3]);
  });
});
