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
import {
  LTEXT_MAX_CHARS,
  MAX_BEST_OF,
  MAX_COLUMNS,
  MAX_EXPECTED_COUNT,
  MAX_FACTS,
  MAX_GROUPS,
  MAX_LEGS,
  MAX_N,
  MAX_N_PER_GROUP,
  MAX_OVERRIDE_ROUND,
  MAX_OVERRIDES,
  MAX_PLAYERS_PER_MATCH,
  MAX_RANK_STEPS,
  MAX_SELECTS,
  MAX_SWISS_ROUNDS,
  MAX_VIEW_STAGES,
  MIN_GROUPS,
  MIN_PLAYERS_PER_MATCH,
  SCORE_ABS_MAX,
} from '../limits';
import type { AvailableKind } from '../registry/kinds';
import { boundedArray, intRange, keySchema, ltextSchema, numberAbs, textString, uuidSchema, kindSchema } from './common';

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

export const pairingSchema = z.discriminatedUnion('kind', [
  pairingRoundRobinSchema,
  pairingSwissSchema,
  pairingSingleElimSchema,
  pairingDoubleElimSchema,
  pairingManualSchema,
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
]);

export const scoringSchema = z.strictObject({
  win: numberAbs(SCORE_ABS_MAX),
  loss: numberAbs(SCORE_ABS_MAX).default(0),
  bye: numberAbs(SCORE_ABS_MAX).default(0),
  draw: numberAbs(SCORE_ABS_MAX).optional(),
  forfeit: numberAbs(SCORE_ABS_MAX).optional(),
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
]);
