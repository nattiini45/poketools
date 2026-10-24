/**
 * Fixture leagues for the descriptor tests and the golden master: six generic leagues that cover every
 * bracket type, league groups, enrollment by standings and by the previous phase, doubles, an own ruleset, a draft
 * league with tier limits, an Evolution Point Buy league with a stored rules row, a league with a core pool and an Evolution Point Buy league whose stored pack points differ from the round-robin table.
 * Names are generic; the pack values are literals (the descriptor never reads the format pack itself).
 */
import type { FormatRules } from '@/types/format-rules';
import type { LegacyInput, LegacyPack, LegacySeasonInput, LegacyStageInput } from '../../legacy/types';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Evolution Point Buy tuning as literals, shaped like the pack's `epb` section. */
export const FIXTURE_PACK: LegacyPack = {
  epb: {
    defaults: {
      draftBudget: 100,
      draftPicks: 6,
      tokenRatio: 5,
      tokenMax: 1,
      tokenMaxPerLine: 1,
      redraftMaxLines: 2,
      bannedMoves: ['Last Respects'],
      bannedItems: ['Bright Powder'],
    },
    matchPoints: { win: 3, draw: 1 },
    teraByStage: { stage1: 'any', stage2: 'any', stage3: 'stab_only' },
    tiebreakerChain: ['match_points', 'kill_difference', 'evolution_points', 'head_to_head', 'decision_match'],
    comeback: { table: [{ minWinnerSurvivors: 4, tokens: 1 }], earnWindow: 'season' },
    stageLock: { enabled: true, stage: 3, byMatchday: 2, suspendMatchdays: 1 },
    participationPoints: {
      perMatchday: 1,
      untilStage: 3,
      locksRedraft: true,
      awardNote: 'Participation point',
      comebackTokensPerProgress: 1,
    },
  },
};

export function makeSeason(over: Partial<LegacySeasonInput> = {}): LegacySeasonInput {
  return {
    id: uuid(1),
    name: 'Example League',
    description: '',
    formatType: 'singles',
    language: 'en',
    rulesetId: uuid(900),
    rulesetName: 'Standard rules',
    routeTheme: undefined,
    participantCount: 8,
    corePoolSize: null,
    leagueGroupCount: 0,
    ...over,
  };
}

export function makeStage(over: Partial<LegacyStageInput> = {}): LegacyStageInput {
  return {
    id: uuid(100),
    name: 'Phase',
    bracketType: 'round_robin',
    stageOrder: 1,
    bestOfDefault: 1,
    boOverrides: {},
    isDoubles: false,
    rulesetId: uuid(900),
    rulesetName: 'Standard rules',
    advancementRule: null,
    enrollmentSource: null,
    bracketResetEnabled: undefined,
    groupCount: 0,
    ...over,
  };
}

export function makeInput(over: Partial<LegacyInput> = {}): LegacyInput {
  return {
    season: makeSeason(),
    stages: [],
    pack: FIXTURE_PACK,
    facts: { typeAssignments: null, formatRules: null, draftTierLimits: null },
    ...over,
  };
}

const EPB_RULES: FormatRules = {
  id: uuid(500),
  season_id: uuid(4),
  banned_moves: ['Last Respects', 'Baton Pass'],
  banned_items: ['Bright Powder'],
  tera_rules: { stage1: 'any', stage2: 'stab_only', stage3: 'none' },
  tiebreaker_order: ['match_points', 'kill_difference', 'head_to_head'],
  draft_budget: 120,
  draft_picks: 6,
  draft_token_ratio: 5,
  draft_token_max: 2,
  draft_token_max_per_line: 1,
  redraft_phase_open: true,
  created_at: '2026-01-01T00:00:00Z',
};

export const FIXTURE_LEAGUES: Record<string, LegacyInput> = {
  singles_groups_playoffs: makeInput({
    season: makeSeason({ id: uuid(1), name: 'Group Cup', description: 'Two groups, then a knockout.', leagueGroupCount: 2 }),
    stages: [
      makeStage({
        id: uuid(101),
        name: 'Group stage',
        bracketType: 'round_robin',
        stageOrder: 1,
        groupCount: 2,
        advancementRule: { type: 'top_n', count: 2, per_group: true },
      }),
      makeStage({
        id: uuid(102),
        name: 'Playoffs',
        bracketType: 'single_elim',
        stageOrder: 2,
        bestOfDefault: 3,
        boOverrides: { Finals: 5, 'Third Place': 3 },
        enrollmentSource: { type: 'standings', source_phase_id: uuid(101) },
      }),
    ],
  }),
  doubles_round_robin: makeInput({
    season: makeSeason({ id: uuid(2), name: 'Doubles Ladder', formatType: 'doubles', participantCount: 6, routeTheme: 'sakura' }),
    stages: [
      makeStage({
        id: uuid(201),
        name: 'Doubles round robin',
        isDoubles: true,
        bestOfDefault: 3,
        rulesetId: uuid(901),
        rulesetName: 'Doubles rules',
      }),
    ],
  }),
  draft_double_elim: makeInput({
    season: makeSeason({ id: uuid(3), name: 'Draft Showdown', formatType: 'draft', language: 'de' }),
    stages: [
      makeStage({
        id: uuid(301),
        name: 'Double elimination',
        bracketType: 'double_elim',
        bestOfDefault: 3,
        boOverrides: { 'Grand Finals': 5 },
        bracketResetEnabled: true,
      }),
    ],
    facts: {
      typeAssignments: null,
      formatRules: null,
      draftTierLimits: [
        { tier: 'S', maxPicks: 1 },
        { tier: 'A', maxPicks: 2 },
        { tier: 'B', maxPicks: 3 },
        { tier: 'C', maxPicks: 4 },
      ],
    },
  }),
  epb_two_stage: makeInput({
    season: makeSeason({ id: uuid(4), name: 'Evolution Season', formatType: 'evolution_point_buy' }),
    stages: [
      makeStage({
        id: uuid(401),
        name: 'Regular season',
        bracketType: 'round_robin',
        stageOrder: 1,
        advancementRule: { type: 'top_n', count: 4, per_group: false },
      }),
      makeStage({
        id: uuid(402),
        name: 'Playoffs',
        bracketType: 'single_elim',
        stageOrder: 2,
        bestOfDefault: 3,
        boOverrides: { Finals: 5, Semifinals: 3 },
        enrollmentSource: { type: 'standings', source_phase_id: uuid(401) },
      }),
    ],
    facts: { typeAssignments: null, formatRules: EPB_RULES, draftTierLimits: null },
  }),
  core_liga_style: makeInput({
    season: makeSeason({ id: uuid(5), name: 'Core League', participantCount: 10, corePoolSize: 12 }),
    stages: [
      makeStage({
        id: uuid(501),
        name: 'Swiss rounds',
        bracketType: 'swiss',
        stageOrder: 1,
        advancementRule: { type: 'top_n', count: 4, per_group: false },
      }),
      makeStage({
        id: uuid(502),
        name: 'Playoffs',
        bracketType: 'single_elim',
        stageOrder: 2,
        bestOfDefault: 3,
        rulesetId: uuid(902),
        rulesetName: 'Playoff rules',
        boOverrides: { Finals: 5, 'Round 1': 1 },
      }),
    ],
    facts: { typeAssignments: { gymTyped: 6, cored: 5 }, formatRules: null, draftTierLimits: null },
  }),
  // The stored pack value (2) differs from what the round-robin table scores (3): the Swiss phase takes the pack value.
  epb_pack_points_differ: makeInput({
    season: makeSeason({ id: uuid(6), name: 'Evolution Cup', formatType: 'evolution_point_buy' }),
    stages: [
      makeStage({ id: uuid(601), name: 'Table', bracketType: 'round_robin', stageOrder: 1 }),
      makeStage({ id: uuid(602), name: 'Swiss table', bracketType: 'swiss', stageOrder: 2 }),
    ],
    pack: { epb: { ...FIXTURE_PACK.epb, matchPoints: { win: 2, draw: 1 } } },
  }),
};
