import { describe, expect, it } from 'vitest';
import { getDefaultRounds } from '@/lib/draft/engine';
import { DRAFT_CONFIG_LIMITS } from '@/lib/draft/schemas';
import type { EngineGapCode } from '@/lib/format-studio/library-types';
import { getRoundRobinTotalRounds } from '@/lib/tournament/round-robin';
import { PLAN_ENGINE_SUPPORT } from '../../plans/engine-support';
import { ENGINE_GAP_ROWS, ENGINE_SUPPORT_ROWS } from '../engine-support';

/**
 * Each row of the `engine_support` table is checked against the constant or function it describes, so the statement the
 * model repeats to an admin cannot go stale silently (plan 3.6.1). When the engine learns a second round-robin circle
 * (Q22) the first test fails and the row flips with it.
 */

const row = (key: string) => {
  const found = ENGINE_SUPPORT_ROWS.find((entry) => entry.key === key);
  if (!found) throw new Error(`missing row ${key}`);
  return found;
};

describe('engine_support rows describe the code as it is', () => {
  it('double round robin: the engine plays one circle, N-1 rounds for N players (N for odd)', () => {
    expect(row('double_round_robin')).toMatchObject({ supported: false, limit: 1 });
    // The Plan's readiness check reads the same fact, so the two cannot disagree.
    expect(row('double_round_robin').limit).toBe(PLAN_ENGINE_SUPPORT.roundRobinLegs);
    expect(getRoundRobinTotalRounds(12)).toBe(11);
    expect(getRoundRobinTotalRounds(7)).toBe(7);
    // A second circle would double the rounds. It is not what the engine returns.
    expect(getRoundRobinTotalRounds(12)).not.toBe(22);
  });

  it('legacy draft roster: fixed at 11 for every draft type', () => {
    expect(row('legacy_draft_roster_size').limit).toBe(11);
    for (const type of ['snake', 'auction', 'budget'] as const) expect(getDefaultRounds(type)).toBe(11);
  });

  it('queue-engine roster size: configurable from 1 to 20, as the row says', () => {
    expect(DRAFT_CONFIG_LIMITS.roster_size).toEqual({ min: 1, max: 20 });
    expect(row('legacy_draft_roster_size').statement).toContain('1 to 20');
  });

  it('names every engine gap code an attach can report, so none is missing from the table text', () => {
    const codes: EngineGapCode[] = ['override_unmapped', 'rr_legs_not_run', 'third_place_not_run', 'edge_select_not_run', 'groups_not_created'];
    expect([...ENGINE_GAP_ROWS].sort()).toEqual([...codes].sort());
    const text = row('format_studio_groups_legs_third_place').statement;
    for (const gap of ['rr_legs_not_run', 'third_place_not_run', 'edge_select_not_run', 'groups_not_created']) expect(text).toContain(gap);
  });

  it('keys are unique and every statement is plain text the output schema accepts', () => {
    const keys = ENGINE_SUPPORT_ROWS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of ENGINE_SUPPORT_ROWS) {
      expect(entry.statement).toMatch(/^[\p{L}\p{N} .,;:'’()/+_-]{1,400}$/u);
      expect(entry.offer).toMatch(/^[\p{L}\p{N} .,;:'’()/+_-]{0,200}$/u);
    }
  });
});
