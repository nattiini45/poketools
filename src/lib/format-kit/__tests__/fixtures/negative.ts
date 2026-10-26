/**
 * Negative fixtures: one small, readable edit of a valid preset per diagnostic code (several for the codes with
 * more than one trigger). Each fixture names the code it must produce, where, and (a subset of) its params.
 *
 * `engineOnly` marks input the validators refuse before the engine sees it (the schema already checks the root
 * type of an expression slot, and refuses an unknown expression node): the engine checks are run on it directly.
 */
import { compile } from '../../compile';
import { analyzeDefinition } from '../../engine/core';
import type { CompileEnv } from '../../engine/env';
import { CURRENT_ENV } from '../../engine/env';
import type { Diagnostic, DiagnosticCode, Severity } from '../../engine/diagnostics';
import type { JsonValue, PatchOp } from '../../patch';
import { applyPatch } from '../../patch';
import { classicLeague } from '../../presets/classic-league';
import { cup } from '../../presets/cup';
import { swissTopCut } from '../../presets/swiss-top-cut';
import { ltext } from '../../ltext';
import type { AdvanceSelect, Edge, FormatDefinition, Stage } from '../../types';

/** A valid stage (a single-elimination stage fed by edges) with any field overridden. */
export function makeStage(key: string, over: Partial<Stage> = {}): Stage {
  return {
    key,
    name: ltext('en', `Stage ${key}`, `Stage ${key}`),
    participants: { from: 'edges', seeding: 'edge_order' },
    pairing: { kind: 'single_elim', third_place: false },
    series: { best_of: 1, allow_draw: false, overrides: [] },
    ruleset: { kind: 'season_default' },
    doubles: false,
    players_per_match: 2,
    scoring: { win: 1, loss: 0, bye: 0 },
    rank: [],
    columns: [],
    ...over,
  };
}

/** A valid roster-fed round-robin stage with a points ranking. */
export function makeRosterStage(key: string, over: Partial<Stage> = {}): Stage {
  return makeStage(key, {
    participants: { from: 'roster', seeding: 'signup' },
    pairing: { kind: 'round_robin', legs: 1, mirror_legs: true },
    rank: [
      { kind: 'metric', metric: 'points', direction: 'desc' },
      { kind: 'coin_flip' },
    ],
    ...over,
  });
}

export function makeEdge(key: string, from: string, to: string, select: AdvanceSelect[] = [{ kind: 'top_n', n: 2 }]): Edge {
  return { key, from, to, select, seeding: 'rank', gate: 'admin_confirm' };
}

/** A definition around the given stages and edges, with everything else empty. */
export function makeDefinition(stages: Stage[], edges: Edge[] = []): FormatDefinition {
  return {
    schema_version: 1,
    identity: { name: ltext('en', 'Test format', 'Testformat') },
    stages,
    edges,
    views: [],
    rules: [],
    text: { sections: [] },
    theme: { world: 'auto' },
    modules: [],
  };
}

export interface NegativeFixture {
  id: string;
  code: DiagnosticCode;
  severity: Severity;
  pointer: string;
  input: unknown;
  env?: CompileEnv;
  params?: Record<string, string | number | boolean>;
  engineOnly?: boolean;
}

/** A deep copy of a preset with the patch applied; a patch that does not apply is a bug in the fixture. */
export function mutate(preset: FormatDefinition, ops: readonly PatchOp[]): unknown {
  const copy = JSON.parse(JSON.stringify(preset)) as JsonValue;
  const result = applyPatch(copy, ops);
  if (!result.ok) throw new Error(`fixture patch failed at op ${result.index}: ${result.reason}`);
  return result.value;
}

function envWith(change: {
  rosterSize?: number;
  killStats?: boolean;
  rating?: boolean;
  draws?: boolean;
  forfeits?: boolean;
  maxPlayersPerMatch?: number;
  rulesetIds?: ReadonlySet<string>;
}): CompileEnv {
  return {
    matchModel: {
      draws: change.draws ?? CURRENT_ENV.matchModel.draws,
      forfeits: change.forfeits ?? CURRENT_ENV.matchModel.forfeits,
      maxPlayersPerMatch: change.maxPlayersPerMatch ?? CURRENT_ENV.matchModel.maxPlayersPerMatch,
    },
    features: {
      killStats: change.killStats ?? CURRENT_ENV.features.killStats,
      rating: change.rating ?? CURRENT_ENV.features.rating,
    },
    ...(change.rosterSize !== undefined ? { rosterSize: change.rosterSize } : {}),
    ...(change.rulesetIds !== undefined ? { rulesetIds: change.rulesetIds } : {}),
  };
}

export function rosterEnv(rosterSize: number): CompileEnv {
  return envWith({ rosterSize });
}

const NO_RULESETS: ReadonlySet<string> = new Set<string>();
const RULESET_ID = '3f2b8c1e-5a47-4d09-9b6e-7c1d2a4e8f10';
const SELECT = '/edges/0/select';
const WHEN = '/edges/0/select/0/when';

const bool = (v: boolean) => ({ k: 'bool', v });
const num = (v: number) => ({ k: 'num', v });
const str = (v: string) => ({ k: 'str', v });
const ref = (name: string, t: 'number' | 'boolean' | 'text' = 'number') => ({ k: 'ref', name, t });
const cmp = (op: string, a: unknown, b: unknown) => ({ k: 'cmp', op, a, b });
const and = (...args: unknown[]) => ({ k: 'and', args });
const anyOver = (over: string, where?: unknown) => ({ k: 'agg', fn: 'any', over, ...(where === undefined ? {} : { where }) });

/** The select list `[ { threshold, when } ]` of edge 0. */
function threshold(when: unknown): PatchOp[] {
  return [{ op: 'replace', path: SELECT, value: [{ kind: 'threshold', when }] as JsonValue }];
}

function nested(depth: number): unknown {
  let node: unknown = bool(true);
  for (let i = 1; i < depth; i += 1) node = { k: 'not', a: node };
  return node;
}

/** 201 nodes: one over the compile limit of 200, inside the document limit of 256. */
function wide(): unknown {
  const group = () => and(...Array.from({ length: 8 }, () => and(bool(true), bool(true))));
  return and(...Array.from({ length: 8 }, group));
}

/** 1609 nodes: over the document limit, so the schema itself refuses it. */
function huge(): unknown {
  return and(...Array.from({ length: 8 }, wide));
}

/** An `any` over the standings whose body costs 19 nodes: 256 rows times 20 steps is over the budget. */
function costly(): unknown {
  const eight = () => and(...Array.from({ length: 8 }, () => bool(true)));
  return anyOver('standings', and(eight(), eight()));
}

const consolation = (() => {
  const stage = JSON.parse(JSON.stringify(classicLeague.stages[1])) as Record<string, unknown>;
  stage.key = 'consolation';
  return stage as unknown as JsonValue;
})();

const fx = (
  severity: Severity,
  id: string,
  code: DiagnosticCode,
  pointer: string,
  input: unknown,
  extra: { env?: CompileEnv; params?: NegativeFixture['params']; engineOnly?: boolean } = {},
): NegativeFixture => ({ id, code, severity, pointer, input, ...extra });

const C = classicLeague;
const U = cup;
const S = swissTopCut;
const setRank = (steps: unknown[]): PatchOp => ({ op: 'replace', path: '/stages/0/rank', value: steps as JsonValue });
const points = { kind: 'metric', metric: 'points', direction: 'desc' };
const wins = { kind: 'metric', metric: 'wins', direction: 'desc' };

export const NEGATIVE_FIXTURES: ReadonlyArray<NegativeFixture> = [
  // Schema: every issue code, at its pointer.
  fx('error', 'schema-required', 'schema_required', '/schema_version', mutate(C, [{ op: 'remove', path: '/schema_version' }])),
  fx('error', 'schema-type', 'schema_type', '/stages/0/doubles', mutate(C, [{ op: 'replace', path: '/stages/0/doubles', value: 'yes' }])),
  fx('error', 'schema-enum', 'schema_enum', '/schema_version', mutate(C, [{ op: 'replace', path: '/schema_version', value: 2 }])),
  fx('error', 'schema-range', 'schema_range', '/stages/0/series/best_of', mutate(C, [{ op: 'replace', path: '/stages/0/series/best_of', value: 16 }])),
  fx('error', 'schema-length', 'schema_length', '/stages', mutate(C, [{ op: 'replace', path: '/stages', value: [] }])),
  fx('error', 'schema-pattern', 'schema_pattern', '/stages/0/key', mutate(C, [{ op: 'replace', path: '/stages/0/key', value: 'Bad-Key' }])),
  fx('error', 'schema-unknown-key', 'schema_unknown_key', '/extra', mutate(C, [{ op: 'add', path: '/extra', value: true }])),
  fx('error', 'schema-limit', 'schema_limit', WHEN, mutate(C, threshold(huge()))),
  fx(
    'error',
    'schema-refine',
    'schema_refine',
    '/identity/name',
    mutate(C, [{ op: 'replace', path: '/identity/name', value: { base: 'de', en: { v: 'Classic league', s: 'human' } } }]),
  ),
  fx('error', 'schema-not-available-yet', 'schema_not_available_yet', '/attributes', mutate(C, [{ op: 'add', path: '/attributes', value: [] }]), {
    params: { what: 'attributes' },
  }),
  fx('warning', 'rule-unknown-primitive', 'rule_unknown_primitive', '/rules/1', mutate(C, [
    { op: 'add', path: '/rules/-', value: { kind: 'custom.mystery', id: 'mystery' } },
  ]), { params: { kind: 'custom.mystery' } }),

  // Structure and graph.
  fx('error', 'key-duplicate', 'key_duplicate', '/rules/1/id', mutate(C, [
    { op: 'add', path: '/rules/-', value: JSON.parse(JSON.stringify(C.rules[0])) as JsonValue },
  ]), { params: { scope: 'rules', key: 'fair_play' } }),
  fx('error', 'ref-unknown-stage', 'ref_unknown_stage', '/edges/0/to', mutate(C, [{ op: 'replace', path: '/edges/0/to', value: 'nowhere' }]), {
    params: { key: 'nowhere', where: 'edge_to' },
  }),
  fx('error', 'stage-cycle', 'stage_cycle', '/edges/0', mutate(C, [
    {
      op: 'add',
      path: '/edges/-',
      value: { key: 'back', from: 'playoffs', to: 'league', select: [{ kind: 'top_n', n: 2 }], seeding: 'rank', gate: 'admin_confirm' },
    },
  ]), { params: { path: 'league>playoffs>league' } }),
  fx('error', 'stage-unreachable', 'stage_unreachable', '/stages/1', mutate(C, [{ op: 'replace', path: '/edges', value: [] }]), {
    params: { stage: 'playoffs' },
  }),
  fx('warning', 'stage-roster-with-incoming', 'stage_roster_with_incoming', '/stages/1/participants', mutate(C, [
    { op: 'replace', path: '/stages/1/participants', value: { from: 'roster', seeding: 'rating' } },
  ]), { params: { stage: 'playoffs' } }),

  // Participant flow.
  fx('error', 'stage-too-few-participants', 'stage_too_few_participants', '/stages/0/participants', mutate(C, []), {
    env: rosterEnv(1),
    params: { stage: 'league', count: 1, source: 'roster' },
  }),
  fx('info', 'participant-count-unknown', 'participant_count_unknown', '/stages/0/participants', mutate(C, []), { params: { stage: 'league' } }),
  fx('error', 'groups-too-many', 'groups_too_many', '/stages/0/groups/count', mutate(U, []), {
    env: rosterEnv(6),
    params: { stage: 'groups', groups: 4, participants: 6 },
  }),
  fx('info', 'groups-uneven', 'groups_uneven', '/stages/0/groups', mutate(U, []), {
    env: rosterEnv(18),
    params: { stage: 'groups', groups: 4, participants: 18 },
  }),

  // Edges.
  fx('error', 'advance-exceeds-source', 'advance_exceeds_source', '/edges/0/select/0', mutate(C, []), {
    env: rosterEnv(3),
    params: { edge: 'to_playoffs', requested: 4, available: 3 },
  }),
  fx('error', 'advance-per-group-without-groups', 'advance_per_group_without_groups', '/edges/0/select/0', mutate(C, [
    { op: 'replace', path: SELECT, value: [{ kind: 'per_group', n: 2 }] },
  ]), { params: { edge: 'to_playoffs', stage: 'league' } }),
  fx('warning', 'advance-bracket-byes-edge', 'advance_bracket_byes', '/edges/0', mutate(U, [
    { op: 'replace', path: '/stages/0/groups/count', value: 3 },
  ]), { env: rosterEnv(12), params: { edge: 'to_knockout', stage: 'knockout', incoming: 6, bracket_size: 8, byes: 2 } }),
  fx('warning', 'advance-bracket-byes-roster', 'advance_bracket_byes', '/stages/0/pairing', mutate(S, [
    { op: 'replace', path: '/stages/0/pairing', value: { kind: 'single_elim', third_place: false } },
  ]), { env: rosterEnv(12), params: { stage: 'swiss', incoming: 12, bracket_size: 16, byes: 4 } }),
  fx('warning', 'advance-overlap', 'advance_overlap', '/edges/1', mutate(C, [
    { op: 'add', path: '/stages/-', value: consolation },
    {
      op: 'add',
      path: '/edges/-',
      value: { key: 'to_consolation', from: 'league', to: 'consolation', select: [{ kind: 'bottom_n', n: 4 }], seeding: 'rank', gate: 'admin_confirm' },
    },
  ]), { env: rosterEnv(6), params: { stage: 'league', requested: 8, available: 6 } }),

  // Series.
  fx('warning', 'swiss-rounds-too-many', 'swiss_rounds_too_many', '/stages/0/pairing/rounds', mutate(S, [
    { op: 'replace', path: '/stages/0/pairing/rounds', value: 12 },
  ]), { env: rosterEnv(10), params: { stage: 'swiss', rounds: 12, participants: 10 } }),
  fx('error', 'series-even-best-of', 'series_even_best_of', '/stages/0/series/best_of', mutate(C, [
    { op: 'replace', path: '/stages/0/series/best_of', value: 2 },
  ]), { params: { stage: 'league', best_of: 2, scope: 'default' } }),
  fx('error', 'series-even-best-of-override', 'series_even_best_of', '/stages/1/series/overrides/0/best_of', mutate(C, [
    { op: 'replace', path: '/stages/1/series/overrides/0/best_of', value: 4 },
  ]), { params: { stage: 'playoffs', best_of: 4, scope: 'override' } }),
  fx('error', 'series-override-duplicate', 'series_override_duplicate', '/stages/1/series/overrides/1', mutate(C, [
    { op: 'add', path: '/stages/1/series/overrides/-', value: { round: 1, from: 'end', best_of: 5 } },
  ]), { params: { stage: 'playoffs', round: 1 } }),
  fx('warning', 'series-override-unreachable', 'series_override_unreachable', '/stages/1/series/overrides/0', mutate(C, [
    { op: 'replace', path: '/stages/1/series/overrides/0/round', value: 5 },
  ]), { env: rosterEnv(8), params: { stage: 'playoffs', round: 5, rounds: 2 } }),

  // Match-model gate.
  fx('error', 'draws-scoring', 'draws_unsupported', '/stages/0/scoring/draw', mutate(C, [
    { op: 'add', path: '/stages/0/scoring/draw', value: 1 },
  ]), { params: { stage: 'league', where: 'scoring' } }),
  fx('error', 'draws-series', 'draws_unsupported', '/stages/0/series/allow_draw', mutate(C, [
    { op: 'replace', path: '/stages/0/series/allow_draw', value: true },
  ]), { params: { stage: 'league', where: 'series' } }),
  fx('error', 'forfeits', 'forfeits_unsupported', '/stages/0/scoring/forfeit', mutate(C, [
    { op: 'add', path: '/stages/0/scoring/forfeit', value: -1 },
  ]), { params: { stage: 'league' } }),
  fx('error', 'players-per-match', 'players_per_match_unsupported', '/stages/0/players_per_match', mutate(C, [
    { op: 'replace', path: '/stages/0/players_per_match', value: 3 },
  ]), { params: { stage: 'league', players: 3, max: 2 } }),

  // Scoring and ranking.
  fx('warning', 'scoring-win-not-better', 'scoring_win_not_better', '/stages/0/scoring/win', mutate(C, [
    { op: 'replace', path: '/stages/0/scoring/win', value: 0 },
  ]), { params: { stage: 'league', win: 0, loss: 0 } }),
  fx('error', 'rank-chain-empty', 'rank_chain_empty', '/stages/0/rank', mutate(C, [setRank([])]), { params: { stage: 'league' } }),
  fx('info', 'rank-ignored-for-bracket', 'rank_ignored_for_bracket', '/stages/1/rank', mutate(C, [
    { op: 'replace', path: '/stages/1/rank', value: [points] },
  ]), { params: { stage: 'playoffs' } }),
  fx('error', 'metric-unknown', 'metric_unproduced', '/stages/0/rank/3/metric', mutate(C, [
    { op: 'replace', path: '/stages/0/rank/3/metric', value: 'mystery' },
  ]), { params: { stage: 'league', metric: 'mystery', reason: 'unknown_metric', where: 'rank' } }),
  fx('error', 'metric-needs-kill-stats', 'metric_unproduced', '/stages/0/rank/2/metric', mutate(C, []), {
    env: envWith({ killStats: false }),
    params: { stage: 'league', metric: 'kill_differential', reason: 'needs_kill_stats', where: 'rank' },
  }),
  fx('error', 'metric-needs-rating', 'metric_unproduced', '/stages/0/rank/3/metric', mutate(C, [
    { op: 'replace', path: '/stages/0/rank/3/metric', value: 'rating' },
  ]), { env: envWith({ rating: false }), params: { stage: 'league', metric: 'rating', reason: 'needs_rating', where: 'rank' } }),
  fx('error', 'metric-needs-opponents', 'metric_unproduced', '/stages/1/columns/0', mutate(C, [
    { op: 'replace', path: '/stages/1/columns', value: ['buchholz'] },
  ]), { params: { stage: 'playoffs', metric: 'buchholz', reason: 'needs_opponents', where: 'columns' } }),
  fx('error', 'metric-view', 'metric_unproduced', '/views/0/metric', mutate(C, [
    {
      op: 'add',
      path: '/views/-',
      value: {
        key: 'overall',
        label: { base: 'en', en: { v: 'Overall', s: 'human' }, de: { v: 'Gesamt', s: 'human' } },
        stages: ['league', 'playoffs'],
        metric: 'mystery',
        combine: 'sum',
      },
    },
  ]), { params: { view: 'overall', metric: 'mystery', reason: 'unknown_metric', where: 'view' } }),
  fx('error', 'rank-decision-match-position', 'rank_decision_match_position', '/stages/0/rank/1', mutate(C, [
    setRank([points, { kind: 'decision_match' }, wins]),
  ]), { params: { stage: 'league' } }),
  fx('warning', 'rank-open-ended', 'rank_open_ended', '/stages/0/rank', mutate(C, [setRank([points])]), { params: { stage: 'league' } }),
  fx('warning', 'rank-step-unreachable', 'rank_step_unreachable', '/stages/0/rank/2', mutate(C, [
    setRank([points, { kind: 'coin_flip' }, wins]),
  ]), { params: { stage: 'league' } }),
  fx('warning', 'rank-duplicate-step', 'rank_duplicate_step', '/stages/0/rank/1', mutate(C, [
    setRank([points, points, { kind: 'coin_flip' }]),
  ]), { params: { stage: 'league' } }),

  // References and text.
  fx('error', 'ruleset-not-found', 'ruleset_not_found', '/stages/0/ruleset/id', mutate(C, [
    { op: 'replace', path: '/stages/0/ruleset', value: { kind: 'ruleset', id: RULESET_ID } },
  ]), { env: envWith({ rulesetIds: NO_RULESETS }), params: { stage: 'league', id: RULESET_ID } }),
  fx('error', 'showdown-format-unknown', 'showdown_format_unknown', '/stages/0/ruleset/format', mutate(C, [
    { op: 'replace', path: '/stages/0/ruleset', value: { kind: 'showdown', format: 'gen99xx' } },
  ]), { params: { stage: 'league', format: 'gen99xx' } }),
  fx('error', 'module-duplicate', 'module_duplicate', '/modules/1/adapter', mutate(C, [
    {
      op: 'replace',
      path: '/modules',
      value: [
        { kind: 'module.legacy', adapter: 'epb', facts: [] },
        { kind: 'module.legacy', adapter: 'epb', facts: [] },
      ],
    },
  ]), { params: { adapter: 'epb' } }),
  fx('info', 'ltext-untranslated', 'ltext_untranslated', '/identity/name', mutate(C, [
    { op: 'replace', path: '/identity/name', value: { base: 'en', en: { v: 'Classic league', s: 'human' } } },
  ]), { params: { locale: 'de' } }),

  // Expressions on an edge threshold.
  fx('error', 'expr-shape', 'expr_shape', `${WHEN}/k`, mutate(C, threshold({ k: 'mystery' })), { engineOnly: true, params: { edge: 'to_playoffs' } }),
  fx('error', 'expr-depth', 'expr_depth', WHEN, mutate(C, threshold(nested(13))), { params: { edge: 'to_playoffs' } }),
  fx('error', 'expr-nodes', 'expr_nodes', WHEN, mutate(C, threshold(wide())), { params: { edge: 'to_playoffs' } }),
  fx('error', 'expr-steps', 'expr_steps', WHEN, mutate(C, threshold(costly())), { params: { edge: 'to_playoffs' } }),
  fx('error', 'expr-type-mismatch', 'expr_type_mismatch', `${WHEN}/args/0`, mutate(C, threshold(and(num(1), bool(true)))), {
    params: { edge: 'to_playoffs' },
  }),
  fx('error', 'expr-unknown-ref', 'expr_unknown_ref', `${WHEN}/a/name`, mutate(C, threshold(cmp('>', ref('missing'), num(1)))), {
    params: { edge: 'to_playoffs' },
  }),
  fx('error', 'expr-ref-type', 'expr_ref_type', `${WHEN}/a/t`, mutate(C, threshold(cmp('>', ref('points', 'text'), num(1)))), {
    params: { edge: 'to_playoffs' },
  }),
  fx(
    'error',
    'expr-unknown-relation',
    'expr_unknown_relation',
    `${WHEN}/relation`,
    mutate(C, threshold({ k: 'rel', relation: 'friends', a: str('a'), b: str('b') })),
    { params: { edge: 'to_playoffs' } },
  ),
  fx('error', 'expr-unknown-collection', 'expr_unknown_collection', `${WHEN}/over`, mutate(C, threshold(anyOver('players', bool(true)))), {
    params: { edge: 'to_playoffs' },
  }),
  fx(
    'error',
    'expr-unknown-field',
    'expr_unknown_field',
    `${WHEN}/where/a/name`,
    mutate(C, threshold(anyOver('standings', cmp('>', ref('item.nope'), num(1))))),
    { params: { edge: 'to_playoffs' } },
  ),
  fx('error', 'expr-arity', 'expr_arity', WHEN, mutate(C, threshold(anyOver('standings'))), { params: { edge: 'to_playoffs' } }),
  fx('error', 'expr-number-range', 'expr_number_range', `${WHEN}/b/v`, mutate(C, threshold(cmp('>', ref('points'), num(2e9)))), {
    params: { edge: 'to_playoffs' },
  }),
  fx('error', 'expr-string-length', 'expr_string_length', `${WHEN}/a/v`, mutate(C, threshold(cmp('==', str('x'.repeat(65)), str('x')))), {
    params: { edge: 'to_playoffs' },
  }),
  fx('error', 'expr-result-type', 'expr_result_type', WHEN, mutate(C, threshold(num(1))), { engineOnly: true, params: { edge: 'to_playoffs' } }),
  fx('error', 'expr-item-scope', 'expr_item_scope', `${WHEN}/a/name`, mutate(C, threshold(cmp('>', ref('item.points'), num(1)))), {
    params: { edge: 'to_playoffs' },
  }),
  fx(
    'error',
    'expr-nested-aggregate',
    'expr_nested_aggregate',
    `${WHEN}/where`,
    mutate(C, threshold(anyOver('standings', anyOver('standings', bool(true))))),
    { params: { edge: 'to_playoffs' } },
  ),
];

/** The diagnostics a fixture is meant to produce: through `compile`, or straight from the engine for `engineOnly`. */
export function fixtureDiagnostics(fixture: NegativeFixture): readonly Diagnostic[] {
  const env = fixture.env ?? CURRENT_ENV;
  return fixture.engineOnly
    ? analyzeDefinition(fixture.input as FormatDefinition, env).diagnostics
    : compile(fixture.input, env).diagnostics;
}
