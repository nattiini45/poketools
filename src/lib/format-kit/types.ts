/**
 * The format definition document, as hand-written zod-free types. These are the single source of
 * truth for TypeScript: `schema/index.ts` proves the zod schema's output equals them (a compile-time
 * assertion), so drift fails `tsc`.
 *
 * Defaults: a field documented "default X" may be omitted in the INPUT; the validated value always
 * has it. Collections are arrays with key fields, never records, so a user-chosen key such as
 * `constructor` is ordinary data (lookups go through `Map`, see `keys.ts`).
 */
import type { Expr } from './expr/ast';
import type { Key, Slug } from '@/lib/studio-core/keys';
import type { LText, LTextStatus, LTextValue } from '@/lib/studio-core/ltext';

// The bilingual text types live with the text helpers in the shared studio core (`@/lib/studio-core/ltext`, the one import
// path for them and for the helpers). `LText` is part of the format document schema (every name, summary, label and
// text section below is one), so the kit's public types surface keeps the type-only re-export; the values are not re-exported.
export type { LText, LTextStatus, LTextValue };

export interface FormatDefinition {
  schema_version: 1;
  identity: { name: LText; summary?: LText; based_on?: Slug };
  /** 1..50 */
  stages: Stage[];
  /** 0..100, default [] */
  edges: Edge[];
  /** 0..8, default [] */
  views: CrossStageView[];
  /** 0..200, default []. Rule ids are unique across all rule kinds. */
  rules: RuleEntry[];
  /** default { sections: [] } */
  text: { sections: TextSection[] };
  /** default { world: 'auto' } */
  theme: { world: 'auto' | Key };
  /** 0..3, default [] */
  modules: LegacyModule[];
  /**
   * Phase 3 sections, all optional with no default so a document without them keeps its content hash.
   * 0..32 (attr.define; attr.assign is the `assign` of a player attribute)
   */
  attributes?: AttributeDef[];
  /** 0..16 (domain.define) */
  domains?: DomainDef[];
  /** 0..8 (relation.define) */
  relations?: RelationDef[];
  /** 0..16 (resource.define) */
  resources?: ResourceDef[];
  /** 0..32 (metric.define | track.progression | score.placement) */
  metrics?: MetricEntry[];
  /** 0..32 */
  tunables?: TunableDef[];
}

export interface Stage {
  key: Key;
  name: LText;
  participants: ParticipantsSelector;
  groups?: GroupsSpec;
  pairing: Pairing;
  series: Series;
  /** default { kind: 'season_default' } */
  ruleset: RulesetRef;
  /** default false */
  doubles: boolean;
  /** int 2..8, default 2 */
  players_per_match: number;
  scoring: Scoring;
  /** 0..12, default [] */
  rank: RankStep[];
  /** 0..12 builtin metric keys, default [] */
  columns: Key[];
  /**
   * Phase 4 fields, all optional with no default so a stage without them keeps its content hash.
   * 0..32 team constraints checked when a player saves or submits a team for this stage.
   */
  constraints?: TeamConstraint[];
  calendar?: StageCalendar;
  end_when?: EndWhen;
  /** This stage repeats once per group of the earlier stage `from`; it has no `groups` of its own. */
  foreach_group?: { from: Key };
}

export type ParticipantsSelector =
  | { from: 'roster'; seeding: 'rating' | 'random' | 'manual' | 'signup'; expected_count?: number }
  | { from: 'edges'; seeding: 'edge_order' | 'rating' | 'random' | 'manual' };

export interface GroupsSpec {
  /** int 2..26 */
  count: number;
  /** default 'serpentine' */
  method: 'serpentine' | 'straight' | 'random_seeded' | 'manual';
}

/** The pairings a `filter` can wrap: the two that pair a whole field every round. */
export type FilterBase =
  | { kind: 'swiss'; rounds: number | 'auto'; avoid_repeats: boolean }
  | { kind: 'round_robin'; legs: number; mirror_legs: boolean };

export type Pairing =
  | { kind: 'round_robin'; legs: number; mirror_legs: boolean }
  | { kind: 'swiss'; rounds: number | 'auto'; avoid_repeats: boolean }
  | { kind: 'single_elim'; third_place: boolean }
  | { kind: 'double_elim'; bracket_reset: boolean }
  | { kind: 'manual' }
  | {
      kind: 'bipartite';
      /** A player enum attribute that is not multi. */
      attr: Key;
      /** 1..32 values of the attribute. */
      side_a: Key[];
      /** 1..32 values of the attribute, none of them in side_a. */
      side_b: Key[];
      /** int 1..32 */
      rounds: number;
      /** default true */
      avoid_repeats: boolean;
    }
  | {
      kind: 'filter';
      base: FilterBase;
      /** boolean, pair env: a pair for which it is false is never paired. */
      allow: Expr;
    }
  | {
      kind: 'challenge';
      /** int 1..64 */
      rounds: number;
      /** int 1..64: how many places above themselves a player may challenge. */
      rank_range: number;
      /** int 1..8, default 1 */
      max_open: number;
      /** int 0..16, default 1 */
      cooldown_rounds: number;
      /** int 1..336, default 72 */
      accept_window_hours: number;
    };

export interface Series {
  /** int 1..15. An even number is representable; the compiler rejects it. */
  best_of: number;
  /** default false */
  allow_draw: boolean;
  /** 0..32, default [] */
  overrides: SeriesOverride[];
}

export interface SeriesOverride {
  /** int 1..64 */
  round: number;
  /** default 'start' */
  from: 'start' | 'end';
  /** int 1..15 */
  best_of: number;
}

/**
 * Which ruleset a stage's teams follow: the league's, a stored ruleset by id, or a rule preset of the catalog
 * (`preset` is its id such as `gen9ou` or `gen9natdexdraft`: a Showdown ladder format or a Smogon draft format).
 * A preset only pre-picks settings; attaching the format to a league turns it into a normal, editable ruleset owned
 * by the league. An id the catalog does not know is a compile error, not a schema error, so a stored document stays
 * loadable.
 */
export type RulesetRef = { kind: 'season_default' } | { kind: 'ruleset'; id: string } | { kind: 'preset'; preset: Key };

export interface Scoring {
  win: number;
  /** default 0 */
  loss: number;
  /** default 0 */
  bye: number;
  /** representable, gated by the compiler */
  draw?: number;
  /**
   * Gated by the compiler (`env.matchModel.forfeits`). A number is the older shorthand: the winner of a forfeit or
   * no-show gets it and the loser the stage's `loss`, with no faint bonus.
   */
  forfeit?: number | ForfeitScoring;
  /**
   * Points per fainted Pokémon of the opponent in a played match (`match_outcomes` faint tally). Absent means 0; the
   * field is optional rather than defaulted so documents stored before it keep their hash.
   */
  per_opponent_faint?: number;
}

/** Points of a match settled by forfeit or no-show. */
export interface ForfeitScoring {
  win: number;
  /** default 0 */
  loss: number;
  /** default false. Whether the faint bonus applies on top; a forfeit has no faint tally, so it adds nothing yet. */
  faint_bonus: boolean;
}

export type BuiltinMetric =
  | 'points'
  | 'wins'
  | 'losses'
  | 'games_played'
  | 'kill_differential'
  | 'buchholz'
  | 'seed'
  | 'rating'
  | 'faints_dealt'
  | 'faints_taken';

export type RankStep =
  | { kind: 'metric'; metric: Key; direction: 'desc' | 'asc' }
  | { kind: 'head_to_head'; scope: 'pairwise' | 'mini_table' }
  | { kind: 'coin_flip' }
  | { kind: 'decision_match' }
  | { kind: 'manual' };

export interface Edge {
  key: Key;
  from: Key;
  to: Key;
  /** 1..4 */
  select: AdvanceSelect[];
  /** default 'rank' */
  seeding: 'rank' | 'cross_group' | 'random' | 'manual';
  /** default 'admin_confirm' */
  gate: 'admin_confirm' | 'auto';
}

export type AdvanceSelect =
  | { kind: 'top_n'; n: number }
  | { kind: 'per_group'; n: number }
  | { kind: 'wildcard'; n: number }
  | { kind: 'threshold'; when: Expr }
  | { kind: 'bottom_n'; n: number }
  | { kind: 'manual_list'; count?: number };

export interface CrossStageView {
  key: Key;
  label: LText;
  /** 2..50 */
  stages: Key[];
  metric: Key;
  combine: 'sum';
}

export interface RuleCard {
  kind: 'rule.custom';
  id: Key;
  text: LText;
  /** default { kind: 'season' } */
  scope: { kind: 'season' } | { kind: 'stage'; stage: Key };
  /** default 'admin_checklist' */
  verify: 'admin_checklist' | 'player_attest' | 'none';
  /** default 'once' */
  when: 'once' | 'per_match' | 'per_matchday';
  /** default true */
  visible_to_players: boolean;
  /** Set when the card was an unknown rule kind kept as a manual rule. */
  degraded_from?: string;
}

export interface TextSection {
  id: Key;
  title: LText;
  body: LText;
  stage?: Key;
}

export interface LegacyModule {
  kind: 'module.legacy';
  adapter: 'epb' | 'legacy_draft' | 'core_liga';
  /** 0..64, default [] */
  facts: LegacyFact[];
}

export interface LegacyFact {
  key: Key;
  label: LText;
  value: string | number | boolean;
}

// --- Phase 3: attributes, domains, relations, resources, metrics, tunables ------------------------

export interface AttributeDef {
  key: Key;
  label: LText;
  on: 'player' | 'entry';
  type: 'enum' | 'number' | 'text' | 'bool';
  /** 1..32 keys; enum only (the compiler requires it exactly for enums). */
  values?: Key[];
  /** Entry enum only: the value is a list (e.g. secondary roles). Not usable in expressions. */
  multi?: boolean;
  /** Player attributes only (the compiler rejects it on an entry attribute). */
  assign?: AttrAssign;
}

export type AttrAssign = { kind: 'manual' } | { kind: 'random_seeded' } | { kind: 'expr'; expr: Expr };

export interface DomainDef {
  key: Key;
  label: LText;
  /** 1..512 */
  entries: DomainEntry[];
  /** default 'unlocked' */
  initially: 'locked' | 'unlocked';
  /** default 'public' */
  visibility: 'public' | 'when_unlocked' | 'admins';
}

export interface DomainEntry {
  /** A @pkmn species id such as vivillonicysnow. */
  id: Key;
  /** 0..16, default [] */
  attrs: EntryAttr[];
}

export interface EntryAttr {
  key: Key;
  /** A list (1..8 keys) only for a multi attribute. */
  value: string | number | boolean | string[];
}

/**
 * A link runs from -> to (santa: giver -> recipient). `to` says who sees the TARGET of a link (own: the from player
 * sees whom they give to); `from` says who sees the SOURCE (hidden: only admins; own: the to player sees their
 * giver; all: everyone). Once `reveal_on` fired both sides are 'all'. A hidden side is never serialised to others.
 */
export interface RelationDef {
  key: Key;
  label: LText;
  shape: 'derangement' | 'pairs' | 'manual';
  /** default { from: 'hidden', to: 'own' } */
  visibility: { from: RelationVisibility; to: RelationVisibility };
  reveal_on?: EventSpec;
}

export type RelationVisibility = 'hidden' | 'own' | 'all';

export interface ResourceDef {
  key: Key;
  label: LText;
  holds: { kind: 'domain'; domain: Key } | { kind: 'counter' };
  /** int 1..64 */
  capacity?: number;
  /** default 'own' */
  visibility: 'own' | 'all';
  /** default 'none'; 'global' needs a domain-holding resource (compile) */
  exclusive: 'none' | 'global';
}

export type MetricEntry =
  | { kind: 'metric.define'; key: Key; label: LText; of: 'player' | 'match'; expr: Expr }
  | {
      kind: 'track.progression';
      key: Key;
      label: LText;
      stage?: Key;
      /** 1..16 */
      steps: { label: LText; when: Expr }[];
    }
  | {
      kind: 'score.placement';
      key: Key;
      label: LText;
      stage: Key;
      /** 1..64 points by final place, each |x| <= SCORE_ABS_MAX */
      points: number[];
    };

export interface TunableDef {
  key: Key;
  label: LText;
  type: 'number' | 'bool' | 'enum' | 'table';
  /** A number[] (1..64) only for a table; a Key for an enum. */
  default: number | boolean | string | number[];
  /** number only */
  min?: number;
  max?: number;
  /** enum only, 1..32 */
  values?: Key[];
  /** default 'start' */
  editable_until: 'start' | 'lock' | 'always';
  /** default 'experimental' */
  status: 'experimental' | 'approved';
}

// --- Phase 3: events, effects, actions, checks, adjustments (the open `rules` list) --------------

export type EventSpec =
  | { event: 'stage_start'; stage?: Key }
  | { event: 'round_start'; stage?: Key; /** int 1..64 */ round?: number }
  | { event: 'round_end'; stage?: Key; round?: number }
  | { event: 'match_completed'; stage?: Key }
  | { event: 'action_locked'; action: Key }
  | { event: 'stage_end'; stage?: Key }
  /** Marks come from a stage calendar; an admin can also fire one by hand. */
  | { event: 'time'; mark: Key };

export interface EffectTarget {
  who: 'all' | 'event_players';
  /** boolean, player env */
  where?: Expr;
}

export type Effect =
  | { effect: 'unlock_domain'; domain: Key }
  | { effect: 'lock_domain'; domain: Key }
  | { effect: 'reveal_relation'; relation: Key }
  | { effect: 'generate_relation'; relation: Key }
  | { effect: 'grant_resource'; resource: Key; to: EffectTarget; /** int 1..64, default 1 */ amount: number; item?: Key }
  | { effect: 'revoke_resource'; resource: Key; to: EffectTarget; amount: number; item?: Key }
  | { effect: 'adjust_points'; stage: Key; to: EffectTarget; /** |x| <= SCORE_ABS_MAX */ points: number }
  | { effect: 'set_attr'; attr: Key; to: EffectTarget; value: string | number | boolean }
  | { effect: 'open_action'; action: Key }
  | { effect: 'lock_action'; action: Key }
  | { effect: 'notify'; message: LText; to: EffectTarget };

export interface OnEventRule {
  kind: 'rule.on_event';
  id: Key;
  on: EventSpec;
  /** boolean, event env */
  when?: Expr;
  /** 1..16 */
  effects: Effect[];
}

export interface PlayerActionRule {
  kind: 'player.action';
  id: Key;
  label: LText;
  /** A relation: the actor is its from side, the target its to side. Absent: a player acts for themself. */
  via?: Key;
  /** default {}; an admin can always open or lock by hand */
  window: { opens_on?: EventSpec; closes_on?: EventSpec };
  /** 1..8, picked in order */
  steps: ActionStep[];
  /** default 'on_submit' */
  lock: 'on_submit' | 'on_close';
}

export interface ActionStep {
  resource: Key;
  domain: Key;
  /** int 1..16 */
  count: number;
  /** boolean, entry env */
  where?: Expr;
  /** A non-multi entry attribute: the picks of this step must differ in it. */
  distinct_attr?: Key;
}

export interface CheckRule {
  kind: 'check.assisted';
  id: Key;
  label?: LText;
  source:
    | { kind: 'unresolved_outcome' }
    | { kind: 'standings_tie'; stage?: Key }
    | { kind: 'pairing_rematch'; stage?: Key }
    | { kind: 'expr'; of: 'player' | 'match'; when: Expr };
}

export type AdjustKind = 'points' | 'resource' | 'relation' | 'outcome' | 'action' | 'domain' | 'rank';

export interface AdjustRule {
  kind: 'adjust.manual';
  id: Key;
  /** 1..7, unique */
  allow: AdjustKind[];
}

/** An entry of the open `rules` list. */
export type RuleEntry = RuleCard | OnEventRule | PlayerActionRule | CheckRule | AdjustRule;

// --- Phase 4: team constraints, calendar, stage end and per-group repetition -----------------------

/** Where a count constraint looks: a domain, the player's own holdings of a resource, listed species, or a combination. */
export type CountLeaf =
  | { kind: 'domain'; domain: Key; /** default false */ unlocked_only: boolean }
  | { kind: 'resource'; resource: Key }
  | { kind: 'species'; /** 1..64 @pkmn species ids */ ids: Key[] };

/**
 * `any_of` and `not` nest at most `MAX_COUNT_SOURCE_DEPTH` (2) levels deep: the three types below are those levels, so a
 * deeper source is not representable and the zod schema and the browser validator reject it the same way.
 */
export type CountSource2 = CountLeaf;
export type CountSource1 = CountLeaf | { kind: 'any_of'; sources: CountSource2[] } | { kind: 'not'; source: CountSource2 };
export type CountSource =
  | CountLeaf
  | { kind: 'any_of'; /** 2..6 */ sources: CountSource1[] }
  | { kind: 'not'; source: CountSource1 };

export type TeamConstraint =
  | { kind: 'roster_size'; /** int 1..6 */ min: number; max: number; when?: Expr }
  | { kind: 'count'; source: CountSource; /** int 0..6, at least one of the two */ min?: number; max?: number; when?: Expr }
  | {
      kind: 'distinct';
      by: 'base_species' | 'species' | 'item' | 'type' | 'attr';
      /** A non-multi entry attribute; `by: attr` only. */
      attr?: Key;
      /** int 1..6 */
      max_per: number;
      when?: Expr;
    }
  | {
      kind: 'type_quota';
      types: { source: 'fixed'; /** 1..18 type names */ types: string[] } | { source: 'player_attr'; attr: Key };
      /** int 0..6 */
      min_per_type: number;
      /** default false: whether a type of a dual-typed Pokémon counts for both of its types */
      allow_multi_count: boolean;
      when?: Expr;
    }
  | {
      kind: 'tera';
      mode: 'banned' | 'stab' | 'any' | 'from_attr';
      /** A player attribute; `from_attr` only. */
      attr?: Key;
      when?: Expr;
    }
  | {
      kind: 'evolution_stage';
      /** int 0..6, at least one of the three */
      fully_evolved_max?: number;
      nfe_max?: number;
      lc_max?: number;
      when?: Expr;
    };

/**
 * Times are read in the league's time zone when the season has one, else UTC. Round n opens at
 * `start + (n - 1) * every * cadence` and closes `round_window_hours` later.
 */
export interface StageCalendar {
  start: { kind: 'season_start' } | { kind: 'date'; /** YYYY-MM-DD */ date: string };
  /** HH:MM, default '18:00' */
  time: string;
  cadence: 'weekly' | 'days';
  /** int 1..28, default 1 */
  every: number;
  /** int 1..672, default 168 */
  round_window_hours: number;
  /** 0..16, default []. Each fires the `time` event of its key. */
  marks: CalendarMark[];
  /** 0..8, default [] */
  deadlines: DeadlinePolicy[];
}

export interface CalendarMark {
  key: Key;
  /** int 1..64 */
  round: number;
  /** int -672..672, relative to the opening of the round */
  offset_hours: number;
}

export interface DeadlinePolicy {
  applies: 'action' | 'match' | 'team';
  /** A player.action id; required exactly when `applies` is 'action'. */
  action?: Key;
  /** int -672..672, relative to the round deadline (an action: to its window close mark if any, else the opening of round 1) */
  offset_hours: number;
  on_miss: 'forfeit' | 'admin_review' | 'auto_lock' | 'seeded_random_pick';
}

export type EndWhen = { kind: 'rounds'; /** int 1..64 */ rounds: number } | { kind: 'expr'; /** boolean, stage env */ when: Expr };