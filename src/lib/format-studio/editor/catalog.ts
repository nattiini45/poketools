/**
 * The option lists of the Studio editor's selects: one place for the values, so a select and the pure edit
 * operations agree on what is offered. Every value has a label in the `format-studio/primitives` catalog
 * (`metric.*`, `option.*`, `label.*`; `catalog.test.ts` proves it for both languages).
 *
 * Plain readonly tuples, no text: the components translate the values.
 */
import type { AdvanceSelect, BuiltinMetric, Edge, Pairing, RankStep, RuleCard, Stage } from '@/lib/format-kit/client';

/** The builtin metrics a rank step or a table column can use (`metric.<key>`). */
export const METRIC_KEYS = [
  'points',
  'wins',
  'losses',
  'games_played',
  'kill_differential',
  'buchholz',
  'seed',
  'rating',
] as const satisfies readonly BuiltinMetric[];

/** Pairing kinds the form offers (`label.pairing_<kind>`). */
export const PAIRING_KINDS = [
  'round_robin',
  'swiss',
  'single_elim',
  'double_elim',
  'manual',
] as const satisfies readonly Pairing['kind'][];

/** Seeding of a stage fed by the roster (`option.seeding_<value>`). */
export const SEEDING_ROSTER = ['rating', 'random', 'manual', 'signup'] as const;

/** Seeding of a stage fed by advancement rules (`option.seeding_<value>`). */
export const SEEDING_EDGES = ['edge_order', 'rating', 'random', 'manual'] as const;

/** How players are split into groups (`option.method_<value>`). */
export const GROUP_METHODS = ['serpentine', 'straight', 'random_seeded', 'manual'] as const;

/** Seeding of the players an advancement rule sends on (`option.seeding_<value>`). */
export const EDGE_SEEDINGS = ['rank', 'cross_group', 'random', 'manual'] as const satisfies readonly Edge['seeding'][];

/** Who confirms an advancement (`option.gate_<value>`). */
export const EDGE_GATES = ['admin_confirm', 'auto'] as const satisfies readonly Edge['gate'][];

/** How a custom rule is checked (`option.verify_<value>`). */
export const RULE_VERIFY_MODES = ['admin_checklist', 'player_attest', 'none'] as const satisfies readonly RuleCard['verify'][];

/** When a custom rule applies (`option.when_<value>`). */
export const RULE_WHEN = ['once', 'per_match', 'per_matchday'] as const satisfies readonly RuleCard['when'][];

/**
 * Selection kinds the form creates and edits (`label.advance_<kind>`). A threshold needs an expression, which
 * only a later builder edits; an existing one is shown and can be removed.
 */
export const SELECT_KINDS_EDITABLE = [
  'top_n',
  'per_group',
  'wildcard',
  'bottom_n',
  'manual_list',
] as const satisfies readonly Exclude<AdvanceSelect['kind'], 'threshold'>[];

/** Kinds of a rank step (`label.rank_<kind>`). */
export const RANK_STEP_KINDS = [
  'metric',
  'head_to_head',
  'coin_flip',
  'decision_match',
  'manual',
] as const satisfies readonly RankStep['kind'][];

/** Direction of a metric rank step (`option.direction_<value>`). */
export const RANK_DIRECTIONS = ['desc', 'asc'] as const;

/** Scope of a head-to-head rank step (`option.scope_<value>`). */
export const HEAD_TO_HEAD_SCOPES = ['pairwise', 'mini_table'] as const;

/** Where a series override counts its round from (`option.from_<value>`). */
export const OVERRIDE_FROM = ['start', 'end'] as const;

/** Where a stage gets its players (`option.from_<value>`). */
export const PARTICIPANT_SOURCES = ['roster', 'edges'] as const satisfies readonly Stage['participants']['from'][];

/**
 * A stored ruleset a stage may name, as the editor's pages hand it over: the DEFINITION id (what a format document stores;
 * attach resolves it to the newest published version), the name, and that version's number for the label ("Spring OU v2").
 * A legacy ruleset id that a stored document still names (the id of version 1 of the definition) is one more entry with that
 * id as `id` and the definition's id as `definition_id`; the pickers list it only while a stage names it.
 */
export interface RulesetChoice {
  id: string;
  name: string;
  version_no?: number;
  /** Set when `id` is not the definition's own id: the definition this legacy id belongs to. */
  definition_id?: string;
}
