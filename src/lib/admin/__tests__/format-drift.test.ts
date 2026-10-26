import { describe, expect, it } from 'vitest';
import {
  buildFormatDriftReport,
  findAdvancementDrift,
  findTiebreakerDrift,
  normalizeAdvancementRule,
  type DriftPhaseRow,
  type FormatRulesOrderRow,
} from '../format-drift';
import type { TiebreakerStep } from '@/types/format-rules';
import type { AdvancementRule } from '@/types/season';

const PACK: TiebreakerStep[] = ['match_points', 'evolution_points', 'kill_difference', 'head_to_head', 'decision_match'];

function rulesRow(seasonId: string, order: TiebreakerStep[], extra: Partial<FormatRulesOrderRow> = {}): FormatRulesOrderRow {
  return { season_id: seasonId, season_name: `League ${seasonId}`, archived: false, is_test: false, tiebreaker_order: order, ...extra };
}

const top = (count: number, perGroup = false): AdvancementRule => ({ type: 'top_n', count, per_group: perGroup });

function phase(
  id: string,
  seasonId: string,
  stageOrder: number,
  rule: AdvancementRule | null,
  extra: Partial<DriftPhaseRow> = {},
): DriftPhaseRow {
  return {
    id,
    season_id: seasonId,
    season_name: `League ${seasonId}`,
    archived: false,
    is_test: false,
    name: `Phase ${stageOrder}`,
    stage_order: stageOrder,
    status: 'upcoming',
    advancement_rule: rule,
    ...extra,
  };
}

describe('findTiebreakerDrift', () => {
  it('reports no case for a stored order equal to the pack chain', () => {
    const result = findTiebreakerDrift([rulesRow('a', [...PACK])], PACK);
    expect(result).toEqual({ checked: 1, cases: [] });
  });

  it('reports the same steps in another order', () => {
    const stored: TiebreakerStep[] = [...PACK];
    [stored[2], stored[3]] = [stored[3], stored[2]];
    const result = findTiebreakerDrift([rulesRow('a', stored)], PACK);
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]).toMatchObject({ seasonId: 'a', stored, pack: PACK });
  });

  it('reports a missing step and an extra step', () => {
    const missing = PACK.filter((s) => s !== 'kill_difference');
    const extra: TiebreakerStep[] = [...PACK, 'kill_difference'];
    const result = findTiebreakerDrift([rulesRow('a', missing), rulesRow('b', extra)], PACK);
    expect(result.checked).toBe(2);
    expect(result.cases.map((c) => c.seasonId)).toEqual(['a', 'b']);
  });

  it('counts nothing for no rows', () => {
    expect(findTiebreakerDrift([], PACK)).toEqual({ checked: 0, cases: [] });
  });

  it('carries the league name and its archived and test flags', () => {
    const result = findTiebreakerDrift(
      [rulesRow('a', ['match_points'], { season_name: 'Spring', archived: true, is_test: true })],
      PACK,
    );
    expect(result.cases[0]).toMatchObject({ seasonName: 'Spring', archived: true, isTest: true });
  });

  it('marks a stored order the standings can use, and one they cannot', () => {
    const usable: TiebreakerStep[] = ['evolution_points', 'match_points'];
    const result = findTiebreakerDrift(
      [
        rulesRow('a', usable),
        rulesRow('b', []),
        rulesRow('c', ['match_points', 'match_points']),
        rulesRow('d', ['decision_match', 'match_points']),
        rulesRow('e', ['decision_match']),
      ],
      PACK,
    );
    expect(result.cases.map((c) => [c.seasonId, c.usable])).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
      ['d', false],
      ['e', false],
    ]);
  });

  it('does not alias the pack chain or the stored array in a case', () => {
    const stored: TiebreakerStep[] = ['match_points'];
    const [one] = findTiebreakerDrift([rulesRow('a', stored)], PACK).cases;
    expect(one.stored).not.toBe(stored);
    expect(one.pack).not.toBe(PACK);
  });
});

describe('findAdvancementDrift', () => {
  it('classifies a rule on the source phase only', () => {
    const result = findAdvancementDrift([phase('p1', 's', 1, top(4)), phase('p2', 's', 2, null)]);
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]).toMatchObject({ kind: 'source_only', seasonId: 's' });
    expect(result.cases[0].source).toMatchObject({ id: 'p1', stageOrder: 1, rule: top(4) });
    expect(result.cases[0].target).toMatchObject({ id: 'p2', rule: null });
  });

  it('classifies a rule on the target phase only', () => {
    const result = findAdvancementDrift([phase('p1', 's', 1, null), phase('p2', 's', 2, top(2, true))]);
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]).toMatchObject({ kind: 'target_only' });
    expect(result.cases[0].target?.rule).toEqual(top(2, true));
  });

  it('classifies two different rules (count, then per_group) as both_differ', () => {
    const count = findAdvancementDrift([phase('p1', 's', 1, top(4)), phase('p2', 's', 2, top(2))]);
    const group = findAdvancementDrift([phase('p1', 's', 1, top(2)), phase('p2', 's', 2, top(2, true))]);
    expect(count.cases.map((c) => c.kind)).toEqual(['both_differ']);
    expect(group.cases.map((c) => c.kind)).toEqual(['both_differ']);
  });

  it('counts an equal pair as consistent and does not list it', () => {
    const result = findAdvancementDrift([phase('p1', 's', 1, top(4)), phase('p2', 's', 2, top(4))]);
    expect(result).toMatchObject({ pairsChecked: 1, consistentPairs: 1, cases: [] });
  });

  it('does not check a pair where neither phase has a rule', () => {
    const result = findAdvancementDrift([phase('p1', 's', 1, null), phase('p2', 's', 2, null)]);
    expect(result).toMatchObject({ leaguesChecked: 1, pairsChecked: 0, consistentPairs: 0, cases: [] });
  });

  it('evaluates the pairs of a three-phase league independently', () => {
    const result = findAdvancementDrift([
      phase('p1', 's', 1, top(8)),
      phase('p2', 's', 2, top(8)),
      phase('p3', 's', 3, null),
    ]);
    // 1->2 is consistent, 2->3 carries the rule on the source only.
    expect(result.pairsChecked).toBe(2);
    expect(result.consistentPairs).toBe(1);
    expect(result.cases.map((c) => [c.kind, c.source?.id, c.target?.id])).toEqual([['source_only', 'p2', 'p3']]);
  });

  it('sorts unsorted input by stage_order, then id', () => {
    const result = findAdvancementDrift([
      phase('p3', 's', 3, null),
      phase('p1', 's', 1, top(4)),
      phase('p2', 's', 2, null),
    ]);
    expect(result.cases.map((c) => [c.source?.id, c.target?.id])).toEqual([['p1', 'p2']]);

    const tie = findAdvancementDrift([phase('b', 's', 1, null), phase('a', 's', 1, top(2))]);
    expect(tie.cases.map((c) => [c.source?.id, c.target?.id])).toEqual([['a', 'b']]);
  });

  it('produces nothing for a league without rules', () => {
    const result = findAdvancementDrift([phase('p1', 's', 1, null), phase('p2', 's', 2, null), phase('p3', 's', 3, null)]);
    expect(result.cases).toEqual([]);
  });

  it('reports a rule on the only phase of a league as an orphan', () => {
    const result = findAdvancementDrift([phase('p1', 's', 1, top(4))]);
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]).toMatchObject({ kind: 'orphan', target: null });
    expect(result.cases[0].source).toMatchObject({ id: 'p1', rule: top(4) });
    expect(result.pairsChecked).toBe(0);
  });

  it('does not report a single phase without a rule', () => {
    const result = findAdvancementDrift([phase('p1', 's', 1, null)]);
    expect(result).toMatchObject({ leaguesChecked: 1, cases: [] });
  });

  it('never pairs phases of different leagues', () => {
    const result = findAdvancementDrift([phase('p1', 'a', 1, top(4)), phase('p2', 'b', 2, null)]);
    expect(result.leaguesChecked).toBe(2);
    expect(result.pairsChecked).toBe(0);
    // Each league has a single phase: the first carries a rule nothing reads, the second has none.
    expect(result.cases.map((c) => [c.kind, c.seasonId])).toEqual([['orphan', 'a']]);
  });

  it('carries the league name and the archived and test flags', () => {
    const result = findAdvancementDrift([
      phase('p1', 's', 1, top(4), { season_name: 'Autumn', archived: true, is_test: true, status: 'completed' }),
      phase('p2', 's', 2, null, { season_name: 'Autumn', archived: true, is_test: true }),
    ]);
    expect(result.cases[0]).toMatchObject({ seasonName: 'Autumn', archived: true, isTest: true });
    expect(result.cases[0].source?.status).toBe('completed');
  });

  it('lists the cases by league name', () => {
    const result = findAdvancementDrift([
      phase('z1', 'z', 1, top(2), { season_name: 'Zeta' }),
      phase('z2', 'z', 2, null, { season_name: 'Zeta' }),
      phase('a1', 'a', 1, top(2), { season_name: 'Alpha' }),
      phase('a2', 'a', 2, null, { season_name: 'Alpha' }),
    ]);
    expect(result.cases.map((c) => c.seasonName)).toEqual(['Alpha', 'Zeta']);
  });
});

describe('normalizeAdvancementRule', () => {
  it('keeps a valid top_n rule and coerces per_group to a boolean', () => {
    expect(normalizeAdvancementRule({ type: 'top_n', count: 4, per_group: true })).toEqual(top(4, true));
    expect(normalizeAdvancementRule({ type: 'top_n', count: 4 })).toEqual(top(4, false));
  });

  it('treats anything else as no rule', () => {
    for (const value of [null, undefined, 'x', 3, [], {}, { type: 'top_n' }, { type: 'bottom_n', count: 2 }, { type: 'top_n', count: '2' }]) {
      expect(normalizeAdvancementRule(value)).toBeNull();
    }
  });
});

describe('buildFormatDriftReport', () => {
  it('assembles both sections with the passed timestamp, pack chain and truncation flags', () => {
    const report = buildFormatDriftReport({
      formatRules: [rulesRow('a', ['match_points'])],
      phases: [phase('p1', 's', 1, top(2)), phase('p2', 's', 2, null)],
      packChain: PACK,
      generatedAt: '2026-10-24T10:00:00.000Z',
      truncated: { formatRules: false, phases: true },
    });
    expect(report.generatedAt).toBe('2026-10-24T10:00:00.000Z');
    expect(report.packChain).toEqual(PACK);
    expect(report.tiebreaker.checked).toBe(1);
    expect(report.tiebreaker.cases).toHaveLength(1);
    expect(report.advancement.cases).toHaveLength(1);
    expect(report.truncated).toEqual({ formatRules: false, phases: true });
  });
});
