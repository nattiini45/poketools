import { describe, expect, it } from 'vitest';
import { compile } from '@/lib/format-kit';
import { compile as compileBrowser } from '@/lib/format-kit/compile.browser';
import { deepFreeze } from '@/lib/studio-core/json';
import type { FormatDefinition, Stage } from '@/lib/format-kit/types';
import { getFormatCapabilities } from '@/lib/season/format-capabilities';
import { describeLegacy } from '../legacy/describe-legacy';
import type { LegacyInput, LegacyStageInput } from '../legacy/types';
import { legacyCompileEnv } from '../view';
import { FIXTURE_LEAGUES, FIXTURE_PACK, makeInput, makeSeason, makeStage } from './fixtures/leagues';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A descriptor of a league with the given phases (and season overrides). */
function describeStages(stages: Parameters<typeof makeStage>[0][], season: Parameters<typeof makeSeason>[0] = {}, over: Partial<LegacyInput> = {}) {
  return describeLegacy(
    makeInput({
      season: makeSeason(season),
      stages: stages.map((stage, index) => makeStage({ id: uuid(100 + index), stageOrder: index + 1, name: `Phase ${index + 1}`, ...stage })),
      ...over,
    }),
  );
}

const stageOf = (def: FormatDefinition, index: number): Stage => def.stages[index];
const textOf = (value: { en?: { v: string }; de?: { v: string } } | undefined, locale: 'en' | 'de'): string | undefined => value?.[locale]?.v;

describe('fixtures', () => {
  describe.each(Object.keys(FIXTURE_LEAGUES))('%s', (name) => {
    const input = FIXTURE_LEAGUES[name];
    const env = legacyCompileEnv(input.season.participantCount);

    it('compiles without errors on the server entry', () => {
      const result = compile(describeLegacy(input), env);
      expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(result.ok).toBe(true);
    });

    it('gives the same hash and diagnostics on the browser entry', () => {
      const def = describeLegacy(input);
      const server = compile(def, env);
      const browser = compileBrowser(def, env);
      expect(browser.hash).toBe(server.hash);
      expect(browser.diagnostics).toEqual(server.diagnostics);
    });

    it('is plain JSON, equal on every call and never mutates a frozen input', () => {
      const frozen = deepFreeze(structuredClone(input));
      const first = describeLegacy(frozen);
      expect(first).toStrictEqual(JSON.parse(JSON.stringify(first)));
      expect(describeLegacy(frozen)).toStrictEqual(first);
      expect(frozen).toStrictEqual(input);
    });
  });

  it('takes no locale argument', () => {
    expect(describeLegacy.length).toBe(1);
  });
});

describe('bracket types', () => {
  it.each([
    ['round_robin', { kind: 'round_robin', legs: 1, mirror_legs: true }],
    ['swiss', { kind: 'swiss', rounds: 'auto', avoid_repeats: true }],
    ['single_elim', { kind: 'single_elim', third_place: false }],
    ['double_elim', { kind: 'double_elim', bracket_reset: true }],
  ] as const)('%s maps to its pairing with a series of the stored length', (bracketType, pairing) => {
    const def = describeStages([{ bracketType, bestOfDefault: 3 }]);
    expect(stageOf(def, 0).pairing).toEqual(pairing);
    expect(stageOf(def, 0).series).toEqual({ best_of: 3, allow_draw: false, overrides: [] });
    expect(stageOf(def, 0).players_per_match).toBe(2);
    expect(stageOf(def, 0).columns).toEqual([]);
  });

  it('reads the bracket reset flag: on unless the phase turned it off', () => {
    const reset = (flag: boolean | undefined) =>
      stageOf(describeStages([{ bracketType: 'double_elim', bracketResetEnabled: flag }]), 0).pairing;
    expect(reset(undefined)).toEqual({ kind: 'double_elim', bracket_reset: true });
    expect(reset(true)).toEqual({ kind: 'double_elim', bracket_reset: true });
    expect(reset(false)).toEqual({ kind: 'double_elim', bracket_reset: false });
  });

  it('keeps an even best-of and clamps the range instead of coercing it', () => {
    expect(stageOf(describeStages([{ bestOfDefault: 2 }]), 0).series.best_of).toBe(2);
    expect(stageOf(describeStages([{ bestOfDefault: 99 }]), 0).series.best_of).toBe(15);
    expect(stageOf(describeStages([{ bestOfDefault: 0 }]), 0).series.best_of).toBe(1);
    expect(stageOf(describeStages([{ bestOfDefault: Number.NaN }]), 0).series.best_of).toBe(1);
  });
});

describe('groups', () => {
  const groups = (stage: Parameters<typeof makeStage>[0], leagueGroupCount = 0) =>
    stageOf(describeStages([stage], { leagueGroupCount }), 0).groups;

  it('uses the groups of the phase', () => {
    expect(groups({ groupCount: 3 })).toEqual({ count: 3, method: 'serpentine' });
  });

  it('inherits the league groups for a round robin phase only', () => {
    expect(groups({ bracketType: 'round_robin' }, 2)).toEqual({ count: 2, method: 'manual' });
    expect(groups({ bracketType: 'swiss' }, 2)).toBeUndefined();
    expect(groups({ bracketType: 'single_elim' }, 2)).toBeUndefined();
    expect(groups({ bracketType: 'double_elim' }, 2)).toBeUndefined();
  });

  it('places by hand whenever the league has groups of its own', () => {
    expect(groups({ groupCount: 4 }, 3)).toEqual({ count: 4, method: 'manual' });
  });

  it('caps at 26 groups', () => {
    expect(groups({ groupCount: 40 })?.count).toBe(26);
    expect(groups({}, 30)?.count).toBe(26);
  });

  it('ignores a single group and omits the field', () => {
    expect(groups({ groupCount: 1 })).toBeUndefined();
    expect(groups({}, 1)).toBeUndefined();
    expect('groups' in stageOf(describeStages([{ groupCount: 1 }]), 0)).toBe(false);
  });
});

describe('participants and edges', () => {
  const RULE = { type: 'top_n', count: 4, per_group: false } as const;

  it('starts the first phase from the roster, seeded by hand', () => {
    const def = describeStages([{}]);
    expect(stageOf(def, 0).participants).toEqual({ from: 'roster', seeding: 'manual' });
    expect(def.edges).toEqual([]);
  });

  it('(a) follows the phase an enrollment by standings names', () => {
    const def = describeStages([
      { advancementRule: RULE },
      { enrollmentSource: { type: 'roster', source_phase_id: null } },
      { enrollmentSource: { type: 'standings', source_phase_id: uuid(100) } },
    ]);
    expect(def.edges).toEqual([
      { key: 'advance_1_3', from: 'stage_1', to: 'stage_3', select: [{ kind: 'top_n', n: 4 }], seeding: 'rank', gate: 'admin_confirm' },
    ]);
    expect(stageOf(def, 1).participants).toEqual({ from: 'roster', seeding: 'manual' });
    expect(stageOf(def, 2).participants).toEqual({ from: 'edges', seeding: 'edge_order' });
  });

  it('(a) falls back to a hand-picked list when the source phase has no rule', () => {
    const def = describeStages([{}, { enrollmentSource: { type: 'standings', source_phase_id: uuid(100) } }]);
    expect(def.edges).toHaveLength(1);
    expect(def.edges[0].select).toEqual([{ kind: 'manual_list' }]);
  });

  it('(b) reads the rule of the previous phase when nothing else names a source', () => {
    for (const enrollmentSource of [null, { type: 'standings', source_phase_id: null }, { type: 'standings', source_phase_id: 'gone' }] as const) {
      const def = describeStages([{ advancementRule: RULE }, { enrollmentSource }]);
      expect(def.edges).toEqual([
        { key: 'advance_1_2', from: 'stage_1', to: 'stage_2', select: [{ kind: 'top_n', n: 4 }], seeding: 'rank', gate: 'admin_confirm' },
      ]);
    }
  });

  it('(b) ignores a source phase that is not earlier', () => {
    const def = describeStages([
      { advancementRule: RULE, enrollmentSource: { type: 'standings', source_phase_id: uuid(101) } },
      { advancementRule: RULE, enrollmentSource: { type: 'standings', source_phase_id: uuid(101) } },
    ]);
    // Phase 2 names itself, which is not earlier, so it falls back to the previous phase.
    expect(def.edges.map((e) => e.key)).toEqual(['advance_1_2']);
  });

  it('(c) keeps a roster enrollment on the roster and turns the unused rule into a text section', () => {
    const def = describeStages([{ advancementRule: RULE }, { enrollmentSource: { type: 'roster', source_phase_id: null } }]);
    expect(def.edges).toEqual([]);
    expect(stageOf(def, 1).participants).toEqual({ from: 'roster', seeding: 'manual' });
    expect(def.text.sections.map((s) => s.id)).toEqual(['adv_unused_1']);
    expect(textOf(def.text.sections[0].body, 'en')).toContain('the best 4 players overall');
    expect(textOf(def.text.sections[0].body, 'de')).toContain('die besten 4 insgesamt');
    expect(def.text.sections[0].stage).toBe('stage_1');
  });

  it('keeps the rule of the last phase as a text section', () => {
    const def = describeStages([{ advancementRule: { type: 'top_n', count: 1, per_group: true } }]);
    expect(def.edges).toEqual([]);
    expect(textOf(def.text.sections[0].body, 'en')).toContain('the best player of each group');
  });

  it('reads a per-group rule as per_group and clamps the numbers', () => {
    const edge = (count: number, per_group: boolean) =>
      describeStages([{ advancementRule: { type: 'top_n', count, per_group } }, {}]).edges[0]?.select[0];
    expect(edge(2, true)).toEqual({ kind: 'per_group', n: 2 });
    expect(edge(100, true)).toEqual({ kind: 'per_group', n: 64 });
    expect(edge(5000, false)).toEqual({ kind: 'top_n', n: 1024 });
    expect(edge(2.7, false)).toEqual({ kind: 'top_n', n: 2 });
  });

  it('ignores a rule that advances nobody', () => {
    for (const count of [0, -3, Number.NaN]) {
      const def = describeStages([{ advancementRule: { type: 'top_n', count, per_group: false } }, {}]);
      expect(def.edges).toEqual([]);
      expect(def.text.sections).toEqual([]);
    }
  });

  it('numbers keys from the phase order, not the input order', () => {
    const def = describeStages([
      { name: 'Third', stageOrder: 3 },
      { name: 'First', stageOrder: 1, advancementRule: RULE },
      { name: 'Second', stageOrder: 2 },
    ]);
    expect(def.stages.map((s) => [s.key, textOf(s.name, 'en')])).toEqual([
      ['stage_1', 'First'],
      ['stage_2', 'Second'],
      ['stage_3', 'Third'],
    ]);
    expect(def.edges.map((e) => e.key)).toEqual(['advance_1_2']);
  });
});

describe('series overrides', () => {
  const overrides = (bracketType: LegacyStageInput['bracketType'], boOverrides: Record<string, number>) =>
    describeStages([{ bracketType, boOverrides }]);

  it('maps the names that mean exactly one round of a single elimination', () => {
    const def = overrides('single_elim', { Finals: 5, Semifinals: 3, Quarterfinals: 3, 'Round 4': 1 });
    expect(stageOf(def, 0).series.overrides).toEqual([
      { round: 1, from: 'end', best_of: 5 },
      { round: 2, from: 'end', best_of: 3 },
      { round: 3, from: 'end', best_of: 3 },
      { round: 4, from: 'start', best_of: 1 },
    ]);
    expect(def.text.sections).toEqual([]);
  });

  it('maps "Round N" for round robin and Swiss, and nothing else', () => {
    for (const bracketType of ['round_robin', 'swiss'] as const) {
      const def = overrides(bracketType, { 'Round 2': 3, Finals: 5 });
      expect(stageOf(def, 0).series.overrides).toEqual([{ round: 2, from: 'start', best_of: 3 }]);
      expect(def.text.sections.map((s) => s.id)).toEqual(['bo_stage_1']);
    }
  });

  it('keeps every double-elimination name as text', () => {
    const def = overrides('double_elim', { 'Grand Finals': 5, 'Winners Round 2': 3, 'Round 1': 3 });
    expect(stageOf(def, 0).series.overrides).toEqual([]);
    const body = textOf(def.text.sections[0].body, 'en') ?? '';
    expect(body.split('\n')).toEqual([
      'Grand Finals is played as best of 5.',
      'Round 1 is played as best of 3.',
      'Winners Round 2 is played as best of 3.',
    ]);
    expect(textOf(def.text.sections[0].body, 'de')).toContain('Grand Finals wird im Best-of-5-Modus gespielt.');
    expect(def.text.sections[0].stage).toBe('stage_1');
  });

  it('keeps unknown names and out-of-range rounds as text', () => {
    const def = overrides('single_elim', { 'Third Place': 3, 'Round 65': 3, 'Round 0': 3, 'Round 01': 3, 'Round 64': 3 });
    expect(stageOf(def, 0).series.overrides).toEqual([{ round: 64, from: 'start', best_of: 3 }]);
    const lines = (textOf(def.text.sections[0].body, 'en') ?? '').split('\n');
    expect(lines).toHaveLength(4);
  });

  it('clamps the length, drops values that mean nothing and caps at 32 overrides', () => {
    expect(stageOf(overrides('swiss', { 'Round 1': 20 }), 0).series.overrides).toEqual([{ round: 1, from: 'start', best_of: 15 }]);
    expect(stageOf(overrides('swiss', { 'Round 1': 0, 'Round 2': Number.NaN }), 0).series.overrides).toEqual([]);
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`Round ${i + 1}`, 3]));
    const def = overrides('round_robin', many);
    expect(stageOf(def, 0).series.overrides).toHaveLength(32);
    expect((textOf(def.text.sections[0].body, 'en') ?? '').split('\n')).toHaveLength(8);
  });
});

describe('doubles and rulesets', () => {
  it('is doubles when the phase says so or the league is a doubles league', () => {
    const doubles = (isDoubles: boolean, formatType: 'singles' | 'doubles') =>
      stageOf(describeStages([{ isDoubles }], { formatType }), 0).doubles;
    expect(doubles(false, 'singles')).toBe(false);
    expect(doubles(true, 'singles')).toBe(true);
    expect(doubles(false, 'doubles')).toBe(true);
    expect(doubles(true, 'doubles')).toBe(true);
  });

  it('references a ruleset only when the phase uses a different valid uuid', () => {
    const ruleset = (rulesetId: string | null, seasonRuleset: string | null) =>
      stageOf(describeStages([{ rulesetId }], { rulesetId: seasonRuleset }), 0).ruleset;
    expect(ruleset(uuid(900), uuid(900))).toEqual({ kind: 'season_default' });
    expect(ruleset(uuid(900).toUpperCase(), uuid(900))).toEqual({ kind: 'season_default' });
    expect(ruleset(uuid(901), uuid(900))).toEqual({ kind: 'ruleset', id: uuid(901) });
    expect(ruleset(uuid(901), null)).toEqual({ kind: 'ruleset', id: uuid(901) });
    expect(ruleset(null, uuid(900))).toEqual({ kind: 'season_default' });
    expect(ruleset('not-a-uuid', uuid(900))).toEqual({ kind: 'season_default' });
  });
});

describe('scoring and rank', () => {
  const NON_EPB_RANK = [
    { kind: 'metric', metric: 'points', direction: 'desc' },
    { kind: 'metric', metric: 'kill_differential', direction: 'desc' },
    { kind: 'metric', metric: 'buchholz', direction: 'desc' },
    { kind: 'metric', metric: 'wins', direction: 'desc' },
  ];

  it.each([
    ['round_robin', { win: 3, loss: 0, bye: 0 }, NON_EPB_RANK],
    ['swiss', { win: 1, loss: 0, bye: 1 }, NON_EPB_RANK],
    ['single_elim', { win: 1, loss: 0, bye: 0 }, []],
    ['double_elim', { win: 1, loss: 0, bye: 0 }, []],
  ] as const)('%s outside Evolution Point Buy', (bracketType, scoring, rank) => {
    const stage = stageOf(describeStages([{ bracketType }]), 0);
    expect(stage.scoring).toStrictEqual(scoring);
    expect(stage.rank).toStrictEqual(rank);
  });

  it('scores an Evolution Point Buy table with the pack and ranks by the pack chain when no order is stored', () => {
    const def = describeStages([{ bracketType: 'round_robin' }, { bracketType: 'swiss' }], { formatType: 'evolution_point_buy' });
    for (const stage of def.stages) {
      expect(stage.scoring).toStrictEqual({ win: 3, loss: 0, bye: 0 });
      // Evolution points have no kit metric: the step is left out, the decision match stays last.
      expect(stage.rank).toStrictEqual([
        { kind: 'metric', metric: 'points', direction: 'desc' },
        { kind: 'metric', metric: 'kill_differential', direction: 'desc' },
        { kind: 'head_to_head', scope: 'pairwise' },
        { kind: 'decision_match' },
      ]);
    }
  });

  it('reads the win points of a Swiss table and the chain from the injected pack', () => {
    const pack = { epb: { ...FIXTURE_PACK.epb, matchPoints: { win: 2, draw: 1 }, tiebreakerChain: ['match_points', 'decision_match'] as const } };
    const def = describeStages([{ bracketType: 'swiss' }], { formatType: 'evolution_point_buy' }, { pack });
    expect(stageOf(def, 0).scoring).toStrictEqual({ win: 2, loss: 0, bye: 0 });
    expect(stageOf(def, 0).rank).toHaveLength(2);
  });

  it('scores the pack win points in a round-robin table and a Swiss table of an Evolution Point Buy league', () => {
    // The standings take the points from the pack (`effectiveMatchPoints`), whatever a caller passes.
    for (const win of [1, 2, 5]) {
      const pack = { epb: { ...FIXTURE_PACK.epb, matchPoints: { win, draw: 1 } } };
      const def = describeStages([{ bracketType: 'round_robin' }, { bracketType: 'swiss' }], { formatType: 'evolution_point_buy' }, { pack });
      expect(def.stages.map((stage) => stage.scoring)).toStrictEqual([
        { win, loss: 0, bye: 0 },
        { win, loss: 0, bye: 0 },
      ]);
    }
  });

  it('keeps 3 per win in a round-robin table outside Evolution Point Buy whatever the pack stores', () => {
    const pack = { epb: { ...FIXTURE_PACK.epb, matchPoints: { win: 2, draw: 1 } } };
    const def = describeStages([{ bracketType: 'round_robin' }, { bracketType: 'swiss' }], { formatType: 'singles' }, { pack });
    expect(def.stages.map((stage) => stage.scoring)).toStrictEqual([
      { win: 3, loss: 0, bye: 0 },
      { win: 1, loss: 0, bye: 1 },
    ]);
  });

  describe('the stored tiebreaker order', () => {
    const rulesWith = (tiebreaker_order: unknown): LegacyInput['facts'] => ({
      typeAssignments: null,
      formatRules: { ...FIXTURE_LEAGUES.epb_two_stage.facts.formatRules!, tiebreaker_order: tiebreaker_order as never },
      draftTierLimits: null,
    });
    const rankOfTable = (tiebreaker_order: unknown, formatType: 'evolution_point_buy' | 'singles' = 'evolution_point_buy') =>
      stageOf(describeStages([{ bracketType: 'round_robin' }], { formatType }, { facts: rulesWith(tiebreaker_order) }), 0).rank;
    const positions = (tiebreaker_order: unknown) =>
      describeStages([{ bracketType: 'round_robin' }], { formatType: 'evolution_point_buy' }, { facts: rulesWith(tiebreaker_order) })
        .modules[0].facts.filter((fact) => fact.key.startsWith('tiebreak_'))
        .map((fact) => [fact.key, fact.value]);

    it('ranks by a usable stored order, not by the pack chain', () => {
      expect(rankOfTable(['head_to_head', 'match_points'])).toStrictEqual([
        { kind: 'head_to_head', scope: 'pairwise' },
        { kind: 'metric', metric: 'points', direction: 'desc' },
      ]);
      expect(positions(['head_to_head', 'match_points'])).toEqual([
        ['tiebreak_head_to_head', 1],
        ['tiebreak_match_points', 2],
      ]);
    });

    it.each([
      ['an empty order', []],
      ['an unknown step', ['match_points', 'coin_flip']],
      ['a repeated step', ['match_points', 'match_points']],
      ['a decision match that is not last', ['decision_match', 'match_points']],
      ['only a decision match', ['decision_match']],
      ['something that is not a list', 'match_points'],
    ])('falls back to the pack chain for %s', (_label, stored) => {
      expect(rankOfTable(stored)).toStrictEqual([
        { kind: 'metric', metric: 'points', direction: 'desc' },
        { kind: 'metric', metric: 'kill_differential', direction: 'desc' },
        { kind: 'head_to_head', scope: 'pairwise' },
        { kind: 'decision_match' },
      ]);
      expect(positions(stored).map(([key]) => key)).toEqual([
        'tiebreak_match_points',
        'tiebreak_kill_difference',
        'tiebreak_evolution_points',
        'tiebreak_head_to_head',
        'tiebreak_decision_match',
      ]);
    });

    it('does not change the rank of a league outside Evolution Point Buy', () => {
      expect(rankOfTable(['head_to_head', 'match_points'], 'singles')).toStrictEqual([
        { kind: 'metric', metric: 'points', direction: 'desc' },
        { kind: 'metric', metric: 'kill_differential', direction: 'desc' },
        { kind: 'metric', metric: 'buchholz', direction: 'desc' },
        { kind: 'metric', metric: 'wins', direction: 'desc' },
      ]);
    });
  });

  it('keeps elimination stages of an Evolution Point Buy league at one point and no rank', () => {
    const def = describeStages([{ bracketType: 'single_elim' }], { formatType: 'evolution_point_buy' });
    expect(stageOf(def, 0).scoring).toStrictEqual({ win: 1, loss: 0, bye: 0 });
    expect(stageOf(def, 0).rank).toStrictEqual([]);
  });

  it('never sets a draw or a forfeit', () => {
    for (const league of Object.values(FIXTURE_LEAGUES)) {
      for (const stage of describeLegacy(league).stages) {
        expect(Object.keys(stage.scoring).sort()).toEqual(['bye', 'loss', 'win']);
        expect(stage.series.allow_draw).toBe(false);
      }
    }
  });
});

describe('modules', () => {
  const modules = (season: Parameters<typeof makeSeason>[0], facts: Partial<LegacyInput['facts']> = {}) =>
    describeStages([{}], season, { facts: { typeAssignments: null, formatRules: null, draftTierLimits: null, ...facts } }).modules;
  const adapters = (list: ReturnType<typeof modules>) => list.map((m) => m.adapter);

  it('has no module for a plain singles or doubles league', () => {
    expect(modules({ formatType: 'singles' })).toEqual([]);
    expect(modules({ formatType: 'doubles' }, { typeAssignments: { gymTyped: 0, cored: 0 } })).toEqual([]);
  });

  it('adds the Core Liga module for a pool, an assigned core or a gym type', () => {
    expect(adapters(modules({ corePoolSize: 0 }))).toEqual(['core_liga']);
    expect(adapters(modules({}, { typeAssignments: { gymTyped: 0, cored: 1 } }))).toEqual(['core_liga']);
    expect(adapters(modules({}, { typeAssignments: { gymTyped: 2, cored: 0 } }))).toEqual(['core_liga']);
    expect(adapters(modules({ formatType: 'doubles', corePoolSize: 4 }))).toEqual(['core_liga']);
  });

  it('lists only the facts that are known', () => {
    const keys = (list: ReturnType<typeof modules>) => list[0].facts.map((f) => f.key);
    expect(keys(modules({ corePoolSize: 3 }))).toEqual(['core_pool_size', 'roster_size']);
    expect(keys(modules({ corePoolSize: 3 }, { typeAssignments: { gymTyped: 1, cored: 2 } }))).toEqual([
      'core_pool_size',
      'cores_assigned',
      'gym_types_assigned',
      'roster_size',
    ]);
    expect(keys(modules({}, { typeAssignments: { gymTyped: 1, cored: 0 } }))).toEqual(['cores_assigned', 'gym_types_assigned', 'roster_size']);
  });

  it('adds the draft module with the tier limits that exist, in tier order', () => {
    const list = modules({ formatType: 'draft' }, { draftTierLimits: [{ tier: 'C', maxPicks: 4 }, { tier: 'S', maxPicks: 1 }] });
    expect(list.map((m) => [m.adapter, m.facts.map((f) => [f.key, f.value])])).toEqual([
      ['legacy_draft', [['tier_limit_s', 1], ['tier_limit_c', 4]]],
    ]);
    expect(modules({ formatType: 'draft' })[0].facts).toEqual([]);
  });

  it('states no round-robin special case: the stored match points are what every table scores', () => {
    const pack = { epb: { ...FIXTURE_PACK.epb, matchPoints: { win: 2, draw: 1 } } };
    const entry = describeStages([{ bracketType: 'round_robin' }, { bracketType: 'swiss' }], { formatType: 'evolution_point_buy' }, { pack })
      .modules.find((module) => module.adapter === 'epb')!;
    const keys = entry.facts.map((f) => f.key);
    expect(keys).toContain('match_points_win');
    expect(keys.some((key) => key.includes('round_robin'))).toBe(false);
    expect(entry.facts.find((f) => f.key === 'match_points_win')?.value).toBe(2);
  });

  it('puts Core Liga before the draft module and never both for the same adapter', () => {
    expect(adapters(modules({ formatType: 'draft', corePoolSize: 2 }))).toEqual(['core_liga', 'legacy_draft']);
  });

  it('adds only the Evolution Point Buy module for that format, with pack and stored values', () => {
    const list = modules({ formatType: 'evolution_point_buy', corePoolSize: 5 }, { typeAssignments: { gymTyped: 3, cored: 3 } });
    expect(adapters(list)).toEqual(['epb']);
    const facts = new Map(list[0].facts.map((f) => [f.key, f.value]));
    expect(facts.get('match_points_win')).toBe(3);
    expect([1, 2, 3, 4, 5]).toEqual(
      ['match_points', 'kill_difference', 'evolution_points', 'head_to_head', 'decision_match'].map((step) => facts.get(`tiebreak_${step}`)),
    );
    expect(facts.get('draft_budget')).toBe(100);
    expect(facts.get('banned_moves')).toBe(1);
    expect(facts.get('tera_stage3')).toBe('stab_only');
    expect(facts.get('redraft_open')).toBe(false);
    expect(facts.get('comeback_earn_window')).toBe('season');
    expect(facts.get('stage_lock_enabled')).toBe(true);
  });

  it('prefers the stored rules row over the pack defaults', () => {
    const rules = FIXTURE_LEAGUES.epb_two_stage.facts.formatRules;
    const facts = new Map(
      describeLegacy(FIXTURE_LEAGUES.epb_two_stage).modules[0].facts.map((f) => [f.key, f.value]),
    );
    expect(rules).not.toBeNull();
    expect(facts.get('draft_budget')).toBe(120);
    expect(facts.get('banned_moves')).toBe(2);
    expect(facts.get('redraft_open')).toBe(true);
    expect(facts.get('tera_stage2')).toBe('stab_only');
  });

  it('writes both languages for every label and keeps the module within the limits', () => {
    for (const league of Object.values(FIXTURE_LEAGUES)) {
      for (const entry of describeLegacy(league).modules) {
        expect(entry.facts.length).toBeLessThanOrEqual(64);
        expect(new Set(entry.facts.map((f) => f.key)).size).toBe(entry.facts.length);
        for (const fact of entry.facts) {
          expect(fact.label.en?.v).toBeTruthy();
          expect(fact.label.de?.v).toBeTruthy();
          expect(fact.label.de?.v).not.toBe(fact.label.en?.v);
        }
      }
    }
  });
});

describe('capability parity', () => {
  const capabilities = (name: string) => {
    const input = FIXTURE_LEAGUES[name];
    return compile(describeLegacy(input), legacyCompileEnv(input.season.participantCount)).capabilities;
  };

  it('gives an Evolution Point Buy descriptor the capabilities of its format', () => {
    expect(capabilities('epb_two_stage')).toEqual(getFormatCapabilities('evolution_point_buy'));
  });

  it('gives a draft descriptor the capabilities of its format', () => {
    expect(capabilities('draft_double_elim')).toEqual(getFormatCapabilities('draft'));
  });

  it('gives a Core Liga descriptor a subset of the singles capabilities', () => {
    const derived = capabilities('core_liga_style');
    const singles = getFormatCapabilities('singles');
    expect(derived).not.toBeNull();
    for (const [flag, on] of Object.entries(derived ?? {})) {
      if (on) expect(singles[flag as keyof typeof singles], flag).toBe(true);
    }
  });
});

describe('names and limits', () => {
  it('keeps proper names in both languages with the league language as the base', () => {
    const def = describeStages([{ name: 'Gruppenphase' }], { name: 'Meine Liga', language: 'de', description: 'Eine Beschreibung' });
    expect(def.identity.name).toEqual({ base: 'de', en: { v: 'Meine Liga', s: 'human' }, de: { v: 'Meine Liga', s: 'human' } });
    expect(textOf(def.identity.summary, 'en')).toBe('Eine Beschreibung');
    expect(def.stages[0].name.base).toBe('de');
    expect(compile(def, legacyCompileEnv(8)).diagnostics.some((d) => d.code === 'ltext_untranslated')).toBe(false);
  });

  it('omits the summary when the description is empty', () => {
    expect('summary' in describeStages([{}], { description: '  ' }).identity).toBe(false);
  });

  it('cleans dirty names', () => {
    const def = describeStages([{ name: ' a\u0000b ' }, { name: 'x'.repeat(5000) }, { name: '' }, { name: ' \u0000 ' }], {
      name: '\u0000Dirty\u0000 name ',
    });
    expect(textOf(def.identity.name, 'en')).toBe('Dirty name');
    expect(textOf(def.stages[0].name, 'de')).toBe('ab');
    expect(textOf(def.stages[1].name, 'en')).toHaveLength(4000);
    expect(textOf(def.stages[2].name, 'en')).toBe('Phase 3');
    expect(textOf(def.stages[3].name, 'de')).toBe('Phase 4');
    expect(JSON.stringify(def)).not.toContain('\\u0000');
  });

  it('does not cut a surrogate pair in half', () => {
    const name = 'a'.repeat(3999) + '\u{1F600}';
    const text = textOf(describeStages([{ name }]).stages[0].name, 'en') ?? '';
    expect(text).toBe('a'.repeat(3999));
  });

  it('falls back to a generic league name in both languages', () => {
    const def = describeStages([{}], { name: '', language: 'de' });
    expect(def.identity.name).toEqual({ base: 'de', en: { v: 'League', s: 'human' }, de: { v: 'Liga', s: 'human' } });
  });

  it('picks the theme only when it is a valid key', () => {
    const world = (routeTheme: string | undefined) => describeStages([{}], { routeTheme }).theme.world;
    expect(world('sakura')).toBe('sakura');
    expect(world('auto')).toBe('auto');
    expect(world(undefined)).toBe('auto');
    expect(world('Not A Key')).toBe('auto');
    expect(world('__proto__')).toBe('auto');
  });

  it('gives no stages for a league without phases', () => {
    const def = describeLegacy(makeInput({ season: makeSeason(), stages: [] }));
    expect(def.stages).toEqual([]);
    expect(def.edges).toEqual([]);
  });

  it('keeps the first 50 phases', () => {
    const stages = Array.from({ length: 60 }, (_, i) => makeStage({ id: uuid(1000 + i), name: `Phase ${i}`, stageOrder: 60 - i }));
    const def = describeLegacy(makeInput({ stages }));
    expect(def.stages).toHaveLength(50);
    // Sorted by stage order: the phase with the lowest order (the last input) comes first.
    expect(textOf(def.stages[0].name, 'en')).toBe('Phase 59');
    expect(def.stages[49].key).toBe('stage_50');
  });

  it('never mutates a frozen input', () => {
    const input = deepFreeze(structuredClone(FIXTURE_LEAGUES.singles_groups_playoffs));
    expect(() => describeLegacy(input)).not.toThrow();
  });
});
