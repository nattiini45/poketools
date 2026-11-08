/**
 * Zod schemas of every available primitive node, and the unions built from them. SERVER ONLY.
 * `registry/server.ts` exposes the node schemas as the registry's `paramsSchema`, and
 * `schema/document.ts` composes the document from these exports, so the registry and the document
 * schema cannot diverge. The twin Specs live in `registry/manifest.ts`.
 *
 * Defaults are applied by the schema; a default is a factory so each parse gets a fresh object.
 */
import { z } from 'zod';
import { exprSchemaFor } from '../expr/schema';
import { LTEXT_MAX_CHARS } from '@/lib/studio-core/ltext';
import {
  CALENDAR_DATE_CHARS,
  CALENDAR_TIME_CHARS,
  MAX_ACTION_STEPS,
  MAX_BEST_OF,
  MAX_BIPARTITE_ROUNDS,
  MAX_CALENDAR_EVERY,
  MAX_CALENDAR_MARKS,
  MAX_CALENDAR_OFFSET_HOURS,
  MAX_CALENDAR_ROUND,
  MAX_CALENDAR_WINDOW_HOURS,
  MAX_CAPACITY,
  MAX_CHALLENGE_COOLDOWN,
  MAX_CHALLENGE_OPEN,
  MAX_CHALLENGE_RANK_RANGE,
  MAX_CHALLENGE_ROUNDS,
  MAX_CHALLENGE_WINDOW_HOURS,
  MAX_COLUMNS,
  MAX_CONSTRAINTS,
  MAX_COUNT_ANY_OF,
  MAX_COUNT_SPECIES,
  MAX_DEADLINES,
  MAX_DOMAIN_ENTRIES,
  MAX_EFFECTS,
  MAX_END_ROUNDS,
  MAX_ENTRY_ATTRS,
  MAX_ENUM_VALUES,
  MAX_EVENT_ROUND,
  MAX_EXPECTED_COUNT,
  MAX_FACTS,
  MAX_GRANT,
  MAX_GROUPS,
  MAX_LEGS,
  MAX_MULTI_VALUES,
  MAX_N,
  MAX_N_PER_GROUP,
  MAX_OVERRIDE_ROUND,
  MAX_OVERRIDES,
  MAX_PLACEMENT_POINTS,
  MAX_PLAYERS_PER_MATCH,
  MAX_QUOTA_TYPES,
  MAX_RANK_STEPS,
  MAX_SELECTS,
  MAX_SIDE_VALUES,
  MAX_STEP_COUNT,
  MAX_SWISS_ROUNDS,
  MAX_TABLE_VALUES,
  MAX_TEAM_SIZE,
  MAX_TRACK_STEPS,
  MAX_TYPE_NAME_CHARS,
  MAX_VIEW_STAGES,
  MIN_COUNT_ANY_OF,
  MIN_GROUPS,
  MIN_PLAYERS_PER_MATCH,
  SCORE_ABS_MAX,
} from '../limits';
import { ADJUST_KINDS, type AvailableKind } from '../registry/kinds';
import { ltextSchema, textString, uuidSchema } from '@/lib/studio-core/text-schema';
import { boundedArray, intRange, keySchema, numberAbs, kindSchema } from './common';

// --- Pairing ------------------------------------------------------------------------------------

export const pairingRoundRobinSchema = z.strictObject({
  kind: z.literal('round_robin'),
  legs: intRange(1, MAX_LEGS).default(1),
  mirror_legs: z.boolean().default(true),
});
export const pairingSwissSchema = z.strictObject({
  kind: z.literal('swiss'),
  rounds: z.union([intRange(1, MAX_SWISS_ROUNDS), z.literal('auto')]),
  avoid_repeats: z.boolean().default(true),
});
export const pairingSingleElimSchema = z.strictObject({
  kind: z.literal('single_elim'),
  third_place: z.boolean().default(false),
});
export const pairingDoubleElimSchema = z.strictObject({
  kind: z.literal('double_elim'),
  bracket_reset: z.boolean().default(false),
});
export const pairingManualSchema = z.strictObject({ kind: z.literal('manual') });
export const pairingBipartiteSchema = z.strictObject({
  kind: z.literal('bipartite'),
  attr: keySchema,
  side_a: boundedArray(keySchema, 1, MAX_SIDE_VALUES),
  side_b: boundedArray(keySchema, 1, MAX_SIDE_VALUES),
  rounds: intRange(1, MAX_BIPARTITE_ROUNDS),
  avoid_repeats: z.boolean().default(true),
});
export const filterBaseSchema = z.discriminatedUnion('kind', [pairingSwissSchema, pairingRoundRobinSchema]);
export const pairingFilterSchema = z.strictObject({
  kind: z.literal('filter'),
  base: filterBaseSchema,
  allow: exprSchemaFor('boolean'),
});
export const pairingChallengeSchema = z.strictObject({
  kind: z.literal('challenge'),
  rounds: intRange(1, MAX_CHALLENGE_ROUNDS),
  rank_range: intRange(1, MAX_CHALLENGE_RANK_RANGE),
  max_open: intRange(1, MAX_CHALLENGE_OPEN).default(1),
  cooldown_rounds: intRange(0, MAX_CHALLENGE_COOLDOWN).default(1),
  accept_window_hours: intRange(1, MAX_CHALLENGE_WINDOW_HOURS).default(72),
});

export const pairingSchema = z.discriminatedUnion('kind', [
  pairingRoundRobinSchema,
  pairingSwissSchema,
  pairingSingleElimSchema,
  pairingDoubleElimSchema,
  pairingManualSchema,
  pairingBipartiteSchema,
  pairingFilterSchema,
  pairingChallengeSchema,
]);

// --- Rank steps ---------------------------------------------------------------------------------

export const rankMetricSchema = z.strictObject({
  kind: z.literal('metric'),
  metric: keySchema,
  direction: z.enum(['desc', 'asc']),
});
export const rankHeadToHeadSchema = z.strictObject({
  kind: z.literal('head_to_head'),
  scope: z.enum(['pairwise', 'mini_table']),
});
export const rankCoinFlipSchema = z.strictObject({ kind: z.literal('coin_flip') });
export const rankDecisionMatchSchema = z.strictObject({ kind: z.literal('decision_match') });
export const rankManualSchema = z.strictObject({ kind: z.literal('manual') });

export const rankStepSchema = z.discriminatedUnion('kind', [
  rankMetricSchema,
  rankHeadToHeadSchema,
  rankCoinFlipSchema,
  rankDecisionMatchSchema,
  rankManualSchema,
]);

// --- Advance selects ----------------------------------------------------------------------------

export const advanceTopNSchema = z.strictObject({ kind: z.literal('top_n'), n: intRange(1, MAX_N) });
export const advancePerGroupSchema = z.strictObject({ kind: z.literal('per_group'), n: intRange(1, MAX_N_PER_GROUP) });
export const advanceWildcardSchema = z.strictObject({ kind: z.literal('wildcard'), n: intRange(1, MAX_N) });
export const advanceThresholdSchema = z.strictObject({ kind: z.literal('threshold'), when: exprSchemaFor('boolean') });
export const advanceBottomNSchema = z.strictObject({ kind: z.literal('bottom_n'), n: intRange(1, MAX_N) });
export const advanceManualListSchema = z.strictObject({
  kind: z.literal('manual_list'),
  count: intRange(1, MAX_N).optional(),
});

export const advanceSelectSchema = z.discriminatedUnion('kind', [
  advanceTopNSchema,
  advancePerGroupSchema,
  advanceWildcardSchema,
  advanceThresholdSchema,
  advanceBottomNSchema,
  advanceManualListSchema,
]);

// --- Stage parts --------------------------------------------------------------------------------

export const groupsSchema = z.strictObject({
  count: intRange(MIN_GROUPS, MAX_GROUPS),
  method: z.enum(['serpentine', 'straight', 'random_seeded', 'manual']).default('serpentine'),
});

export const seriesOverrideSchema = z.strictObject({
  round: intRange(1, MAX_OVERRIDE_ROUND),
  from: z.enum(['start', 'end']).default('start'),
  best_of: intRange(1, MAX_BEST_OF),
});

export const seriesSchema = z.strictObject({
  best_of: intRange(1, MAX_BEST_OF),
  allow_draw: z.boolean().default(false),
  overrides: boundedArray(seriesOverrideSchema, 0, MAX_OVERRIDES).default(() => []),
});

export const rulesetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('season_default') }),
  z.strictObject({ kind: z.literal('ruleset'), id: uuidSchema }),
  // The catalog check (is this a rule preset we know?) is a compile diagnostic, not a schema issue.
  z.strictObject({ kind: z.literal('preset'), preset: keySchema }),
]);

export const forfeitScoringSchema = z.strictObject({
  win: numberAbs(SCORE_ABS_MAX),
  loss: numberAbs(SCORE_ABS_MAX).default(0),
  faint_bonus: z.boolean().default(false),
});

export const scoringSchema = z.strictObject({
  win: numberAbs(SCORE_ABS_MAX),
  loss: numberAbs(SCORE_ABS_MAX).default(0),
  bye: numberAbs(SCORE_ABS_MAX).default(0),
  draw: numberAbs(SCORE_ABS_MAX).optional(),
  forfeit: z.union([numberAbs(SCORE_ABS_MAX), forfeitScoringSchema]).optional(),
  per_opponent_faint: z.number().min(0).max(SCORE_ABS_MAX).optional(),
});

export const participantsSchema = z.discriminatedUnion('from', [
  z.strictObject({
    from: z.literal('roster'),
    seeding: z.enum(['rating', 'random', 'manual', 'signup']),
    expected_count: intRange(2, MAX_EXPECTED_COUNT).optional(),
  }),
  z.strictObject({
    from: z.literal('edges'),
    seeding: z.enum(['edge_order', 'rating', 'random', 'manual']),
  }),
]);

// --- Phase 4: team constraints, calendar, stage end -------------------------------------------------

const countDomainSchema = z.strictObject({
  kind: z.literal('domain'),
  domain: keySchema,
  unlocked_only: z.boolean().default(false),
});
const countResourceSchema = z.strictObject({ kind: z.literal('resource'), resource: keySchema });
const countSpeciesSchema = z.strictObject({
  kind: z.literal('species'),
  ids: boundedArray(keySchema, 1, MAX_COUNT_SPECIES),
});
const anyOf = <T extends z.ZodType>(source: T) =>
  z.strictObject({
    kind: z.literal('any_of'),
    sources: boundedArray(source, MIN_COUNT_ANY_OF, MAX_COUNT_ANY_OF),
  });
const notOf = <T extends z.ZodType>(source: T) => z.strictObject({ kind: z.literal('not'), source });

// Written out level by level (MAX_COUNT_SOURCE_DEPTH levels) so the schema output is exactly the CountSource type.
const countSource2Schema = z.discriminatedUnion('kind', [countDomainSchema, countResourceSchema, countSpeciesSchema]);
const countSource1Schema = z.discriminatedUnion('kind', [
  countDomainSchema,
  countResourceSchema,
  countSpeciesSchema,
  anyOf(countSource2Schema),
  notOf(countSource2Schema),
]);
export const countSourceSchema = z.discriminatedUnion('kind', [
  countDomainSchema,
  countResourceSchema,
  countSpeciesSchema,
  anyOf(countSource1Schema),
  notOf(countSource1Schema),
]);

const teamSize = intRange(1, MAX_TEAM_SIZE);
const teamCount = intRange(0, MAX_TEAM_SIZE);
const constraintWhen = exprSchemaFor('boolean').optional();

export const constraintRosterSizeSchema = z.strictObject({
  kind: z.literal('roster_size'),
  min: teamSize,
  max: teamSize,
  when: constraintWhen,
});
export const constraintCountSchema = z.strictObject({
  kind: z.literal('count'),
  source: countSourceSchema,
  min: teamCount.optional(),
  max: teamCount.optional(),
  when: constraintWhen,
});
export const constraintDistinctSchema = z.strictObject({
  kind: z.literal('distinct'),
  by: z.enum(['base_species', 'species', 'item', 'type', 'attr']),
  attr: keySchema.optional(),
  max_per: teamSize,
  when: constraintWhen,
});
export const constraintTypeQuotaSchema = z.strictObject({
  kind: z.literal('type_quota'),
  types: z.discriminatedUnion('source', [
    z.strictObject({
      source: z.literal('fixed'),
      types: boundedArray(textString(1, MAX_TYPE_NAME_CHARS), 1, MAX_QUOTA_TYPES),
    }),
    z.strictObject({ source: z.literal('player_attr'), attr: keySchema }),
  ]),
  min_per_type: teamCount,
  allow_multi_count: z.boolean().default(false),
  when: constraintWhen,
});
export const constraintTeraSchema = z.strictObject({
  kind: z.literal('tera'),
  mode: z.enum(['banned', 'stab', 'any', 'from_attr']),
  attr: keySchema.optional(),
  when: constraintWhen,
});
export const constraintEvolutionStageSchema = z.strictObject({
  kind: z.literal('evolution_stage'),
  fully_evolved_max: teamCount.optional(),
  nfe_max: teamCount.optional(),
  lc_max: teamCount.optional(),
  when: constraintWhen,
});

export const teamConstraintSchema = z.discriminatedUnion('kind', [
  constraintRosterSizeSchema,
  constraintCountSchema,
  constraintDistinctSchema,
  constraintTypeQuotaSchema,
  constraintTeraSchema,
  constraintEvolutionStageSchema,
]);

const offsetHours = intRange(-MAX_CALENDAR_OFFSET_HOURS, MAX_CALENDAR_OFFSET_HOURS);

export const calendarMarkSchema = z.strictObject({
  key: keySchema,
  round: intRange(1, MAX_CALENDAR_ROUND),
  offset_hours: offsetHours,
});
export const deadlinePolicySchema = z.strictObject({
  applies: z.enum(['action', 'match', 'team']),
  action: keySchema.optional(),
  offset_hours: offsetHours,
  on_miss: z.enum(['forfeit', 'admin_review', 'auto_lock', 'seeded_random_pick']),
});
export const stageCalendarSchema = z.strictObject({
  start: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('season_start') }),
    z.strictObject({ kind: z.literal('date'), date: textString(1, CALENDAR_DATE_CHARS) }),
  ]),
  time: textString(1, CALENDAR_TIME_CHARS).default('18:00'),
  cadence: z.enum(['weekly', 'days']),
  every: intRange(1, MAX_CALENDAR_EVERY).default(1),
  round_window_hours: intRange(1, MAX_CALENDAR_WINDOW_HOURS).default(168),
  marks: boundedArray(calendarMarkSchema, 0, MAX_CALENDAR_MARKS).default(() => []),
  deadlines: boundedArray(deadlinePolicySchema, 0, MAX_DEADLINES).default(() => []),
});

export const endWhenSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('rounds'), rounds: intRange(1, MAX_END_ROUNDS) }),
  z.strictObject({ kind: z.literal('expr'), when: exprSchemaFor('boolean') }),
]);
export const foreachGroupSchema = z.strictObject({ from: keySchema });

export const stageSchema = z.strictObject({
  key: keySchema,
  name: ltextSchema,
  participants: participantsSchema,
  groups: groupsSchema.optional(),
  pairing: pairingSchema,
  series: seriesSchema,
  ruleset: rulesetSchema.default(() => ({ kind: 'season_default' as const })),
  doubles: z.boolean().default(false),
  players_per_match: intRange(MIN_PLAYERS_PER_MATCH, MAX_PLAYERS_PER_MATCH).default(2),
  scoring: scoringSchema,
  rank: boundedArray(rankStepSchema, 0, MAX_RANK_STEPS).default(() => []),
  columns: boundedArray(keySchema, 0, MAX_COLUMNS).default(() => []),
  constraints: boundedArray(teamConstraintSchema, 0, MAX_CONSTRAINTS).optional(),
  calendar: stageCalendarSchema.optional(),
  end_when: endWhenSchema.optional(),
  foreach_group: foreachGroupSchema.optional(),
});

// --- Edge, views, rules, text, theme, modules ---------------------------------------------------

export const edgeSchema = z.strictObject({
  key: keySchema,
  from: keySchema,
  to: keySchema,
  select: boundedArray(advanceSelectSchema, 1, MAX_SELECTS),
  seeding: z.enum(['rank', 'cross_group', 'random', 'manual']).default('rank'),
  gate: z.enum(['admin_confirm', 'auto']).default('admin_confirm'),
});

export const crossStageViewSchema = z.strictObject({
  key: keySchema,
  label: ltextSchema,
  stages: boundedArray(keySchema, 2, MAX_VIEW_STAGES),
  metric: keySchema,
  combine: z.enum(['sum']),
});

export const ruleCardSchema = z.strictObject({
  kind: z.literal('rule.custom'),
  id: keySchema,
  text: ltextSchema,
  scope: z
    .discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('season') }),
      z.strictObject({ kind: z.literal('stage'), stage: keySchema }),
    ])
    .default(() => ({ kind: 'season' as const })),
  verify: z.enum(['admin_checklist', 'player_attest', 'none']).default('admin_checklist'),
  when: z.enum(['once', 'per_match', 'per_matchday']).default('once'),
  visible_to_players: z.boolean().default(true),
  degraded_from: kindSchema.optional(),
});

export const textSectionSchema = z.strictObject({
  id: keySchema,
  title: ltextSchema,
  body: ltextSchema,
  stage: keySchema.optional(),
});

export const themeSchema = z.strictObject({ world: keySchema.default('auto') });

export const legacyFactSchema = z.strictObject({
  key: keySchema,
  label: ltextSchema,
  value: z.union([textString(0, LTEXT_MAX_CHARS), z.number(), z.boolean()]),
});

export const legacyModuleSchema = z.strictObject({
  kind: z.literal('module.legacy'),
  adapter: z.enum(['epb', 'legacy_draft', 'core_liga']),
  facts: boundedArray(legacyFactSchema, 0, MAX_FACTS).default(() => []),
});

// --- Phase 3: attributes, domains, relations, resources, metrics, tunables -------------------------

/** A scalar attribute or flag value. */
const scalarValue = z.union([textString(0, LTEXT_MAX_CHARS), z.number(), z.boolean()]);

export const attrAssignSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('manual') }),
  z.strictObject({ kind: z.literal('random_seeded') }),
  z.strictObject({ kind: z.literal('expr'), expr: exprSchemaFor('any') }),
]);

export const attributeDefSchema = z.strictObject({
  key: keySchema,
  label: ltextSchema,
  on: z.enum(['player', 'entry']),
  type: z.enum(['enum', 'number', 'text', 'bool']),
  values: boundedArray(keySchema, 1, MAX_ENUM_VALUES).optional(),
  multi: z.boolean().optional(),
  assign: attrAssignSchema.optional(),
});

export const entryAttrSchema = z.strictObject({
  key: keySchema,
  value: z.union([textString(0, LTEXT_MAX_CHARS), z.number(), z.boolean(), boundedArray(keySchema, 1, MAX_MULTI_VALUES)]),
});

export const domainEntrySchema = z.strictObject({
  id: keySchema,
  attrs: boundedArray(entryAttrSchema, 0, MAX_ENTRY_ATTRS).default(() => []),
});

export const domainDefSchema = z.strictObject({
  key: keySchema,
  label: ltextSchema,
  entries: boundedArray(domainEntrySchema, 1, MAX_DOMAIN_ENTRIES),
  initially: z.enum(['locked', 'unlocked']).default('unlocked'),
  visibility: z.enum(['public', 'when_unlocked', 'admins']).default('public'),
});

const eventStage = { stage: keySchema.optional() };
const roundEvent = <T extends 'round_start' | 'round_end'>(event: T) =>
  z.strictObject({ event: z.literal(event), ...eventStage, round: intRange(1, MAX_EVENT_ROUND).optional() });

export const eventSpecSchema = z.discriminatedUnion('event', [
  z.strictObject({ event: z.literal('stage_start'), ...eventStage }),
  roundEvent('round_start'),
  roundEvent('round_end'),
  z.strictObject({ event: z.literal('match_completed'), ...eventStage }),
  z.strictObject({ event: z.literal('action_locked'), action: keySchema }),
  z.strictObject({ event: z.literal('stage_end'), ...eventStage }),
  z.strictObject({ event: z.literal('time'), mark: keySchema }),
]);

const relationVisibility = z.enum(['hidden', 'own', 'all']);

export const relationDefSchema = z.strictObject({
  key: keySchema,
  label: ltextSchema,
  shape: z.enum(['derangement', 'pairs', 'manual']),
  visibility: z
    .strictObject({ from: relationVisibility, to: relationVisibility })
    .default(() => ({ from: 'hidden' as const, to: 'own' as const })),
  reveal_on: eventSpecSchema.optional(),
});

export const resourceDefSchema = z.strictObject({
  key: keySchema,
  label: ltextSchema,
  holds: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('domain'), domain: keySchema }),
    z.strictObject({ kind: z.literal('counter') }),
  ]),
  capacity: intRange(1, MAX_CAPACITY).optional(),
  visibility: z.enum(['own', 'all']).default('own'),
  exclusive: z.enum(['none', 'global']).default('none'),
});

export const metricDefineSchema = z.strictObject({
  kind: z.literal('metric.define'),
  key: keySchema,
  label: ltextSchema,
  of: z.enum(['player', 'match']),
  expr: exprSchemaFor('number'),
});
export const trackProgressionSchema = z.strictObject({
  kind: z.literal('track.progression'),
  key: keySchema,
  label: ltextSchema,
  stage: keySchema.optional(),
  steps: boundedArray(z.strictObject({ label: ltextSchema, when: exprSchemaFor('boolean') }), 1, MAX_TRACK_STEPS),
});
export const scorePlacementSchema = z.strictObject({
  kind: z.literal('score.placement'),
  key: keySchema,
  label: ltextSchema,
  stage: keySchema,
  points: boundedArray(numberAbs(SCORE_ABS_MAX), 1, MAX_PLACEMENT_POINTS),
});

export const metricEntrySchema = z.discriminatedUnion('kind', [
  metricDefineSchema,
  trackProgressionSchema,
  scorePlacementSchema,
]);

export const tunableDefSchema = z.strictObject({
  key: keySchema,
  label: ltextSchema,
  type: z.enum(['number', 'bool', 'enum', 'table']),
  default: z.union([z.number(), z.boolean(), keySchema, boundedArray(z.number(), 1, MAX_TABLE_VALUES)]),
  min: z.number().optional(),
  max: z.number().optional(),
  values: boundedArray(keySchema, 1, MAX_ENUM_VALUES).optional(),
  editable_until: z.enum(['start', 'lock', 'always']).default('start'),
  status: z.enum(['experimental', 'approved']).default('experimental'),
});

// --- Phase 3: effects, events and the rule kinds built on them ------------------------------------

export const effectTargetSchema = z.strictObject({
  who: z.enum(['all', 'event_players']).default('all'),
  where: exprSchemaFor('boolean').optional(),
});
const defaultTarget = () => ({ who: 'all' as const });
const resourceEffect = <T extends 'grant_resource' | 'revoke_resource'>(effect: T) =>
  z.strictObject({
    effect: z.literal(effect),
    resource: keySchema,
    to: effectTargetSchema.default(defaultTarget),
    amount: intRange(1, MAX_GRANT).default(1),
    item: keySchema.optional(),
  });

export const effectSchema = z.discriminatedUnion('effect', [
  z.strictObject({ effect: z.literal('unlock_domain'), domain: keySchema }),
  z.strictObject({ effect: z.literal('lock_domain'), domain: keySchema }),
  z.strictObject({ effect: z.literal('reveal_relation'), relation: keySchema }),
  z.strictObject({ effect: z.literal('generate_relation'), relation: keySchema }),
  resourceEffect('grant_resource'),
  resourceEffect('revoke_resource'),
  z.strictObject({
    effect: z.literal('adjust_points'),
    stage: keySchema,
    to: effectTargetSchema.default(defaultTarget),
    points: numberAbs(SCORE_ABS_MAX),
  }),
  z.strictObject({
    effect: z.literal('set_attr'),
    attr: keySchema,
    to: effectTargetSchema.default(defaultTarget),
    value: scalarValue,
  }),
  z.strictObject({ effect: z.literal('open_action'), action: keySchema }),
  z.strictObject({ effect: z.literal('lock_action'), action: keySchema }),
  z.strictObject({ effect: z.literal('notify'), message: ltextSchema, to: effectTargetSchema.default(defaultTarget) }),
]);

export const onEventRuleSchema = z.strictObject({
  kind: z.literal('rule.on_event'),
  id: keySchema,
  on: eventSpecSchema,
  when: exprSchemaFor('boolean').optional(),
  effects: boundedArray(effectSchema, 1, MAX_EFFECTS),
});

export const actionStepSchema = z.strictObject({
  resource: keySchema,
  domain: keySchema,
  count: intRange(1, MAX_STEP_COUNT),
  where: exprSchemaFor('boolean').optional(),
  distinct_attr: keySchema.optional(),
});

export const playerActionRuleSchema = z.strictObject({
  kind: z.literal('player.action'),
  id: keySchema,
  label: ltextSchema,
  via: keySchema.optional(),
  window: z
    .strictObject({ opens_on: eventSpecSchema.optional(), closes_on: eventSpecSchema.optional() })
    .default(() => ({})),
  steps: boundedArray(actionStepSchema, 1, MAX_ACTION_STEPS),
  lock: z.enum(['on_submit', 'on_close']).default('on_submit'),
});

export const checkRuleSchema = z.strictObject({
  kind: z.literal('check.assisted'),
  id: keySchema,
  label: ltextSchema.optional(),
  source: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('unresolved_outcome') }),
    z.strictObject({ kind: z.literal('standings_tie'), stage: keySchema.optional() }),
    z.strictObject({ kind: z.literal('pairing_rematch'), stage: keySchema.optional() }),
    z.strictObject({ kind: z.literal('expr'), of: z.enum(['player', 'match']), when: exprSchemaFor('boolean') }),
  ]),
});

export const adjustRuleSchema = z.strictObject({
  kind: z.literal('adjust.manual'),
  id: keySchema,
  allow: boundedArray(z.enum(ADJUST_KINDS), 1, ADJUST_KINDS.length),
});
/** The params schema of every available kind: the registry's `paramsSchema`. */
export const PRIMITIVE_NODE_SCHEMAS: ReadonlyMap<AvailableKind, z.ZodType<unknown>> = new Map<
  AvailableKind,
  z.ZodType<unknown>
>([
  ['stage.define', stageSchema],
  ['group.form', groupsSchema],
  ['pairing.round_robin', pairingRoundRobinSchema],
  ['pairing.swiss', pairingSwissSchema],
  ['pairing.single_elim', pairingSingleElimSchema],
  ['pairing.double_elim', pairingDoubleElimSchema],
  ['pairing.manual', pairingManualSchema],
  ['pairing.bipartite', pairingBipartiteSchema],
  ['pairing.filter', pairingFilterSchema],
  ['pairing.challenge', pairingChallengeSchema],
  ['series.rule', seriesSchema],
  ['team.ruleset', rulesetSchema],
  ['score.match', scoringSchema],
  ['rank.metric', rankMetricSchema],
  ['rank.head_to_head', rankHeadToHeadSchema],
  ['rank.coin_flip', rankCoinFlipSchema],
  ['rank.decision_match', rankDecisionMatchSchema],
  ['rank.manual', rankManualSchema],
  ['standings.view', crossStageViewSchema],
  ['advance.rule', edgeSchema],
  ['advance.top_n', advanceTopNSchema],
  ['advance.per_group', advancePerGroupSchema],
  ['advance.wildcard', advanceWildcardSchema],
  ['advance.threshold', advanceThresholdSchema],
  ['advance.bottom_n', advanceBottomNSchema],
  ['advance.manual_list', advanceManualListSchema],
  ['rule.custom', ruleCardSchema],
  ['text.rules', textSectionSchema],
  ['theme.hint', themeSchema],
  ['module.legacy', legacyModuleSchema],
  ['attr.define', attributeDefSchema],
  ['attr.assign', attrAssignSchema],
  ['domain.define', domainDefSchema],
  ['relation.define', relationDefSchema],
  ['resource.define', resourceDefSchema],
  ['metric.define', metricDefineSchema],
  ['rule.on_event', onEventRuleSchema],
  ['effect.apply', effectSchema],
  ['player.action', playerActionRuleSchema],
  ['track.progression', trackProgressionSchema],
  ['score.placement', scorePlacementSchema],
  ['check.assisted', checkRuleSchema],
  ['adjust.manual', adjustRuleSchema],
  ['constraint.roster_size', constraintRosterSizeSchema],
  ['constraint.count', constraintCountSchema],
  ['constraint.distinct', constraintDistinctSchema],
  ['constraint.type_quota', constraintTypeQuotaSchema],
  ['constraint.tera', constraintTeraSchema],
  ['constraint.evolution_stage', constraintEvolutionStageSchema],
  ['time.schedule', stageCalendarSchema],
  ['time.deadline_policy', deadlinePolicySchema],
  ['stage.end_when', endWhenSchema],
  ['stage.foreach_group', foreachGroupSchema],
]);
